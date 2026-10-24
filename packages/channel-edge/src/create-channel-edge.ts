/**
 * `create-channel-edge.ts` — بناءُ إضافاتِ الحدِّ المُركَّبةِ في `createBotApp`.
 *
 * **لا يبدأُ ترتيبُ الاستيرادِ هذا مُصغيًّا ولا عمليةً.** الحدُّ إضافاتُ
 * مساراتٍ تُركَّبُ في تطبيقِ الروبوتِ القائمِ (ADR-069 §3)، ولا يُفعِّلُ
 * التركيبُ شيئًا في الإنتاجِ ما لم يُصرَّحْ له بـ`WASLA_EDGE_ENABLED=true`
 * في `env-registry` (M2-04). والقوائمُ الحاليةُ كلُّها `production_open=false`
 * عمدًا — فحتى التركيبُ لا يفتحُ مسارًا حيًّا.
 *
 * **الأصلُ السياديُّ:** كلُّ مسارٍ يُفتحُ يمرُّ بقائمةِ السماحِ المصرَّحِ بها
 * (`packages/channel-edge/allowlist/<surface>.json`) وحارسِ الفحصِ 28
 * (`scripts/checks/validate-edge-allowlist.sh`). ولا مسارَ يُفتحُ لغيرِ
 * فئةِ `O` (ملكيةٌ بـ`obo`) بلا بوابةِ مالكٍ مستقلةٍ (ADR-069 §2.8).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ServiceRequestSigner } from "@wasla/service-auth";
import {
  fingerprintInitData,
  InitDataError,
  verifyTelegramInitData,
  type TelegramInitDataUser,
  type VerifiedInitData,
} from "@wasla/telegram-adapter";
import type { EdgeActorType, EdgeSurface } from "./types.js";

/** بناءُ إضافاتِ الحدِّ على تطبيقِ Fastifyِ مُركَّبٍ في `createBotApp`. */
export interface ChannelEdgeOptions {
  readonly surface: EdgeSurface;
  /** إصدارُ الجلسةِ (POST /identity/sessions). */
  readonly issueSession: IssueSessionPort;
  /** استبدالُ الجلسةِ (POST /identity/sessions/exchange). */
  readonly exchangeSession: ExchangeSessionPort;
  /** سحبُ الجلسةِ (POST /identity/sessions/revoke). */
  readonly revokeSession: RevokeSessionPort;
  /**
   * التحقّقُ من رمزِ جلسةٍ من النواةِ (GET /v1/sessions/current · XR-6.1).
   *
   * اختياريّ عمدًا: حينَ لا يُمرَّر، لا يُسجَّلُ مسارُ الويبِ أصلاً (fail-closed
   * بالعدمِ لا بالرفضِ) — فالجسرُ بلا نواةٍ موصولةٍ ليس ميزةً معطّلةً بل مسارٌ غير
   * موجود. المُركِّبُ (bots/*) هو من يقرأُ عنوانَ النواةِ من البيئةِ لا من هنا.
   */
  readonly coreIntrospect?: CoreIntrospectPort;
  /**
   * تسويةُ الهويةِ من رابطِ القناةِ (POST /identity/resolve · نفسَ ما يفعلُهُ البوتُ
   * عندَ أولِ لقاءٍ). اختياريّ بنفسِ حكمِ `coreIntrospect`.
   */
  readonly resolveIdentity?: ResolveIdentityPort;
  /**
   * **مُهملتانِ (للتوافقِ الخلفيِّ فقط):** كانَتا وجهةَ التوجيهِ وموقِّعَهُ،
   * وصارَ التوجيهُ حصرًا عبرَ `upstreams` (العقدُ الواحدُ وجهةً وموقِّعًا).
   * بقيتا اختياريتينِ لأنَّ `bots/driver-bot/src/edge.ts` **مجمَّدٌ** بقرارِ
   * XR-1.1 (ADR-076 · مجالُ MOVE ملكُ nooonvg/ceezr) فلا يُعدَّلُ إلا بحذفٍ أو
   * إيداعٍ موسومٍ — يمرِّرُهُما فيُجهَلانِ، ولا يُقرأُ لهما موضعٌ في التنفيذِ.
   * تُحذفانِ حينَ تُرحَّلْ برمجةُ بوتِ السائقِ أو يُفتَحْ استثناءٌ بقرارٍ.
   */
  readonly identityUrl?: string;
  /** @deprecated مُهملةٌ — التوجيهُ عبرَ `upstreams` وحدها (انظر `identityUrl`). */
  readonly requestSigner?: ServiceRequestSigner;
  /**
   * وجهاتُ الخدماتِ للتوجيهِ — العنوانُ والموقِّعُ عقدٌ واحدٌ لكلِّ خدمةٍ لا
   * يُجزَّآنِ: توقيعٌ بجمهورِ `identity` لا يصحُّ لنداءٍ يذهبُ إلى `customers`.
   * **لا وجهةَ احتياطيةَ**: مدخلٌ مفتوحٌ (`production_open=true`) لخدمةٍ بلا
   * وجهةٍ موصولةٍ هنا **يفشلِ التركيبُ بخطأِ تهيئةٍ صريحٍ** — لا يُخمَّنُ وجهةٌ
   * ولا يُعادُ التوجيهُ إلى الهويةِ. المدخلُ المغلقُ لا يحتاجُ وجهةً. والخريطةُ
   * اختياريةٌ للسطحِ الذي لا يفتحُ مسارًا (الحالةُ القائمةُ كلُّها).
   */
  readonly upstreams?: Readonly<Record<string, EdgeUpstream>>;
  /** أصلُ المسارِ المسموحُ لقائمةِ السماحِ — يُقرأُ من ملفِ الحدِّ. */
  readonly allowlistUrl: string;
  /** مفتاحُ التفعيلِ — لا يُقرأُ من جسمِ الطلبِ ولا الترويساتِ. */
  readonly enabled: boolean;
  /** مفاتيحُ السماحِ المُطابِقةُ لما تُصرِّحُ بهِ قائمةُ الحدِّ لا أكثرَ. */
  readonly allowedOrigins: readonly string[];
  /** ساعةٌ الآنَ — تُستعملُ في الفحصِ لا في التوقيعِ (نفسُ مفاتيحِ الروبوتِ). */
  readonly now?: () => Date;
  /** عدَّادُ المعدلِ على `POST /edge/session` لكلِ `telegram_user_id`. */
  readonly rateLimiter?: EdgeRateLimiter;
}

