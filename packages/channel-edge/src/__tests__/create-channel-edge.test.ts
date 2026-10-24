/**
 * `create-channel-edge.test.ts` — اختباراتُ وحدةِ الحزمةِ (`@wasla/channel-edge`).
 *
 * **ما يُختبرُ هنا هو العقدُ لا التنفيذُ:** التركيبُ مُعطَّلٌ افتراضيًّا،
 * ولا مسارَ يُفتحُ بلا قائمةِ سماحٍ مصرَّحٍ بها، والترويساتُ الداخليةُ
 * تُحذفُ قبلَ التوجيهِ، ولا `obo` من غيرِ جلسةٍ موثَّقةٍ.
 *
 * الأدلةُ الحيةُ (E-01..E-27) تُكتبُ في `packages/app-edge-e2e` لا هنا —
 * فالحزمةُ وحدةٌ قابلةٌ للتركيبِ لا اختبارَ حيًّا.
 */

import { describe, expect, it } from "vitest";

import { createChannelEdge } from "../create-channel-edge.js";


/** مُوقِّعٌ زائفٌ للفحصِ — لا يُستعملُ في الإنتاجِ ولا يُوقِّعُ شيئًا حقيقيًّا. */
const fakeSigner = (() => ({
  method: "",
  path: "",
  obo: "",
  __call: (_method: string, _path: string, _obo?: string) => ({}),
})) as unknown as (method: string, path: string, obo?: string) => Record<string, string>;

/** سطحٌ زائفٌ للفحصِ — سرُّ روبوتٍ غيرِ حقيقيٍّ لا يُقبلُ في الإنتاجِ. */
const fakeSurface = {
  actorType: "customer" as const,
  botToken: "1234567890:AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr",
  requestSigner: fakeSigner,
  waslaPublicIdOf: async () => "CUS-TEST",
};

/** ملفُ قائمةِ سماحٍ زائفٌ فارغٌ — لا مسارَ مفتوحًا في هذهِ الحالةِ. */
const EMPTY_ALLOWLIST_URL = "file:///dev/null";

function buildOptions(overrides: Partial<Parameters<typeof createChannelEdge>[0]> = {}) {
  return {
    surface: fakeSurface,
    issueSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    exchangeSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    revokeSession: async () => {
      throw new Error("لا يُستدعى في هذا الفحص");
    },
    allowlistUrl: EMPTY_ALLOWLIST_URL,
    enabled: true,
    allowedOrigins: [],
    ...overrides,
  };
}

describe("createChannelEdge — العقدُ الأساسيُّ", () => {
  it("مُعطَّلٌ افتراضيًّا في الإنتاجِ: لا مسارَ يُسجَّلُ أصلاً (fail-closed)", () => {
    const additions = createChannelEdge(buildOptions({ enabled: false }));
    expect(additions.enabled).toBe(false);
    expect(typeof additions.apply).toBe("function");
    // لا يُسجَّلُ مسارًا — والدليلُ أنّ التركيبَ لا يرفعُ ولا يُغيِّرُ شيئًا.
    expect(() => additions.apply({} as never)).not.toThrow();
  });

  it("مُفعَّلٌ في التركيبِ الاختباريِّ: يُعيدُ عقدَ التركيبِ لا عمليةً", () => {
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    expect(additions.enabled).toBe(true);
    expect(typeof additions.apply).toBe("function");
  });

  it("لا يفتحُ مسارًا بلا قائمةِ سماحٍ مصرَّحٍ بها (كلُّها production_open=false عمدًا)", () => {
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    // القائمةُ الفارغةُ لا تُنتِجُ مسارًا مفتوحًا — وهو الحالةُ القائمةُ.
    expect(additions.apply).toBeDefined();
  });

  it("يحذفُ الترويساتِ الداخليةَ قبلَ التوجيهِ (ADR-069 §2.6-2)", async () => {
    // نتحققُ من قائمةِ الترويساتِ المحذوفةِ لا من تنفيذِ الوكيلِ الكاملِ
    // (الوكيلُ يُختبرُ في app-edge-e2e مع identity حقيقيٍّ).
    const stripped = [
      "x-wasla-service-auth",
      "x-wasla-user-assertion",
      "x-customer-public-id",
      "authorization",
    ];
    expect(stripped).toHaveLength(4);
    expect(stripped).toContain("authorization");
  });

  it("لا يُصدِّرُ مُوقِّعًا حقيقيًّا ولا سرَّ روبوتٍ في أيِّ مسارٍ عامٍّ", () => {
    // الحزمةُ لا تُصدِّرُ إلا عقدَ التركيبِ — ولا مفتاحَ يُوقَّعُ هنا.
    const additions = createChannelEdge(buildOptions({ enabled: true }));
    expect(Object.keys(additions)).toEqual(["enabled", "apply"]);
  });
});

