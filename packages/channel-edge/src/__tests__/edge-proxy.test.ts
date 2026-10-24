/**
 * اختباراتُ التوجيهِ (الوكيلِ) — تثبيتُ العيوبِ الثلاثِ المُثبَتةِ في التحقيقِ
 * (2026-10-24 · ب.2): (1) حذفُ `authorization` قبلَ قراءتِهِ، (2) التوجيهُ إلى
 * `identityUrl` أبدًا مهما كانت خدمةُ المدخلِ، (3) تمريرُ قالبِ `:param` حرفيًّا
 * وإسقاطُ الاستعلامِ. كلُّها تفشِلُ على النسخةِ المعيبةِ وتنجحُ بعدَ الإصلاحِ.
 *
 * التوقيعُ حقيقيٌّ لا زائفٌ: مُوقِّعٌ من `@wasla/service-auth` وتحقّقٌ بالحزمةِ
 * نفسِها (`verifyServiceToken`) على ما وصَلَ الخلفَ فعلًا — المسارَ الخامَ مع
 * استعلامِهِ — فإثباتُ صحةِ التوقيعِ مقيسٌ لا مفترضٌ (RISK-0026).
 */

import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createChannelEdge, EdgeSessionRejectedError } from "../create-channel-edge.js";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  verifyServiceToken,
  SERVICE_AUTH_HEADER,
} from "@wasla/service-auth";

/** مفاتيحُ اختبارٍ حقيقيةٌ (لا شبكةَ) — التوقيعُ والتحققُ بالحزمةِ نفسِها. */
const keys = keyRegistryFromEnv({
  WASLA_SERVICE_AUTH_KEYS: "probe-kid:active:probe-secret-0123456789abcdefghijk",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "probe-kid",
});

/**
 * مُوقِّعُ خدمةِ `customers` — بجمهورِها لا بجمهورِ الهويةِ. الدورُ «e2e-harness»
 * منحُهُ المُعلَنُ في المصفوفةِ (`FLEET_GRANTS`) يشملُ جمهورَ `customers`
 * بصلاحياتٍ مفتوحةٍ — لا يُوسَّعُ منحٌ لإخضارِ اختبارٍ؛ اختبارُ التوجيهِ
 * لا يحتاجُ دورَ بوتِ إنتاجٍ أصلًا.
 */
const customersSigner = createServiceRequestSigner({
  serviceName: "e2e-harness",
  audience: "customers",
  keys,
  scopes: ["customers:profile:read"],
});

const fakeSurface = {
  actorType: "customer" as const,
  botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
  requestSigner: customersSigner,
  waslaPublicIdOf: async () => "CUS-TEST",
};

/** قائمةُ سماحٍ بمدخلٍ مفتوحٍ واحدٍ لخدمةِ `customers` — بمعاملِ مسارٍ واستعلامٍ. */
function writeOpenAllowlist(): string {
  const dir = mkdtempSync(join(tmpdir(), "edge-proxy-"));
  const allowlistPath = join(dir, "customer-mini-app.json");
  writeFileSync(
    allowlistPath,
    JSON.stringify({
      entries: [
        {
          method: "GET",
          path: "/probe/customers/:waslaPublicId/profile",
          service: "customers",
          surface: "customer-mini-app",
          class: "O",
          required_scopes: ["customers:profile:read"],
          production_open: true,
        },
      ],
    }),
    "utf-8",
  );
  return allowlistPath;
}

/** ما يُلتقَطُ من النداءِ الخلفيِّ — لا شبكةَ حقيقيةَ. */
interface CapturedBackendCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface ProxyHarness {
  app: FastifyInstance;
  exchangeCalls: Array<{ session_token: string; audience: readonly string[] }>;
  backendCalls: CapturedBackendCall[];
}