/** منفذُ إصدارِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface IssueSessionPort {
  (body: IssueSessionRequest): Promise<IssueSessionResponse>;
}

/**
 * وجهةُ خدمةٍ واحدةٍ للتوجيهِ — قاعدةُ العنوانِ وموقِّعُ نداءاتِها عقدٌ واحد.
 * العنوانُ من التهيئةِ الخادميةِ فقط، والموقِّعُ بجمهورِ الخدمةِ وصلاحياتِها
 * المصرَّحِ بها — لا تُولَّدُ صلاحيةٌ من `required_scopes` ولا يُوسَّعُ منحٌ
 * ليخضرَّ اختبارٌ (ADR-069 §2.6-6).
 */
export interface EdgeUpstream {
  /** قاعدةُ عنوانِ الخدمةِ — من التركيبِ لا من قائمةِ السماحِ. */
  readonly baseUrl: string;
  /** مُوقِّعُ نداءاتِ هذهِ الخدمةِ — بجمهورِها المصرَّحِ بهِ. */
  readonly requestSigner: ServiceRequestSigner;
}

/**
 * رفضُ جلسةٍ متوقعٌ (رمزٌ مجهولٌ أو منتهٍ) — يرميهِ منفذُ الاستبدالِ ليردَّ
 * الحدُّ عليهِ بـ401 مسمًّى، لا استثناءً عامًّا يتحولُ 500 عندَ المسارِ.
 */