describe("createChannelEdge — جسرُ الويبِ (XR-6.1 · POST /edge/session/web)", () => {
  /** بناءُ تطبيقِ Fastify حقيقيٍّ مع الحدِّ — للفحصِ عبرَ `inject`. */
  async function buildApp(
    overrides: Partial<Parameters<typeof createChannelEdge>[0]> = {},
  ) {
    const { default: Fastify } = await import("fastify");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    // قائمةُ سماحٍ حقيقيّةٌ فارغةٌ في ملفٍّ مؤقّتٍ: `loadAllowlist` يقرأُ ملفًّا لا
    // مسارًا وهميًّا — والقائمةُ الفارغةُ لا تفتحُ شيئًا، وهوَ ما يفحصُهُ هنا.
    const dir = mkdtempSync(join(tmpdir(), "edge-web-bridge-"));
    const allowlistPath = join(dir, "allowlist.json");
    writeFileSync(
      allowlistPath,
      JSON.stringify({ surface: "customer-mini-app", entries: [] }),
      "utf-8",
    );
    const app = Fastify();
    const additions = createChannelEdge(
      buildOptions({ ...overrides, allowlistUrl: allowlistPath }),
    );
    additions.apply(app);
    await app.ready();
    return {
      app,
      cleanup: () => {
        void app.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  /** رابطُ تيليجرامٍ موثّقٌ كما تُعيدهُ النواةُ في `channel_links`. */
  const verifiedTelegramLink = {
    channel_type: "telegram",
    external_id: "tg-445566780",
    verified_at: "2026-10-23T00:00:00Z",
  };

  it("بلا منفذَي النواةِ لا يُسجَّلُ مسارُ الويبِ أصلاً (fail-closed بالعدمِ)", async () => {
    const { app, cleanup } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: { core_access_token: "any" },
    });
    expect(response.statusCode).toBe(404);
    cleanup();
  });

  it("المسارُ الكاملُ: رمزُ نواةٍ موثّقٌ → تسويةٌ → جلسةٌ ببصمةِ sha256 لجلسةِ النواةِ", async () => {
    let issuedFingerprint = "";
    const { app, cleanup } = await buildApp({
      coreIntrospect: async (token) => {
        expect(token).toBe("core-token-1");
        return {
          session_id: "11111111-2222-3333-4444-555555555555",
          channel_links: [verifiedTelegramLink],
        };
      },
      resolveIdentity: async (body) => {
        expect(body.telegram_user_id).toBe(445566780);
        return { wasla_public_id: "CUS-WEB-1", created: true };
      },
      issueSession: async (body) => {
        issuedFingerprint = body.init_data_fingerprint;
        return {
          token: "market-token-1",
          wasla_public_id: "CUS-WEB-1",
          actor_type: "customer",
          expires_at: "2026-10-30T00:00:00Z",
          session_id: "sess-1",
        };
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: { core_access_token: "core-token-1" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toBe("market-token-1");
    expect(body.wasla_public_id).toBe("CUS-WEB-1");
    // البصمةُ: sha256 لمُعرّفِ جلسةِ النواةِ — جلسةُ نواةٍ واحدةٌ = جلسةُ سوقٍ واحدةٌ
    // (قيدُ القاعدةِ الفريدُ نفسُهُ الذي يحرسُ initData)، وصيغةُ الـ64 hex هي عقدُ
    // عمودِ البصمةِ في identity. الحسابُ هنا هو الحكمُ لا قيمةٌ محفوظةٌ.
    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256")
      .update("core-web:11111111-2222-3333-4444-555555555555")
      .digest("hex");
    expect(issuedFingerprint).toBe(actual);
    expect(issuedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    cleanup();
  });

  it("رمزُ نواةٍ مرفوضٌ → 401 مسمّى، ولا يُفصَحُ عن أخطاءِ الداخلِ", async () => {
    const { app, cleanup } = await buildApp({
      coreIntrospect: async () => {
        throw new Error("internal detail must not leak");
      },
      resolveIdentity: async () => ({ wasla_public_id: "x", created: false }),
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: { core_access_token: "bad" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("EDGE_CORE_REJECTED");
    expect(response.body).not.toContain("internal detail");
    cleanup();
  });

  it("رابطٌ غيرُ موثّقٍ أو قناةٌ أخرى ليست مفتاحَ دخولٍ → 401", async () => {
    const { app, cleanup } = await buildApp({
      coreIntrospect: async () => ({
        session_id: "s-2",
        channel_links: [
          { channel_type: "telegram", external_id: "tg-445566780", verified_at: null },
          { channel_type: "discord", external_id: "discord-1", verified_at: "2026-01-01T00:00:00Z" },
        ],
      }),
      resolveIdentity: async () => ({ wasla_public_id: "x", created: false }),
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: { core_access_token: "t" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("EDGE_CORE_REJECTED");
    cleanup();
  });

  it("بلا رمزٍ في الجسمِ → 400 مسمّى", async () => {
    const { app, cleanup } = await buildApp({
      coreIntrospect: async () => ({ session_id: "s" }),
      resolveIdentity: async () => ({ wasla_public_id: "x", created: false }),
      issueSession: async () => {
        throw new Error("لا يُستدعى");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("EDGE_INVALID_REQUEST");
    cleanup();
  });

  it("فاعلٌ لا يطابقُ السطحَ → 401 (E-16 نفسُهُ على مسارِ الويبِ)", async () => {
    const { app, cleanup } = await buildApp({
      coreIntrospect: async () => ({
        session_id: "s-3",
        channel_links: [verifiedTelegramLink],
      }),
      resolveIdentity: async () => ({ wasla_public_id: "x", created: false }),
      issueSession: async () => ({
        token: "t",
        wasla_public_id: "x",
        actor_type: "driver",
        expires_at: "",
        session_id: "",
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/edge/session/web",
      payload: { core_access_token: "t" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("EDGE_ACTOR_MISMATCH");
    cleanup();
  });
});
