/**
 * اختباراتُ منافذِ الجلسةِ عبرَ تركيبِ البوتِ لا الحزمةِ وحدَها — الاستبدالُ
 * والسحبُ نداءانِ حقيقيانِ موقَّعانِ إلى identity (لا استثناءانِ ثابتانِ بعدَ
 * إصلاحِ التوجيهِ · 2026-10-24): يُقاسُ أنَّ مسارَ الخروجِ يصلُ الخدمةَ بتوقيعٍ
 * حقيقيٍّ وبجمهورِ الهويةِ، وأنَّ الرفضَ المتوقعَ (جلسةٌ مجهولةٌ · 404) يُعلَنُ
 * نتيجةً لا انفجارًا.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { createServiceRequestSigner, keyRegistryFromEnv, verifyServiceToken } from "@wasla/service-auth";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAppWithEdge } from "../edge.js";

// تركيبُ الحدِّ يقرأُ قائمةَ السماحِ بمسارٍ نسبيٍّ من جذرِ المستودعِ (كما في
// CI) — فاختبارُ الحزمةِ يضبطُ جذرَ العملِ إلى الجذرِ لا إلى مجلدِ الحزمةِ.
process.chdir(join(dirname(fileURLToPath(import.meta.url)), "../../../../"));

const ENV = {
  CUSTOMER_BOT_TOKEN: "token-value",
  CUSTOMER_BOT_WEBHOOK_SECRET: "customer-bot-test-webhook-secret",
  CUSTOMER_BOT_MINI_APP_URL: "https://apps.wasla.test/customer",
  IDENTITY_SERVICE_URL: "http://identity.test",
  WASLA_SERVICE_AUTH_KEYS: "test-active:active:bots-test-secret-0123456789abcdef",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
  WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
  WASLA_EDGE_ENABLED: "true",
};

// نفسُ مفاتيحِ ENV للاختبارِ: التركيبُ يوقِّعُ بمفاتيحِ البيئةِ (test-active)
// فالتحققُ عندَ المستقبِلِ يجبُ أنْ يرى نفسَ السجلِ — لا سجلًّا آخرَ.
const TEST_KEYS = keyRegistryFromEnv({
  WASLA_SERVICE_AUTH_KEYS: ENV.WASLA_SERVICE_AUTH_KEYS,
  WASLA_SERVICE_AUTH_ACTIVE_KID: ENV.WASLA_SERVICE_AUTH_ACTIVE_KID,
});

/** مُوقِّعُ `customers` للاختبارِ المعزولِ — الدورُ المُعلَنُ في المصفوفةِ (e2e-harness). */
const customersUpstreamSigner = createServiceRequestSigner({
  serviceName: "e2e-harness",
  audience: "customers",
  keys: TEST_KEYS,
  scopes: ["customers:profile:read"],
});

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function build() {
  return buildAppWithEdge({
    env: ENV,
    channel: new MockChannelAdapter(),
    identity: new FakeIdentityBootstrap("WS-1000"),
    logger: false,
    edgeEnabled: true,
    identityServiceUrl: "http://identity.test",
  });
}