export class EdgeSessionRejectedError extends Error {
  override readonly name = "EdgeSessionRejectedError";
}

/** منفذُ استبدالِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface ExchangeSessionPort {
  (body: ExchangeSessionRequest): Promise<ExchangeSessionResponse>;
}

/** منفذُ سحبِ الجلسةِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface RevokeSessionPort {
  (body: RevokeSessionRequest): Promise<RevokeSessionResponse>;
}

/** منفذُ التحقّقِ من جلسةِ النواةِ (GET /v1/sessions/current · XR-6.1). */
export interface CoreIntrospectPort {
  (coreAccessToken: string): Promise<CoreCurrentSession>;
}

/** ما تُجيبُ بهِ النواةُ عن `GET /v1/sessions/current` — الجزءُ الذي يقرأُهُ الجسرُ. */
export interface CoreCurrentSession {
  /** مُعرّفُ جلسةِ النواةِ — يُشتقُّ منهُ البصمةُ (منعُ الإعادةِ 1:1). */
  readonly session_id: string;
  /** روابطُ قنواتِ الهويةِ — منها يُقرأُ رابطُ تيليجرامِ (`tg-<معرّف>`). */
  readonly channel_links?: readonly CoreChannelLink[];
}

/** رابطُ قناةٍ واحدٍ كما تُعيدهُ النواةُ. */
export interface CoreChannelLink {
  readonly channel_type: string;
  readonly external_id: string;
  readonly verified_at?: string | null;
}

/** منفذُ تسويةِ الهويةِ (POST /identity/resolve) — إيجادٌ أو إنشاءٌ، لا جلستانِ. */
export interface ResolveIdentityPort {
  (body: ResolveIdentityRequest): Promise<ResolveIdentityResponse>;
}

/** عقدُ `POST /identity/resolve` — نفسُ ما يستدعيهُ البوتُ عندَ أولِ لقاءٍ. */
export interface ResolveIdentityRequest {
  readonly telegram_user_id: number;
  readonly telegram_username?: string;
  readonly telegram_first_name?: string;
  readonly telegram_language_code?: string;
}

/** ردُّ `POST /identity/resolve` — الجزءُ الذي يقرأُهُ الجسرُ. */
export interface ResolveIdentityResponse {
  readonly wasla_public_id: string;
  readonly created: boolean;
}

/** عقدُ `POST /identity/sessions` (نفسُ عقدِ identity · CLM-0519). */
export interface IssueSessionRequest {
  readonly telegram_user_id: number;
  readonly init_data_fingerprint: string;
  readonly telegram_username?: string;
  readonly telegram_first_name?: string;
  readonly telegram_language_code?: string;
}

/** ردُّ `POST /identity/sessions` (نفسُ عقدِ identity · CLM-0519). */
export interface IssueSessionResponse {
  readonly token: string;
  readonly wasla_public_id: string;
  readonly actor_type: EdgeActorType;
  readonly expires_at: string;
  readonly session_id: string;
}

/** عقدُ `POST /identity/sessions/exchange` (نفسُ عقدِ identity · CLM-0519). */
export interface ExchangeSessionRequest {
  readonly session_token: string;
  readonly audience: readonly string[];
}

/** ردُّ `POST /identity/sessions/exchange` (نفسُ عقدِ identity · CLM-0519). */
export interface ExchangeSessionResponse {
  readonly assertion: string;
  readonly wasla_public_id: string;
  readonly actor_type: EdgeActorType;
  readonly audience: readonly string[];
  readonly expires_at: string;
}

/** عقدُ `POST /identity/sessions/revoke` (نفسُ عقدِ identity · CLM-0519). */
export interface RevokeSessionRequest {
  readonly session_token: string;
  readonly reason?: string;
}

