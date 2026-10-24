/**
 * اختباراتُ منافذِ الجلسةِ عبرَ تركيبِ البوتِ لا الحزمةِ وحدَها — الاستبدالُ
 * والسحبُ نداءانِ حقيقيانِ موقَّعانِ إلى identity (لا استثناءانِ ثابتانِ بعدَ
 * إصلاحِ التوجيهِ · 2026-10-24): يُقاسُ أنَّ مسارَ الخروجِ يصلُ الخدمةَ بتوقيعٍ
 * حقيقيٍّ وبجمهورِ الهويةِ، وأنَّ الرفضَ المتوقعَ (جلسةٌ مجهولةٌ · 404) يُعلَنُ
 * نتيجةً لا انفجارًا.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
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
      // جسمُ الطلبِ يحملُ الرمزَ والسببَ كما عُهِدَ.
      expect(JSON.parse(captured[0].body ?? "{}")).toEqual({
        session_token: "a-live-session-token",
        reason: "user_requested",
      });
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