describe("تركيبُ البوتِ — منافذُ الجلسةِ عبرَ الحدِّ (السحبُ)", () => {
  it("مسارُ الخروجِ يصلُ identity بتوقيعٍ حقيقيٍّ وبجمهورِها — لا استثناءً ثابتًا", async () => {
    const captured: CapturedCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      captured.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        headers: (init?.headers ?? {}) as Record<string, string>,
        ...(init?.body !== undefined ? { body: String(init.body) } : {}),
      });
      return new Response(JSON.stringify({ revoked: true, session_id: "sess-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const bot = build();
      const response = await bot.app.inject({
        method: "POST",
        url: "/edge/session/logout",
        headers: { authorization: "Bearer a-live-session-token" },
      });

      // الردُّ نجحَ — لا 500 من استثناءٍ ثابتٍ.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ revoked: true });

      // نداءٌ واحدٌ إلى identity — موقَّعٌ لا محمولًا بلا ترويسةٍ.
      expect(captured).toHaveLength(1);
      expect(captured[0].url).toBe("http://identity.test/identity/sessions/revoke");
      expect(captured[0].method).toBe("POST");
      expect(typeof captured[0].headers["x-wasla-service-auth"]).toBe("string");
      // التوقيعُ حقيقيٌّ لا وجودَ سلسلةٍ فحسبْ: يتحققُ فعليًّا عندَ المستقبِلِ
      // بالحزمةِ نفسِها — الجمهورُ `identity` والربطُ بالطريقةِ والمسارِ.
      const revokePrincipal = verifyServiceToken(
        String(captured[0].headers["x-wasla-service-auth"]),
        {
          audience: "identity",
          method: "POST",
          path: "/identity/sessions/revoke",
          keys: TEST_KEYS,
          now: new Date(),
        },
      );
      expect(revokePrincipal.serviceName).toBe("customer-bot");
      // جسمُ الطلبِ يحملُ الرمزَ والسببَ كما عُهِدَ.
      expect(JSON.parse(captured[0].body ?? "{}")).toEqual({
        session_token: "a-live-session-token",
        reason: "user_requested",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("الاستبدالُ عبرَ التركيبِ بقائمةِ اختبارٍ معزولةٍ: النداءُ موقَّعٌ للهويةِ والتوجيهُ لخدمةِ المدخلِ والمعاملُ معوَّضٌ والاستعلامُ محفوظٌ والتوقيعُ يتحققُ", async () => {
    const captured: CapturedCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      captured.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        headers: (init?.headers ?? {}) as Record<string, string>,
        ...(init?.body !== undefined ? { body: String(init.body) } : {}),
      });
      // نداءُ الاستبدالِ إلى identity يُجابُ بجلسةٍ صالحةٍ؛ نداءُ الخدمةِ يُجابُ بالملفِ.
      if (String(input).includes("/identity/sessions/exchange")) {
        return new Response(
          JSON.stringify({
            assertion: "assertion-exchange-test",
            wasla_public_id: "CUS-456",
            actor_type: "customer",
            audience: ["customers"],
            expires_at: "2026-12-31T23:59:59Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ profile: { wasla_public_id: "CUS-456" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const bot = buildAppWithEdge({
        env: ENV,
        channel: new MockChannelAdapter(),
        identity: new FakeIdentityBootstrap("WS-1000"),
        logger: false,
        edgeEnabled: true,
        identityServiceUrl: "http://identity.test",
        edgeAllowlistUrl: join(
          dirname(fileURLToPath(import.meta.url)),
          "fixtures/edge-allowlist-exchange-fixture.json",
        ),
        edgeUpstreams: {
          customers: {
            baseUrl: "http://customers.test",
            requestSigner: customersUpstreamSigner,
          },
        },
      });
      const response = await bot.app.inject({
        method: "GET",
        url: "/edge/test/customers/CUS-456/profile?include=places",
        headers: {
          origin: "https://apps.wasla.test",
          authorization: "Bearer a-live-session-token",
        },
      });

      // الوكيلُ أجابَ — لا 401 من علةِ الترويسةِ ولا 500.
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ profile: { wasla_public_id: "CUS-456" } });

      // نداءانِ: الاستبدالُ (identity) ثمَّ الخدمةُ (customers) — بهذا الترتيبِ.
      expect(captured).toHaveLength(2);
      expect(captured[0].url).toBe("http://identity.test/identity/sessions/exchange");
      // مسارُ المدخلِ يُمرَّرُ كما هو (المعاملُ معوَّضٌ والاستعلامُ محفوظٌ) —
      // نفسُ عقدِ اختبارِ الحزمةِ: قالبُ القائمةِ هو المسارُ المُعلَنُ.
      expect(captured[1].url).toBe(
        "http://customers.test/edge/test/customers/CUS-456/profile?include=places",
      );

      // توقيعُ الاستبدالِ حقيقيٌّ ويتحققُ — الجمهورُ `identity` لا `customers`.
      const exchangePrincipal = verifyServiceToken(
        String(captured[0].headers["x-wasla-service-auth"]),
        {
          audience: "identity",
          method: "POST",
          path: "/identity/sessions/exchange",
          keys: TEST_KEYS,
          now: new Date(),
        },
      );
      expect(exchangePrincipal.serviceName).toBe("customer-bot");

      // توقيعُ نداءِ الخدمةِ حقيقيٌّ ويتحققُ على المسارِ الخامِ معَ استعلامِهِ —
      // المعاملُ معوَّضٌ (CUS-456) والاستعلامُ محفوظٌ (include=places).
      const backendPrincipal = verifyServiceToken(
        String(captured[1].headers["x-wasla-service-auth"]),
        {
          audience: "customers",
          method: "GET",
          path: "/edge/test/customers/CUS-456/profile?include=places",
          keys: TEST_KEYS,
          now: new Date(),
        },
      );
      expect(backendPrincipal.serviceName).toBe("e2e-harness");
      expect(backendPrincipal.onBehalfOfPublicId).toBe("CUS-456");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("جلسةٌ مجهولةٌ عندَ identity (404): نتيجةٌ متوقعةٌ — 401 مسمًّى لا 500", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: "IDENTITY_SESSION_NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const bot = build();
      const response = await bot.app.inject({
        method: "POST",
        url: "/edge/session/logout",
        headers: { authorization: "Bearer an-unknown-session-token" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: "EDGE_UNAUTHENTICATED" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