/** ردُّ `POST /identity/sessions/revoke` (نفسُ عقدِ identity · CLM-0519). */
export interface RevokeSessionResponse {
  readonly revoked: boolean;
}

/** عدَّادُ المعدلِ — يُمرَّرُ من التركيبِ لا من هنا. */
export interface EdgeRateLimiter {
  check(telegramUserId: number, ip: string): boolean;
}

const DEFAULT_INIT_DATA_MAX_AGE_SECONDS = 900;
const DEFAULT_INIT_DATA_CLOCK_SKEW_SECONDS = 60;

/** أسماءُ الترويساتِ التي يُحذفُها الحدُّ قبلَ التوجيهِ (ADR-069 §2.6-2). */
const STRIPPED_INBOUND_HEADERS = [
  "x-wasla-service-auth",
  "x-wasla-user-assertion",
  "x-customer-public-id",
  "authorization",
] as const;

/** بناءُ إضافاتِ الحدِّ (تُركَّبُ في `createBotApp` بعدَ حارسِ الفحصِ 24 و28). */
export function createChannelEdge(options: ChannelEdgeOptions): ChannelEdgeAdditionsImpl {
  if (!options.enabled) {
    // معطَّلٌ افتراضيًّا في الإنتاجِ: لا مسارَ يُسجَّلُ أصلاً — وهو أصحُّ تعطيلٍ
    // (fail-closed) لأنّ مسارًا غيرَ موجودٍ لا يمكنُ أن يُفتحَ لا بجسمٍ ولا
    // بترويسةٍ ولا بإعادةِ كتابةٍ.
    return { apply: () => undefined, enabled: false };
  }
  const now = options.now ?? (() => new Date());
  const surface = options.surface;
  return {
    enabled: true,
    apply: (app: FastifyInstance) => {
      applySessionRoutes(app, options, surface, now);
      applyProxyRoutes(app, options, surface);
    },
  };
}

/** ما يعيدُهُ `createChannelEdge` إلى التركيبِ (عقدٌ قابلٌ للقراءةِ لا منطقٌ). */
export interface ChannelEdgeAdditionsImpl {
  /** يُركَّبُ على تطبيقِ Fastifyِ القائمِ. */
  readonly apply: (app: FastifyInstance) => void;
  /** هل الحدُّ مُفعَّلٌ في هذا التركيبِ؟ (`false` في الإنتاجِ افتراضيًّا). */
  readonly enabled: boolean;
}

/**
 * تصنيفُ هويةِ الخدمةِ لمساراتِ الحدِّ: `open` — لا برمزِ خدمةٍ. حمايةُ هذهِ
 * المساراتِ آليّتُها الخاصةُ (توقيعُ `initData` بسرِّ الروبوتِ · رمزُ الجلسةِ
 * المستبدَلُ) كما أنَّ حمايةَ الـwebhook سرُّهُ (ADR-007) — فلو فُرضَ عليها
 * `service-auth` لَرُدَّ كلُّ نداءِ متصفحٍ بـ401. والتصنيفُ صريحٌ لا صمتٌ،
 * لأنَّ حارسَ التركيبِ يُسقِطُ المسارَ غيرَ المُصنَّفِ (M1-07).
 */
const OPEN_SERVICE_IDENTITY = { serviceIdentity: "open" } as const;