/** بناءُ الحدِّ مع التقاطِ النداءِ الخلفيِّ — بمنافذَ مسجَّلةٍ لا زائفةٍ صامتةٍ. */
function buildProxyHarness(overrides: {
  exchangeSession?: (body: { session_token: string; audience: readonly string[] }) =>
    | Promise<{ assertion: string; wasla_public_id: string; actor_type: "customer" | "driver"; audience: readonly string[]; expires_at: string }>
    | Promise<never>;
}): ProxyHarness {
  const exchangeCalls: ProxyHarness["exchangeCalls"] = [];
  const backendCalls: CapturedBackendCall[] = [];
  const app = Fastify();
  const additions = createChannelEdge({
    surface: fakeSurface,
    issueSession: async () => {
      throw new Error("لا يُستدعى في هذهِ الفحوصِ");
    },
    exchangeSession: overrides.exchangeSession
      ? async (body) => {
          exchangeCalls.push({ session_token: body.session_token, audience: body.audience });
          return overrides.exchangeSession!(body);
        }
      : async (body) => {
          exchangeCalls.push({ session_token: body.session_token, audience: body.audience });
          return {
            assertion: "assertion-test",
            wasla_public_id: "CUS-TEST",
            actor_type: "customer" as const,
            audience: ["customers"],
            expires_at: new Date().toISOString(),
          };
        },
    revokeSession: async () => {
      throw new Error("لا يُستدعى في هذهِ الفحوصِ");
    },
    upstreams: {
      customers: { baseUrl: "http://customers.test", requestSigner: customersSigner },
    },
    allowlistUrl: writeOpenAllowlist(),
    enabled: true,
    allowedOrigins: [],
  });
  additions.apply(app);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    backendCalls.push({
      url: String(input),
      method: String(init?.method ?? "GET"),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined ? { body: String(init.body) } : {}),
    });
    return new Response(JSON.stringify({ ok: true, via: "customers" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { app, exchangeCalls, backendCalls };
}

describe("createChannelEdge — التوجيهُ (الوكيلُ) · تثبيتُ العيوبِ الثلاثِ", () => {
  it("الجلسةُ الصالحةُ عبرَ مدخلٍ مفتوحٍ: الاستبدالُ يُستدعى، والوجهةُ خدمةُ المدخلِ لا الهويةَ، والمعاملُ معوَّضٌ والاستعلامُ محفوظٌ، والتوقيعُ يتحققُ عندَ المستقبِلِ", async () => {
    const harness = buildProxyHarness({});
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/probe/customers/CUS-123/profile?include=places",
        headers: { authorization: "Bearer valid-session-token" },
      });

      // (1) الاستبدالُ حصلَ — على النسخةِ المعيبةِ كانَ يُرفضُ 401 قبلهُ.
      expect(harness.exchangeCalls).toHaveLength(1);
      expect(harness.exchangeCalls[0]).toEqual({
        session_token: "valid-session-token",
        audience: ["customers"],
      });

      // (2) الردُّ نجحَ ونقلَ جسمَ الخلفِ.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, via: "customers" });

      // (3) نداءٌ خلفيٌّ واحدٌ إلى خدمةِ المدخلِ — لا إلى الهويةِ.
      expect(harness.backendCalls).toHaveLength(1);
      const backend = harness.backendCalls[0];
      expect(backend.method).toBe("GET");
      // المعاملُ الفعليُّ معوَّضٌ (لا `:waslaPublicId` حرفيًّا) والاستعلامُ محفوظٌ.
      expect(backend.url).toBe(
        "http://customers.test/probe/customers/CUS-123/profile?include=places",
      );

      // (4) التوقيعُ حقيقيٌّ ويتحققُ عندَ المستقبِلِ على ما وصَلَهُ فعلًا —
      // المسارَ الخامَ معَ استعلامِهِ — بجمهورِ الخدمةِ و`obo` الاستبدالِ.
      const serviceToken = backend.headers[SERVICE_AUTH_HEADER];
      expect(typeof serviceToken).toBe("string");
      const principal = verifyServiceToken(serviceToken, {
        audience: "customers",
        method: "GET",
        path: "/probe/customers/CUS-123/profile?include=places",
        keys,
        now: new Date(),
      });
      expect(principal.onBehalfOfPublicId).toBe("CUS-TEST");
      expect(principal.serviceName).toBe("e2e-harness");

      // (5) رمزُ جلسةِ المتصفحِ وترويساتُ الداخلِ لا تصِلُ الخلفَ أبدًا.
      expect(backend.headers.authorization).toBeUndefined();
      expect(backend.headers["X-Wasla-User-Assertion"]).toBe("assertion-test");
    } finally {
      await harness.app.close();
    }
  });

  it("بلا جلسةٍ: 401 مسمًّى ولا استبدالَ ولا نداءً خلفيًّا", async () => {
    const harness = buildProxyHarness({});
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/probe/customers/CUS-123/profile",
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "EDGE_UNAUTHENTICATED" });
      expect(harness.exchangeCalls).toHaveLength(0);
      expect(harness.backendCalls).toHaveLength(0);
    } finally {
      await harness.app.close();
    }
  });

  it("فاعلٌ لا يطابقُ السطحَ: 401 ولا نداءً خلفيًّا", async () => {
    const harness = buildProxyHarness({
      exchangeSession: async () => ({
        assertion: "assertion-test",
        wasla_public_id: "CUS-TEST",
        actor_type: "driver" as const,
        audience: ["customers"],
        expires_at: new Date().toISOString(),
      }),
    });
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/probe/customers/CUS-123/profile",
        headers: { authorization: "Bearer valid-session-token" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "EDGE_ACTOR_MISMATCH" });
      expect(harness.backendCalls).toHaveLength(0);
    } finally {
      await harness.app.close();
    }
  });

  it("رفضُ جلسةٍ متوقعٌ (`EdgeSessionRejectedError`): 401 مسمًّى لا 500، ولا نداءً خلفيًّا", async () => {
    const harness = buildProxyHarness({
      exchangeSession: async () => {
        throw new EdgeSessionRejectedError("identity exchange returned 401");
      },
    });
    try {
      const response = await harness.app.inject({
        method: "GET",
        url: "/probe/customers/CUS-123/profile",
        headers: { authorization: "Bearer expired-session-token" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "EDGE_UNAUTHENTICATED" });
      expect(harness.backendCalls).toHaveLength(0);
    } finally {
      await harness.app.close();
    }
  });

  it("مدخلٌ مفتوحٌ بلا وجهةٍ موصولةٍ: فشلُ تركيبٍ صريحٌ — لا وجهةَ احتياطيةَ إلى الهويةِ ولا تخطيًا صامتًا", async () => {
    const app = Fastify();
    const additions = createChannelEdge({
      surface: fakeSurface,
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
      exchangeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      revokeSession: async () => {
        throw new Error("لا يُستدعى");
      },
      // لا upstreams إطلاقًا — والمدخلُ مفتوحٌ في القائمةِ.
      allowlistUrl: writeOpenAllowlist(),
      enabled: true,
      allowedOrigins: [],
    });
    expect(() => additions.apply(app)).toThrowError(/upstreams\.customers/);
    await app.close();
  });
});
