/**
 * `edge.ts` — تركيبُ `@wasla/channel-edge` في جذرِ تركيبِ البوتِ (customer-bot).
 *
 * **لماذا ملفٌّ منفصلٌ لا تعديلٌ في `server.ts`؟** جذرُ التركيبِ يحملُ كلَّ
 * الطبقاتِ معًا (القناةُ · النواةُ · الهويةُ) — وهذا الملفُّ يحملُ الحدَّ
 * وحدهُ. فمراجعُ التركيبِ يقرأُ عقدَ الحدِّ بلا قراءةِ ترتيبِ القناةِ كاملًا.
 *
 * **مُعطَّلٌ افتراضيًّا في الإنتاجِ:** `WASLA_EDGE_ENABLED` لا يُقرأُ من جسمِ
 * الطلبِ — فالتركيبُ بلا تفويضٍ صريحٍ لا يُسجِّلُ مسارًا حيًّا (fail-closed ·
 * ADR-069 §2.6-9).
 *
 * **جسرُ الويبِ (XR-6.1):** حينَ يُضبَطُ `WASLA_CORE_URL` يُسجَّلُ مسارُ تبديلِ
 * جلسةِ النواةِ بجلسةِ السوقِ (`POST /edge/session/web`)؛ وبغيابِهِ لا يُسجَّلُ
 * المسارُ أصلاً — الجسرُ بلا نواةٍ موصولةٍ مسارٌ غيرُ موجودٍ لا ميزةٌ معطَّلة.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";
import { createChannelEdge, EdgeSessionRejectedError } from "@wasla/channel-edge";
import { CHANNEL_SESSION_EDGE_SCOPES, CHANNEL_IDENTITY_SCOPES } from "@wasla/bot-runtime";
import { createServiceRequestSigner, keyRegistryFromEnv } from "@wasla/service-auth";

import { BOT } from "./server.js";

/** إضافاتُ التركيبِ لحزمةِ الحدِّ — تُمرَّرُ إلى `buildBotApp` لا إلى الشفرةِ. */
export interface CustomerBotEdgeOverrides extends BotRuntimeOverrides {
  /** عنوانُ استماعِ identity — لا يُقرأُ من جسمِ الطلبِ. */
  readonly identityServiceUrl?: string;
  /** عنوانُ النواةِ لجسرِ الويبِ (XR-6.1) — اختياريٌّ وبغيابِهِ لا مسارَ للويبِ. */
  readonly coreUrl?: string;
  /** مفتاحُ التفعيلِ — لا يُقرأُ من جسمِ الطلبِ ولا الترويساتِ. */
  readonly edgeEnabled?: boolean;
}

/**
 * تركيبُ الحدِّ على تطبيقِ البوتِ القائمِ.
 *
 * **لا يُفعِّلُ التركيبُ شيئًا حيًّا:** `WASLA_EDGE_ENABLED` غيرُ مضبوطٍ في
 * الإنتاجِ، وقائمةُ السماحِ الحاليةُ كلُّها `production_open=false` عمدًا
 * (CLM-0521). فالتركيبُ هنا يُسجِّلُ العقدَ لا الفتحَ.
 */
/**
 * منافذُ الجلسةِ الحقيقيةُ (إصدارٌ · استبدالٌ · سحبٌ) — نداءاتٌ موقَّعةٌ إلى
 * identity. **مُصدَّرةٌ عمدًا:** التركيبُ يستعملُها، واختبارُ التركيبِ يبني
 * حولَ `createChannelEdge` الحقيقيِّ مغلّفًا يمرِّرُها كما هي (لا نسخةً) مع
 * قائمةِ سماحٍ ووجهةِ اختبارٍ معزولةٍ — فالثقةُ المقيسةُ هي منافذُ الإنتاجِ
 * نفسُها لا محاكاةً لها.
 */