/** بناءُ مساراتِ إصدارِ الجلسةِ (`POST /edge/session` و`/logout`). */
function applySessionRoutes(
  app: FastifyInstance,
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
  now: () => Date,
): void {
  // POST /edge/session — إصدارُ جلسةٍ من `initData` موقَّعٍ (ADR-069 §2.1).
  app.post("/edge/session", { config: OPEN_SERVICE_IDENTITY }, async (request, reply) => {
    assertAllowedOrigin(request, options.allowedOrigins);
    const body = request.body as { init_data?: unknown };
    const raw = typeof body?.init_data === "string" ? body.init_data : "";
    if (!raw) {
      return deny(reply, 400, "EDGE_INVALID_REQUEST", "init_data مطلوب");
    }
    // ADR-069 §2.6-3: التحققُّ من `initData` بسرِّ الروبوتِ الصاحبِ للسطحِ.
    let verified: VerifiedInitData;
    try {
      verified = verifyTelegramInitData(raw, surface.botToken, {
        now: now(),
        maxAgeSeconds: DEFAULT_INIT_DATA_MAX_AGE_SECONDS,
        clockSkewSeconds: DEFAULT_INIT_DATA_CLOCK_SKEW_SECONDS,
      });
    } catch (error) {
      if (error instanceof InitDataError) {
        return deny(reply, 401, "EDGE_INIT_DATA_INVALID", error.message);
      }
      throw error;
    }
    const user = verified.user as TelegramInitDataUser;
    if (!user || typeof user.id !== "number" || user.id <= 0) {
      return deny(reply, 401, "EDGE_INIT_DATA_INVALID", "init_data مفقود user.id");
    }
    if (options.rateLimiter && !options.rateLimiter.check(user.id, request.ip)) {
      return deny(reply, 429, "EDGE_RATE_LIMITED", "تجاوز حد المعدل");
    }
    const issued = await options.issueSession({
      telegram_user_id: user.id,
      init_data_fingerprint: fingerprintInitData(raw),
      ...(user.username !== undefined ? { telegram_username: user.username } : {}),
      ...(user.firstName !== undefined ? { telegram_first_name: user.firstName } : {}),
      ...(user.languageCode !== undefined
        ? { telegram_language_code: user.languageCode }
        : {}),
    });
    if (issued.actor_type !== surface.actorType) {
      // E-16: جلسةُ سائقٍ على حدِّ العميلِ (أو العكسِ) تُرفضُ فورًا.
      return deny(reply, 401, "EDGE_ACTOR_MISMATCH", "الفاعل لا يطابق السطح");
    }
    return reply.status(201).send({
      token: issued.token,
      wasla_public_id: issued.wasla_public_id,
      expires_at: issued.expires_at,
      session_id: issued.session_id,
    });
  });

  // POST /edge/session/web — تبديلُ جلسةِ ويبٍ من النواةِ بجلسةِ السوقِ (XR-6.1).
  //
  // لا يُسجَّلُ المسارُ أصلاً ما لم يُمرَّر المنفذانِ (fail-closed بالعدمِ): الجسرُ
  // بلا نواةٍ موصولةٍ ليس ميزةً معطّلةً بل مسارٌ غيرُ موجودٍ لا يُفتحُ بجسمٍ ولا
  // بترويسةٍ. والمصدرُ الوحيدُ لثقةِ الويبِ هو النواةُ (D-XR-9) — لا يُخترَعُ
  // هنا تحقّقٌ ثانٍ ولا يُوقَّعُ شيءٌ بسرِّ الروبوتِ.
  if (options.coreIntrospect !== undefined && options.resolveIdentity !== undefined) {
    app.post("/edge/session/web", { config: OPEN_SERVICE_IDENTITY }, async (request, reply) => {
      assertAllowedOrigin(request, options.allowedOrigins);
      const body = request.body as { core_access_token?: unknown };
      const coreToken = typeof body?.core_access_token === "string" ? body.core_access_token : "";
      if (!coreToken) {
        return deny(reply, 400, "EDGE_INVALID_REQUEST", "core_access_token مطلوب");
      }
      // 1) التحقّقُ من الرمزِ عندَ مُصدِرِهِ (النواة) لا عندَنا — رفضُها مسمّى واحدٌ
      // مهما كانَ السببُ الداخليُّ، فلا يُفصَحُ لشبكةٍ عامّةٍ عن أخطاءِ الداخلِ.
      let core: CoreCurrentSession;
      try {
        core = await options.coreIntrospect!(coreToken);
      } catch {
        return deny(reply, 401, "EDGE_CORE_REJECTED", "رمز النواة غير مقبول");
      }
      // 2) رابطُ تيليجرامِ الموثّقُ وحدَهُ يفتحُ الجسرَ — `tg-<معرّف>` بمُعرّفٍ
      // رقميٍّ موجبٍ. رابطٌ غيرُ موثّقٍ أو قناةٌ أخرى ليست مفتاحَ دخولٍ هنا.
      const link = (core.channel_links ?? []).find(
        (l) => l.channel_type === "telegram" && l.verified_at != null,
      );
      const match = link ? /^tg-(\d+)$/.exec(link.external_id) : null;
      const telegramUserId = match ? Number(match[1]) : 0;
      if (!match || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
        return deny(reply, 401, "EDGE_CORE_REJECTED", "لا رابط تيليجرام موثق في الجلسة");
      }
      // 3) عدّادُ المعدلِ على مُعرّفِ تيليجرامِ نفسِهِ — لا على رمزٍ يُولَدُ من جديدٍ.
      if (options.rateLimiter && !options.rateLimiter.check(telegramUserId, request.ip)) {
        return deny(reply, 429, "EDGE_RATE_LIMITED", "تجاوز حد المعدل");
      }
      // 4) تسويةُ الهويةِ عندَ البوتِ نفسِهِ: من دخلَ الويبَ أولَ مرةٍ يُنشأُ كما
      // يُنشأُ من كلّمَ البوتَ أولَ مرةٍ — نفسُ الفعلِ (`/identity/resolve`) لا
      // فعلٌ موازٍ يُنتجُ نظامَ مستخدمينَ ثانيًا.
      await options.resolveIdentity!({ telegram_user_id: telegramUserId });
      // 5) بصمةُ الجلسةِ: sha256 لمُعرّفِ جلسةِ النواةِ — جلسةُ نواةٍ واحدةٌ =
      // جلسةُ سوقٍ واحدةٌ (منعُ الإعادةِ بقيدِ القاعدةِ الفريدِ نفسِهِ الذي يحرسُ
      // initData)، وصيغةُ الـ64 محرفًا hex هي عقدُ عمودِ البصمةِ في identity.
      const fingerprint = createHash("sha256")
        .update(`core-web:${core.session_id}`)
        .digest("hex");
      const issued = await options.issueSession({
        telegram_user_id: telegramUserId,
        init_data_fingerprint: fingerprint,
      });
      if (issued.actor_type !== surface.actorType) {
        // E-16 نفسُهُ: جلسةُ سطحٍ على حدِّ سطحٍ آخرَ تُرفضُ فورًا.
        return deny(reply, 401, "EDGE_ACTOR_MISMATCH", "الفاعل لا يطابق السطح");
      }
      return reply.status(201).send({
        token: issued.token,
        wasla_public_id: issued.wasla_public_id,
        expires_at: issued.expires_at,
        session_id: issued.session_id,
      });
    });
  }

  // POST /edge/session/logout — سحبُ الجلسةِ (ADR-069 §2.5).
  app.post("/edge/session/logout", { config: OPEN_SERVICE_IDENTITY }, async (request, reply) => {
    assertAllowedOrigin(request, options.allowedOrigins);
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return deny(reply, 401, "EDGE_UNAUTHENTICATED", "رمز الجلسة مطلوب");
    }
    const token = authorization.slice("Bearer ".length);
    const revoked = await options.revokeSession({
      session_token: token,
      reason: "user_requested",
    });
    if (!revoked.revoked) {
      return deny(reply, 401, "EDGE_UNAUTHENTICATED", "الرمز مجهول أو منتهٍ");
    }
    return reply.status(200).send({ revoked: true });
  });
}

