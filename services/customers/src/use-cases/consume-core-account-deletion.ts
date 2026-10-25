/**
 * `use-cases/consume-core-account-deletion.ts` — مستهلِكُ حدثِ حذفِ حسابِ
 * النواةِ `core.identity.account.deleted` (CLM-0701 · استثناءُ ADR-076).
 *
 * الحدثُ يحملُ جيلَ الحسابِ المحذوفِ (`identity_id`) لا قناتِهِ — والربطُ في
 * خدمةِ الهويّةِ هو الذي يترجمُ الجيلَ إلى هويّةِ MARKET صاحبةِ البياناتِ.
 * هذا المستهلِكُ هو نصفُ الحقيقةِ في خدمةِ الزبائنِ: **تنقيةُ بياناتِ العميلِ**
 * (تسطيحُ اسمِ العرضِ وحذفُ الأماكنِ المحفوظةِ) ثمّ **تطبيقُ الحذفِ على
 * الهويّةِ** عبرَ `POST /identity/core-deletion` — بهذا الترتيبِ عمداً: الهويّةُ
 * المحجّرةُ ببياناتٍ ناجيةٍ عيبٌ، والبياناتُ المنقّاةُ بهويّةٍ حيّةِ جلسةٍ عيبٌ.
 *
 * ## الضماناتُ (نمطُ صندوقِ البريدِ القائمِ — لا لهجةً جديدة)
 *
 * - **الإغلاقُ المفردُ:** كلُّ حدثٍ يُحسَمُ مرةً واحدةً في صندوقٍ مملوكٍ
 *   (`core_account_deletion_inbox`) — إعادةُ إرسالِ حدثٍ حُسِمَ = `duplicate` بلا أثرٍ.
 * - **لا فقدَ أبدًا:** الحسمُ النهائيُّ (`applied`/`observed`/`poisoned`) وحدَهُ
 *   يُغلقُ الصفَّ. الجيلُ غيرُ المربوطِ خطأٌ **قابلٌ للإعادةِ** مسمّى
 *   (`unbound`) — الربطَ قد يصلُ بعدَ الحدثِ، فتسجيلُهُ نهائيًّا كانَ سيُفقِدُهُ.
 * - **السمُّ مسمّى:** حمولةٌ بلا `identity_id` صالحٍ = `poisoned` (نهائيٌّ، يُرى
 *   لا يُبلَعُ).
 * - **التصرّفُ الصريحُ لكلِّ فئةِ بياناتٍ:** التنقيةُ مُتماثِلةُ التكرارِ (إعادةُ
 *   الإرسالِ بعدَ انهيارٍ تعيدُها بلا أثرٍ زائدٍ)، وما يُبقَى مكتوبٌ في
 *   `disposition` لا مفترضٌ: طلباتُ الطلبِ (order_requests) تُبقَى بقرارِ المالكِ
 *   **المعلّقِ** المُسجَّلِ، وصندوقُ الأحداثِ (customer_outbox) يُبقَى أثراً
 *   للتدقيقِ.
 *
 * **وما لا يُنفَّذُ هنا عمدًا:** النقلُ (HTTP endpoint أو اقتراعٌ) — ذاكَ سلكُ
 * XR-4.3، وهذا الاستخدامُ يُختبرُ على PostgreSQL حقيقيةٍ ويتعلَّقُ بهِ السلكُ.
 */

import { createHash } from "node:crypto";

import type {
  ApplyCoreDeletionOutcome,
  CoreAccountDeletionInboxStore,
  IdentityDeletionPort,
} from "../ports.js";
import type { CustomerRepository } from "../ports.js";

/** نتيجةُ استهلاكِ حدثٍ واحدٍ — كلُّ احتمالٍ مسمّى. */
export type CoreAccountDeletionConsumeResult =
  | { readonly kind: "applied"; readonly waslaPublicId: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "unbound" }
  | { readonly kind: "poisoned"; readonly error: string }
  | { readonly kind: "error"; readonly error: string };

