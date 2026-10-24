/**
 * اختباراتُ منافذِ الجلسةِ عبرَ تركيبِ البوتِ لا الحزمةِ وحدَها — الاستبدالُ
 * والسحبُ نداءانِ حقيقيانِ موقَّعانِ إلى identity (لا استثناءانِ ثابتانِ بعدَ
 * إصلاحِ التوجيهِ · 2026-10-24): يُقاسُ أنَّ مسارَ الخروجِ يصلُ الخدمةَ بتوقيعٍ
 * حقيقيٍّ وبجمهورِ الهويةِ، وأنَّ الرفضَ المتوقعَ (جلسةٌ مجهولةٌ · 404) يُعلَنُ
 * نتيجةً لا انفجارًا.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { createServiceRequestSigner, keyRegistryFromEnv, verifyServiceToken } from "@wasla/service-auth";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAppWithEdge, buildCustomerBotSessionPorts } from "../edge.js";
import { createChannelEdge } from "@wasla/channel-edge";
import { buildApp } from "../server.js";

// تركيبُ الحدِّ يقرأُ قائمةَ السماحِ بمسارٍ نسبيٍّ من جذرِ المستودعِ (كما في
// CI) — فاختبارُ الحزمةِ يضبطُ جذرَ العملِ إلى الجذرِ لا إلى مجلدِ الحزمةِ.
process.chdir(join(dirname(fileURLToPath(import.meta.url)), "../../../../"));

const ENV = {
  CUSTOMER_BOT_TOKEN: "111222333:AAHedgeports-test-token-0123456789",
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

  it("منفذُ الإصدارِ عبرَ التركيبِ: initData موقَّعٌ بسرِّ الروبوتِ → نداءٌ موقَّعٌ إلى identity/sessions يتحققُ توقيعُهُ فعليًّا", async () => {
    // صناعةُ initData صالحةٍ مضمَّنةً (خوارزميةُ WebAppData نفسُها — بلا استيرادٍ
    // عابرٍ للحزمِ): المفتاحُ من سرِّ الروبوتِ والتوقيعُ على سلسلةِ التحققِ.
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAHedgeports",
      user: JSON.stringify({ id: 111222333, first_name: "Edge" }),
    };
    const dataCheckString = Object.keys(fields)
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData")
      .update(ENV.CUSTOMER_BOT_TOKEN)
      .digest();
    const hash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");
    const initData = `${Object.entries(fields)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&")}&hash=${hash}`;

    const captured: CapturedCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      captured.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        headers: (init?.headers ?? {}) as Record<string, string>,
        ...(init?.body !== undefined ? { body: String(init.body) } : {}),
      });
      return new Response(
        JSON.stringify({
          token: "issued-session-token",
          wasla_public_id: "CUS-789",
          actor_type: "customer",
          expires_at: "2026-12-31T23:59:59Z",
          session_id: "sess-issued-1",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const bot = build();
      const response = await bot.app.inject({
        method: "POST",
        url: "/edge/session",
        headers: { origin: "https://apps.wasla.test" },
        payload: { init_data: initData },
      });

      // الجلسةُ صدرتْ — لا رفضَ initData ولا 500 من منفذٍ ثابتٍ.
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        token: "issued-session-token",
        wasla_public_id: "CUS-789",
      });

      // نداءٌ واحدٌ موقَّعٌ إلى identity/sessions — والمنفذُ يمرِّرُ بصمةَ
      // initData ومعرّفَ مستخدمِ القناةِ كما عُهِدَ.
      expect(captured).toHaveLength(1);
      expect(captured[0].url).toBe("http://identity.test/identity/sessions");
      const body = JSON.parse(captured[0].body ?? "{}");
      expect(body.telegram_user_id).toBe(111222333);
      expect(typeof body.init_data_fingerprint).toBe("string");

      // التوقيعُ حقيقيٌّ ويتحققُ فعليًّا — الجمهورُ `identity` والدورُ `customer-bot`
      // والربطُ بالطريقةِ والمسارِ.
      const issuePrincipal = verifyServiceToken(
        String(captured[0].headers["x-wasla-service-auth"]),
        {
          audience: "identity",
          method: "POST",
          path: "/identity/sessions",
          keys: TEST_KEYS,
          now: new Date(),
        },
      );
      expect(issuePrincipal.serviceName).toBe("customer-bot");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("الاستبدالُ عبرَ مغلفٍّ حولَ createChannelEdge الحقيقيِّ بمنافذِ الإنتاجِ نفسِها: النداءانِ موقَّعانِ والمعاملُ معوَّضٌ والاستعلامُ محفوظٌ والتوقيعانِ يتحققانِ", async () => {
    // المغلفُّ: منافذُ الإنتاجِ الحقيقيةُ (buildCustomerBotSessionPorts — النداءاتُ
    // الموقَّعةُ إلى identity كما في التركيبِ لا نسخةً) + createChannelEdge الحقيقيُّ
    // بقائمةِ سماحٍ ووجهةِ اختبارٍ معزولةٍ. الإنتاجُ ثابتٌ — لا حقنَ في التركيبِ.
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
      const ports = buildCustomerBotSessionPorts({
        identityUrl: "http://identity.test",
        env: ENV,
      });
      // تطبيقُ البوتِ الحقيقيُّ بلا حدٍّ (buildApp لا buildAppWithEdge) — والمغلفُّ
      // يطبِّقُ الحدَّ الحقيقيَّ عليه: لا استيرادَ fastify عابرًا للحزمِ.
      const bot = buildApp({
        env: ENV,
        channel: new MockChannelAdapter(),
        identity: new FakeIdentityBootstrap("WS-1000"),
        logger: false,
      });
      const edge = createChannelEdge({
        surface: {
          actorType: "customer",
          botToken: ENV.CUSTOMER_BOT_TOKEN,
          requestSigner: ports.sessionSigner,
          waslaPublicIdOf: async () => "",
        },
        issueSession: ports.issueSession,
        exchangeSession: ports.exchangeSession,
        revokeSession: ports.revokeSession,
        allowlistUrl: join(
          dirname(fileURLToPath(import.meta.url)),
          "fixtures/edge-allowlist-exchange-fixture.json",
        ),
        upstreams: {
          customers: {
            baseUrl: "http://customers.test",
            requestSigner: customersUpstreamSigner,
          },
        },
        enabled: true,
        allowedOrigins: ["https://apps.wasla.test"],
      });
      edge.apply(bot.app);
      await bot.app.ready();

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

      // نداءانِ: الاستبدالُ (identity · منفذُ الإنتاجِ الحقيقيُّ) ثمَّ الخدمةُ.
      expect(captured).toHaveLength(2);
      expect(captured[0].url).toBe("http://identity.test/identity/sessions/exchange");
      // مسارُ المدخلِ يُمرَّرُ كما هو (المعاملُ معوَّضٌ والاستعلامُ محفوظٌ).
      expect(captured[1].url).toBe(
        "http://customers.test/edge/test/customers/CUS-456/profile?include=places",
      );

      // توقيعُ الاستبدالِ حقيقيٌّ ويتحققُ — منفذُ الإنتاجِ نفسُه: الجمهورُ `identity`
      // والدورُ `customer-bot` والربطُ بالطريقةِ والمسارِ وجسمُ الطلبِ بالرمزِ والجمهورِ.
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
      expect(JSON.parse(captured[0].body ?? "{}")).toEqual({
        session_token: "a-live-session-token",
        audience: ["customers"],
      });

      // توقيعُ نداءِ الخدمةِ حقيقيٌّ ويتحققُ على المسارِ الخامِّ معَ استعلامِهِ —
      // و`obo` يحملُ هويةَ الجلسةِ (CUS-456) وتأكيدُ المستخدمِ يُمرَّرُ كما عُهِدَ.
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
      expect(captured[1].headers["X-Wasla-User-Assertion"]).toBe(
        "assertion-exchange-test",
      );
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