/** بناءُ مساراتِ التوجيهِ (الوكيلِ) — يُفتحُ ما تصرِّحُ بهِ قائمةُ السماحِ فقط. */
function applyProxyRoutes(
  app: FastifyInstance,
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
): void {
  // التوجيهُ من قائمةِ السماحِ المُصرَّحِ بها — لا استنتاجَ آليًّا من الفحصِ 24
  // (ADR-069 §2.6-6 r2). وغيرُ المدرجِ يُردُّ بـ404 قبلَ أيِّ نداءٍ خلفيٍّ (E-09).
  const allowlist = loadAllowlist(options.allowlistUrl, surface);
  if (allowlist.length === 0) {
    // لا مسارَ مفتوحًا في هذا التركيبِ — وهو الحالةُ القائمةُ في الإنتاجِ.
    return;
  }
  for (const entry of allowlist) {
    if (!entry.production_open) continue; // مسارٌ مسجَّلٌ للقياسِ لا للفتحِ.
    const upstream = options.upstreams?.[entry.service];
    if (upstream === undefined) {
      // لا وجهةَ احتياطيةَ ولا تخطيًا صامتًا: مدخلٌ مفتوحٌ بلا وجهةٍ موصولةٍ
      // خطأُ تهيئةٍ يُفشِلُ التركيبَ كي يقرأَهُ المشغِّلُ لا ليتعثرَ الطلبُ.
      throw new Error(
        `مدخلُ سماحٍ مفتوحٌ (${entry.method} ${entry.path}) بلا وجهةٍ موصولةٍ للخدمةِ «${entry.service}» — صِلْ upstreams.${entry.service} أو أغلِقِ المدخلَ؛ لا يُخمَّنُ وجهةٌ ولا يُوجَّهُ إلى الهويةِ.`,
      );
    }
    app.route({
      method: entry.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      url: entry.path,
      config: OPEN_SERVICE_IDENTITY,
      handler: async (request, reply) => {
        return proxyRequest(options, surface, entry, upstream, request, reply);
      },
    });
  }
}