export interface ConsumeCoreAccountDeletionDeps {
  /** صندوقُ الاستهلاكِ المملوكُ لخدمةِ الزبائنِ. */
  readonly inbox: CoreAccountDeletionInboxStore;
  /** المستودعُ القائمُ — التنقيةُ عبرَ مسارِهِ لا مسارِ كتابةٍ ثانٍ. */
  readonly repo: CustomerRepository;
  /** منفذُ الهويّةِ: قراءةُ الربطِ ثمّ تطبيقُ الحذفِ. */
  readonly identity: IdentityDeletionPort;
}

/** مُغلّفُ الحدثِ كما يصلُ منَ الناقلِ — نفسُ عقدِ XR-3.5. */
export interface CoreAccountDeletionEnvelope {
  readonly event_id: string;
  readonly event_type: string;
  readonly payload: {
    readonly identity_id?: unknown;
    readonly principal_id?: unknown;
    readonly deleted_at?: unknown;
  };
  readonly correlation_id?: string | null;
}

/** ما تنقّيهِ التنقيةُ من بياناتِ العميلِ وما تُبقيهِ — مكتوبٌ لا مفترضٌ. */
const DISPOSITION_PURGED =
  "purged:profile_display_name,saved_places;" +
  "retained:order_requests(owner_decision_pending),customer_outbox(audit)";

/** نمطُ UUID كما يفهمُهُ PostgreSQL — الحارسُ قبلَ أيِّ لمسٍ للقاعدةِ. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * مفتاحٌ بديلٌ حتميٌّ لحدثٍ لا يملكُ `event_id` صالحًا — نفسُ حيلةِ صندوقِ
 * التوصيلِ: إعادةُ الإرسالِ تعيدُ إنتاجَ المفتاحِ نفسَهُ فلا يتضاعفُ السمُّ.
 */