export function buildCustomerBotSessionPorts(options: {
  readonly identityUrl: string;
  readonly env: Record<string, string | undefined>;
}): {
  readonly sessionSigner: ReturnType<typeof createServiceRequestSigner>;
  readonly issueSession: NonNullable<
    Parameters<typeof createChannelEdge>[0]["issueSession"]
  >;
  readonly exchangeSession: NonNullable<
    Parameters<typeof createChannelEdge>[0]["exchangeSession"]
  >;
  readonly revokeSession: NonNullable<
    Parameters<typeof createChannelEdge>[0]["revokeSession"]
  >;
} {
  const { identityUrl, env } = options;
  const keys = keyRegistryFromEnv({
    WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
    WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
  });

  /** موقّعٌ بدرجةِ صلاحيةِ الجلساتِ (إصدارٌ واستبدالٌ وسحبٌ) — للحدِّ كاملًا. */
  const sessionSigner = createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: "identity",
    keys,
    scopes: CHANNEL_SESSION_EDGE_SCOPES,
  });
  return {
    sessionSigner,
    issueSession: async (body) => {
      const response = await fetch(`${identityUrl}/identity/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...sessionSigner("POST", "/identity/sessions"),
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { token?: unknown; wasla_public_id?: unknown; actor_type?: unknown; expires_at?: unknown; session_id?: unknown }
        | null;
      if (response.status !== 201 || !payload || typeof payload.token !== "string") {
        throw new Error(`identity sessions returned ${response.status}`);
      }
      const actorType = String(payload.actor_type ?? "");
      if (actorType !== "customer" && actorType !== "driver") {
        throw new Error(`identity sessions returned unknown actor_type`);
      }
      return {
        token: payload.token,
        wasla_public_id: String(payload.wasla_public_id ?? ""),
        actor_type: actorType,
        expires_at: String(payload.expires_at ?? ""),
        session_id: String(payload.session_id ?? ""),
      };
    },
    // ── استبدالُ الجلسةِ: نداءٌ حقيقيٌّ موقَّعٌ إلى identity (ADR-069 §2.1). ────
    // رفضُ الجلسةِ المتوقعُ (مجهولةٌ أو منتهيةٌ · 401/403 من identity) يُعلَنُ
    // بـ`EdgeSessionRejectedError` فيردُّ الحدُّ 401 مسمًّى — لا استثناءً عامًّا
    // يتحولُ 500 عندَ المسارِ.
    exchangeSession: async (body) => {
      const response = await fetch(`${identityUrl}/identity/sessions/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...sessionSigner("POST", "/identity/sessions/exchange"),
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) {
        throw new EdgeSessionRejectedError(
          `identity sessions/exchange returned ${response.status}`,
        );
      }
      if (response.status !== 200) {
        throw new Error(`identity sessions/exchange returned ${response.status}`);
      }
      const payload = (await response.json().catch(() => null)) as
        | { assertion?: unknown; wasla_public_id?: unknown; actor_type?: unknown; audience?: unknown; expires_at?: unknown }
        | null;
      if (!payload || typeof payload.assertion !== "string" || typeof payload.wasla_public_id !== "string") {
        throw new Error("identity sessions/exchange returned an malformed payload");
      }
      const actorType = String(payload.actor_type ?? "");
      if (actorType !== "customer" && actorType !== "driver") {
        throw new Error("identity sessions/exchange returned unknown actor_type");
      }
      return {
        assertion: payload.assertion,
        wasla_public_id: payload.wasla_public_id,
        actor_type: actorType,
        audience: Array.isArray(payload.audience) ? payload.audience.map(String) : [],
        expires_at: String(payload.expires_at ?? ""),
      };
    },
    // ── سحبُ الجلسةِ: نداءٌ حقيقيٌّ موقَّعٌ — مسارُ الخروجِ مسجَّلٌ فلا يبقى ──
    // منفذُهُ استثناءً ثابتًا. الجلسةُ المجهولةُ (404 من identity) نتيجةٌ
    // متوقعةٌ لا خطأٌ: تُعلَنُ { revoked: false } فيردُّ الحدُّ 401 مسمًّى.
    revokeSession: async (body) => {
      const response = await fetch(`${identityUrl}/identity/sessions/revoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...sessionSigner("POST", "/identity/sessions/revoke"),
        },
        body: JSON.stringify(body),
      });
      if (response.status === 404) {
        return { revoked: false };
      }
      if (response.status !== 200) {
        throw new Error(`identity sessions/revoke returned ${response.status}`);
      }
      const payload = (await response.json().catch(() => null)) as
        | { revoked?: unknown }
        | null;
      return { revoked: payload?.revoked === true };
    },
  };
}

/**
 * تركيبُ الحدّ على تطبيقِ البوتِ القائمِ.
 *
 * **لا يُفعّلُ التركيبُ شيئًا حيًّا:** `WASLA_EDGE_ENABLED` غيرُ مضبوطٍ في
 * الإنتاجِ، وقائمةُ السماحِ الحاليةُ كلّها `production_open=false` عمدًا
 * (CLM-0521). فالتركيبُ هنا يُسجّلُ العقدَ لا الفتحَ.
 */
export function buildAppWithEdge(overrides?: CustomerBotEdgeOverrides): BotApp {
  const app = buildBotApp(BOT, overrides);
  const env = (overrides?.env ?? process.env) as Record<string, string | undefined>;
  const identityUrl = overrides?.identityServiceUrl ?? env.IDENTITY_SERVICE_URL;
  const coreUrl = overrides?.coreUrl ?? env.WASLA_CORE_URL;
  const edgeEnabled =
    overrides?.edgeEnabled ?? env.WASLA_EDGE_ENABLED === "true";
  if (!edgeEnabled || !identityUrl) {
    // معطّلٌ افتراضيًّا — ولا مسارَ يُسجَّلُ أصلًا (fail-closed).
    return app;
  }
  const ports = buildCustomerBotSessionPorts({ identityUrl, env });

  /** موقّعٌ بدرجةِ صلاحيةِ حلِّ الهويةِ — لجسرِ الويبِ عندَ أولِ لقاءٍ. */
  const resolveSigner = createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: "identity",
    keys: keyRegistryFromEnv({
      WASLA_SERVICE_AUTH_KEYS: env.WASLA_SERVICE_AUTH_KEYS,
      WASLA_SERVICE_AUTH_ACTIVE_KID: env.WASLA_SERVICE_AUTH_ACTIVE_KID,
    }),
    scopes: CHANNEL_IDENTITY_SCOPES,
  });

  const edge = createChannelEdge({
    surface: {
      actorType: "customer",
      botToken: env.CUSTOMER_BOT_TOKEN ?? "",
      requestSigner: ports.sessionSigner,
      waslaPublicIdOf: async () => "",
    },
    // ── إصدارُ الجلسةِ: نداءٌ حقيقيٌّ إلى identity بنفسِ عقدِ initData. ──────
    // (كانَ رفضًا ثابتًا في هذا التركيبِ — جسرُ الويبِ يحتاجُهُ فعلًا، فصارَ
    // نداءً موقَّعًا حقيقيًّا بدرجةِ صلاحيةِ `identity:session:issue`.)
    issueSession: ports.issueSession,
    exchangeSession: ports.exchangeSession,
    revokeSession: ports.revokeSession,
    // ── جسرُ الويبِ (XR-6.1): التحقّقُ من رمزِ النواةِ عندَ مُصدِرِهِ. ──────
    // المصدرُ الوحيدُ لثقةِ الويبِ هو النواةُ (D-XR-9) — النداءُ هنا يمرِّرُ
    // الرمزَ كما هو ولا يوقِّعُهُ بسرِّ البوتِ ولا يخزِنُهُ.
    ...(coreUrl
      ? {
          coreIntrospect: async (coreAccessToken: string) => {
            const response = await fetch(
              `${coreUrl.replace(/\/+$/, "")}/v1/sessions/current`,
              {
                method: "GET",
                headers: { authorization: `Bearer ${coreAccessToken}` },
              },
            );
            if (response.status !== 200) {
              throw new Error(`core sessions/current returned ${response.status}`);
            }
            const payload = (await response.json()) as {
              session_id?: unknown;
              identity_id?: unknown;
              channel_links?: unknown;
            };
            return {
              session_id: String(payload.session_id ?? ""),
              // جيلُ النواةِ (CLM-0701 · إصلاحُ CLM-0703): النواةُ تعودُ بهِ في
              // كلِّ جلسةٍ مصادَقةٍ — إسقاطُهُ هنا أطفأَ ربطَ الجيلِ في الإنتاجِ
              // كاملًا (اختبارُ التركيبِ الحقيقيِّ هو الذي كشفَهُ لا اختبارُ
              // الحزمةِ). يُمرَّرُ كما جاءَ: حاضرًا أو غائبًا، لا مُخترَعًا.
              ...(typeof payload.identity_id === "string" && payload.identity_id !== ""
                ? { identity_id: payload.identity_id }
                : {}),
              channel_links: Array.isArray(payload.channel_links)
                ? (payload.channel_links as Array<Record<string, unknown>>).map((link) => ({
                    channel_type: String(link.channel_type ?? ""),
                    external_id: String(link.external_id ?? ""),
                    verified_at: link.verified_at == null ? null : String(link.verified_at),
                  }))
                : [],
            };
          },
          // تسويةُ الهويةِ عندَ أولِ لقاءٍ — نفسُ فعلِ البوتِ عندَ `/start`:
          // إيجادٌ أو إنشاءٌ، لا نظامُ مستخدمينَ ثانٍ.
          resolveIdentity: async (body) => {
            const response = await fetch(`${identityUrl}/identity/resolve`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...resolveSigner("POST", "/identity/resolve"),
              },
              body: JSON.stringify(body),
            });
            const payload = (await response.json().catch(() => null)) as
              | { wasla_public_id?: unknown; created?: unknown }
              | null;
            if ((response.status !== 200 && response.status !== 201) || !payload) {
              throw new Error(`identity resolve returned ${response.status}`);
            }
            return {
              wasla_public_id: String(payload.wasla_public_id ?? ""),
              created: payload.created === true,
            };
          },
        }
      : {}),
    // ── وجهاتُ التوجيهِ: لا شيءَ موصولًا اليومَ عمدًا ─────────────────────
    // قائمةُ السماحِ كلُّها مغلقةٌ (`production_open=false` · CLM-0521)، ولا منحَ
    // لبوتِ العميلِ على جمهورِ أيِّ خدمةٍ من خدماتِها بعدُ (مصفوفةُ M1-05). ففتحُ
    // أيِّ مدخلٍ يتطلّبُ أوّلًا وصلَ `upstreams.<service>` بعنوانِها وموقّعِها
    // المصرَّحِ — وإلّا فشلَ التركيبُ بخطأِ تهيئةٍ صريحٍ (لا وجهةَ احتياطيةَ
    // إلى الهويةِ ولا تخطيًا صامتًا).
    allowlistUrl: "packages/channel-edge/allowlist/customer-mini-app.json",
    enabled: true,
    allowedOrigins: [],
  });
  edge.apply(app.app);
  return app;
}