/** مدخلُ قائمةِ السماحِ كما يُقرأُ من ملفِّ الحدِّ (ADR-069 §2.8). */
interface AllowlistEntry {
  readonly method: string;
  readonly path: string;
  readonly service: string;
  readonly class: "O" | "P" | "W" | "N" | "ADM";
  readonly required_scopes: readonly string[];
  readonly production_open: boolean;
}

/** قراءةُ قائمةِ السماحِ من ملفِّ الحدِّ — مصدرُ الحقيقةِ لا الشفرةُ. */
function loadAllowlist(allowlistUrl: string, surface: EdgeSurface): readonly AllowlistEntry[] {
  // قائمةُ السماحِ ملفٌّ يُقرأُ في زمنِ التركيبِ لا في زمنِ النداءِ، فلا
  // يمكنُ لطلبٍ أن يغيِّرَ ما يُفتحُ. والحارسُ 28 يُسقِطُ أيَّ انحرافٍ في CI.
  const raw = readFileSync(allowlistUrl, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const actorBySurface: Readonly<Record<EdgeActorType, readonly AllowlistEntry[]>> = {
    customer: entries.filter((e) => e.surface === "customer-mini-app"),
    driver: entries.filter((e) => e.surface === "driver-mini-app"),
  };
  return actorBySurface[surface.actorType] ?? [];
}

/** توجيهُ الطلبِ إلى وجهةِ الخدمةِ — بحذفِ الترويساتِ وصنعِ ترويساتِ النداءِ. */
async function proxyRequest(
  options: ChannelEdgeOptions,
  surface: EdgeSurface,
  entry: AllowlistEntry,
  upstream: EdgeUpstream,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  assertAllowedOrigin(request, options.allowedOrigins);
  // ADR-069 §2.6-2: الجلسةُ تُقرأُ قبلَ الحذفِ — الحدُّ يستعملُ الرمزَ
  // للاستبدالِ ثم يصنعُ ترويساتِ النداءِ بنفسِهِ؛ فلا يصلُ الخلفَ رمزُ المتصفحِ
  // ولا ترويسةٌ داخليةٌ واحدةٌ (الحذفُ يحرِسُ الطلبَ الواردَ نفسَهُ).
  const authorization = request.headers.authorization;
  for (const name of STRIPPED_INBOUND_HEADERS) {
    delete request.headers[name];
  }
  if (!authorization?.startsWith("Bearer ")) {
    return deny(reply, 401, "EDGE_UNAUTHENTICATED", "رمز الجلسة مطلوب");
  }
  const sessionToken = authorization.slice("Bearer ".length);
  // ADR-069 §2.1 (2): استبدالُ الجلسةِ بتأكيدٍ قصيرِ العمرِ ≤60 ث. ورفضُ الجلسةِ
  // المتوقعُ (مجهولةٌ أو منتهيةٌ) يُعلَنُهُ المنفذُ بـ`EdgeSessionRejectedError`
  // فيردُّ الحدُّ 401 مسمًّى — لا استثناءً عامًّا يتحولُ 500.
  let exchanged: ExchangeSessionResponse;
  try {
    exchanged = await options.exchangeSession({
      session_token: sessionToken,
      audience: [entry.service],
    });
  } catch (error) {
    if (error instanceof EdgeSessionRejectedError) {
      return deny(reply, 401, "EDGE_UNAUTHENTICATED", "الرمز مجهول أو منتهٍ");
    }
    throw error;
  }
  if (exchanged.actor_type !== surface.actorType) {
    return deny(reply, 401, "EDGE_ACTOR_MISMATCH", "الفاعل لا يطابق السطح");
  }
  // هدفُ الطلبِ كما سيُرسَل: المسارُ الخامُ بعدَ مطابقةِ المسارِ المسموحِ مع
  // استعلامِهِ — قيمُ المعاملاتِ بترميزِ العميلِ كما وردت، لا قالبَ القائمةِ
  // ولا فكًّا وإعادةَ ترميزٍ. ويُوقَّعُ ويُوجَّهُ الشيءُ نفسُهُ (عقدُ الموقِّعِ:
  // «هدفُ الطلبِ كما سيُرسَل — المسارُ مع استعلامِهِ» · RISK-0026)، فيتحققُ
  // المستقبِلُ من التوقيعِ على ما وصلهُ فعلًا.
  const rawUrl = request.raw.url ?? "/";
  const queryIndex = rawUrl.indexOf("?");
  const requestTarget =
    queryIndex === -1 || rawUrl.slice(queryIndex + 1) === ""
      ? rawUrl.slice(0, queryIndex === -1 ? undefined : queryIndex)
      : rawUrl;
  // ADR-069 §2.6-1: مصدرُ `obo` الوحيدُ هو `wasla_public_id` العائدُ من `exchange`.
  const headers = upstream.requestSigner(
    entry.method,
    requestTarget,
    exchanged.wasla_public_id,
  );
  headers["X-Wasla-User-Assertion"] = exchanged.assertion;
  headers["Content-Type"] = request.headers["content-type"] ?? "application/json";
  const target = `${upstream.baseUrl.replace(/\/$/, "")}/${requestTarget.replace(/^\//, "")}`;
  const response = await fetch(target, {
    method: entry.method,
    headers,
    ...(entry.method === "GET" || entry.method === "DELETE" ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  return reply.status(response.status).send(text ? safeJsonParse(text) : {});
}

/** ردُّ الرفضِ — لا سببَ داخليًّا ولا رمزَ ولا بصمةَ. */
function deny(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.status(status).send({ code, message });
}

/** التحققُّ من أصلِ الطلبِ — لا يُقبلُ إلا منشأُ الموقعِ الثابتِ (§2.6-7). */
function assertAllowedOrigin(request: FastifyRequest, allowedOrigins: readonly string[]): void {
  if (allowedOrigins.length === 0) return;
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    throw Object.assign(new Error("منشأ غير مسموح"), { statusCode: 403 });
  }
}

/** تحليلُ الجوابِ الخلفيِّ بلا رميٍّ على جوابٍ غيرِ JSON. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