function surrogateEventKey(rawEventId: string, rawEventType: string): string {
  const hex = createHash("sha256")
    .update(`core-account-deletion-poison\u0000${rawEventId}\u0000${rawEventType}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** الحسمُ النهائيُّ: ما لا تُعيدُهُ إعادةُ الإرسالِ. */
function isTerminal(consumedStatus: string): boolean {
  return (
    consumedStatus === "applied" ||
    consumedStatus === "observed" ||
    consumedStatus === "poisoned"
  );
}

export async function consumeCoreAccountDeletionEvent(
  deps: ConsumeCoreAccountDeletionDeps,
  envelope: CoreAccountDeletionEnvelope,
): Promise<CoreAccountDeletionConsumeResult> {
  // 0) حارسُ السمِّ قبلَ أيِّ لمسٍ للقاعدةِ: مفتاحُ حدثٍ ليسَ UUID يُسجَّلُ
  //    سمًّا بمفتاحٍ بديلٍ حتميٍّ لا استثناءً غيرَ معالَجٍ.
  const rawEventId = String(envelope.event_id ?? "");
  if (!UUID_RE.test(rawEventId)) {
    const rawType = String(envelope.event_type ?? "unknown").slice(0, 96);
    const surrogate = surrogateEventKey(rawEventId, rawType);
    await deps.inbox.recordTerminal({
      eventId: surrogate,
      eventType: rawType,
      coreIdentityId: null,
      consumedStatus: "poisoned",
      lastError: "invalid_event_id:not_a_uuid",
      disposition: null,
    });
    return { kind: "poisoned", error: "invalid_event_id:not_a_uuid" };
  }

  // 1) الإغلاقُ المفردُ: حدثٌ حُسِمَ نهائيًّا لا يُعالَجُ مرّةً ثانيةً. الحيُّ
  //    (pending/error) يُعادُ — لا فقدَ.
  const existing = await deps.inbox.find(envelope.event_id);
  if (existing !== null && isTerminal(existing.consumedStatus)) {
    return { kind: "duplicate" };
  }

  // 2) السمُّ وحدَهُ نهائيٌّ: جيلٌّ بلا مفتاحِ حسمٍ لا يصلحُ حدثاً.
  const coreIdentityId =
    typeof envelope.payload?.identity_id === "string"
      ? envelope.payload.identity_id.trim()
      : "";
  if (coreIdentityId === "") {
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: String(envelope.event_type ?? "unknown").slice(0, 96),
      coreIdentityId: null,
      consumedStatus: "poisoned",
      lastError: "invalid_payload:identity_id_missing",
      disposition: null,
    });
    return { kind: "poisoned", error: "invalid_payload:identity_id_missing" };
  }

  const deletedAt =
    typeof envelope.payload?.deleted_at === "string"
      ? envelope.payload.deleted_at
      : undefined;

  // 3) الربطُ: جيلٌّ غيرُ مربوطٍ = خطأٌ **قابلٌ للإعادةِ** مسمّى — لا حذفاً
  //    تخمينياً لبياناتٍ لا نعرفُ صاحبَها، ولا فقداً للحدثِ: الربطَ قد يصلُ
  //    بعدَهُ (حدثٌ سبقَ أولَ عبورِ الجيلِ للجسرِ).
  const binding = await deps.identity
    .findCoreBinding(coreIdentityId)
    .then((b) => b)
    .catch(() => null);
  if (binding === null) {
    await deps.inbox.recordRetryable(envelope.event_id, "unbound");
    return { kind: "unbound" };
  }
  const waslaPublicId = binding.waslaPublicId;

  // 4) تنقيةُ بياناتِ العميلِ — مُتماثِلةُ التكرارِ عمداً: إعادةُ الإرسالِ بعدَ
  //    انهيارٍ تعيدُها فلا تُكرّرَ أثراً ولا تُفوّتَ شيئاً.
  const profile = await deps.repo.findProfile(waslaPublicId);
  if (profile !== null && profile.displayName !== null) {
    await deps.repo.saveProfile({ ...profile, displayName: null });
  }
  const places = await deps.repo.listPlaces(waslaPublicId);
  for (const place of places) {
    await deps.repo.deletePlace(waslaPublicId, place.id);
  }
  // طلباتُ الطلبِ تُبقَى — قرارُ المالكِ المعلّقُ مكتوبٌ في التصرّفِ لا مفترضٌ.

  // 5) تطبيقُ الحذفِ على الهويّةِ **بعدَ** نجاحِ التنقيةِ — لا قبلهُ. مُتماثِلُ
  //    التكرارِ في الخدمةِ الأخرى (الهويّةُ المحجّرةُ سلفاً = applied).
  let outcome: ApplyCoreDeletionOutcome;
  try {
    outcome = await deps.identity.applyCoreDeletion({
      coreIdentityId,
      ...(deletedAt === undefined ? {} : { deletedAt }),
    });
  } catch (error) {
    // فشلُ النداءِ عابرٌ (شبكةٌ/تدهورٌ) — قابلٌ للإعادةِ، والتنقيةُ فوقَ
    // مُتماثِلةٌ فلا تتضاعفُ.
    await deps.inbox.recordRetryable(
      envelope.event_id,
      `identity_call:${error instanceof Error ? error.message : "failed"}`,
    );
    return { kind: "error", error: "identity_call_failed" };
  }

  if (outcome.applied === false) {
    // وصلَ الربطُ للقراءةِ ثمّ غابَ للتطبيقِ — اتساقٌ مكسورٌ يُعادُ لا يُخفى.
    await deps.inbox.recordRetryable(
      envelope.event_id,
      `identity_unapplied:${outcome.reason ?? "unknown"}`,
    );
    return { kind: "error", error: "identity_unapplied" };
  }

  await deps.inbox.recordTerminal({
    eventId: envelope.event_id,
    eventType: String(envelope.event_type ?? "unknown").slice(0, 96),
    coreIdentityId,
    consumedStatus: "applied",
    lastError: null,
    disposition: DISPOSITION_PURGED,
  });
  return { kind: "applied", waslaPublicId };
}
