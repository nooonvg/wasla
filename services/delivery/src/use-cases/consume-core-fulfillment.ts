/**
 * `use-cases/consume-core-fulfillment.ts` — مستهلِكُ صندوقِ إغلاقِ التنفيذِ من CORE (XR-3.5 · المراجعةُ 7).
 *
 * هذا هوَ المستهلِكُ الذي يُحرِّكُ `store_order` بأحداثِ `core.fulfillment.*`
 * — الساقُ العائدةُ منَ الرحلةِ (XR-4): MARKET وضعَ الطلبَ، وCORE أغلقَ
 * التنفيذَ، فهنا يصلُ الطلبُ إلى `handed_to_courier`/`delivered`/فشل.
 *
 * ## الضماناتُ (نمطُ صندوقِ البريدِ القائمِ — لا لهجةً جديدة)
 *
 * - **الإغلاقُ مُفردٌ:** كلُّ حدثٍ يُحسَمُ مرةً واحدةً في صندوقٍ مملوكٍ
 *   (`core_fulfillment_inbox`) — إعادةُ إرسالِ حدثٍ حُسِمَ = `duplicate` بلا أثرٍ.
 * - **لا فقدَ أبدًا (درسُ المراجعةِ):** الحسمُ النهائيُّ (`applied`/`observed`/
 *   `poisoned`) وحدَهُ يُغلقُ الصفَّ. أما **خارجُ الترتيبِ والإثباتُ
 *   المفقودُ والطلبُ غيرُ الموجودِ** فأخطاءٌ **قابلةٌ للإعادةِ** مسمّاةً —
 *   لأنَّ الحالةَ تتغيّرُ: حدثٌ وصلَ قبلَ أوانِهِ قد يصيرُ قابلًا للتطبيقِ
 *   بعدَهُ، فتسجيلُهُ نهائيًّا كانَ سيُفقِدُهُ إلى الأبدِ. والسمُّ وحدَهُ
 *   نهائيٌّ — حمولةٌ فاسدةٌ لا تُصلِحُها إعادةٌ.
 * - **نافذةُ الانهيارِ مغلقةٌ بإيصالٍ لا بوعدٍ (تكميلُ المراجعةِ 8):** كلُّ
 *   انتقالٍ يُطبَّقُ بإيصالِ تماثُلٍ **مرتبطٍ بالحدثِ** (مفتاحُهُ من
 *   `event_id`، وبصمتُهُ حتميةٌ منَ الحدثِ والطلبِ لا من نتيجةِ الإسقاطِ
 *   المتغيّرةِ) يُلتزَمُ معَ الانتقالِ نفسِهِ — والإيصالُ يُفحصُ **قبلَ
 *   الإسقاطِ**، فإعادةُ الإرسالِ بعدَ انهيارٍ (حتى لو تقدّمتِ الأحداثُ بعدهُ
 *   وغيّرتِ الحالةَ) تجدُ الإيصالَ فتُسجِّلُ `applied`. وكشفُ «الحالةُ
 *   المستهدفةُ قائمةٌ» يبقى حديقةً ثانيةً (حدثٌ قديمٌ والحالةُ بلغتْ هدفَهُ
 *   بلا إيصالٍ).
 * - **السمُّ مسمّى:** حمولةٌ تخالفُ العقدَ = `poisoned` (نهائيٌّ، يُرى لا يُبلَع).
 * - **الإثباتُ بوّابةٌ لا ديكور:** إغلاقٌ بالتسليمِ بلا إثباتِ تسليمٍ =
 *   `proof_missing` (مسمّى، قابلٌ للإعادةِ — الإثباتُ يأتي معَ الرحلةِ في
 *   XR-4.3). وقرارُ §2.4 لا يُستثنى لأحدٍ.
 * - **لا انتقالَ إلا بمسارٍ واحدٍ:** التطبيقُ كلهُ عبرَ `fulfillmentTransition`
 *   القائمِ — لا مسارِ كتابةٍ ثانٍ.
 *
 * **وما لا يُنفَّذُ هنا عمدًا:** النقلُ (HTTP endpoint أو اقتراعٌ) — ذاكَ
 * سلكُ XR-4.3 على بيئةِ CORE، وهذا الاستخدامُ يُختبرُ على PostgreSQL حقيقيةٍ
 * (شرطُ إغلاقِ XR-3.5) ويتعلَّقُ بهِ السلكُ حينَ تُبنى البيئةُ.
 */

import type { ProofOfDelivery, StoreOrder } from "../domain/model.js";
import type { StoreOrderReadPort, CoreFulfillmentInboxStore } from "../ports.js";
import {
  classifyCoreFulfillmentEvent,
  CoreFulfillmentPayloadError,
  type CoreEnvelopeInput,
} from "../domain/core-fulfillment-events.js";
import {
  projectCoreFulfillmentEvent,
  proofSatisfied,
} from "../domain/core-fulfillment-projection.js";
import { createHash } from "node:crypto";

import { DeliveryError } from "../domain/errors.js";
import { deriveRequestFingerprint } from "../domain/idempotency.js";
import type { IdempotencyIntent } from "../ports.js";
import { fulfillmentTransition, settleCancellationInventory, type FulfillmentTransitionDeps } from "./fulfillment-transition.js";

/** نتيجةُ استهلاكِ حدثٍ واحدٍ — كلُّ احتمالٍ مسمّى. */
export type CoreFulfillmentConsumeResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | { readonly kind: "observed"; readonly note: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "order_not_found" }
  | { readonly kind: "out_of_order"; readonly from: string; readonly to: string; readonly reason: string }
  /**
   * §4.30: the event has no edge from a TERMINAL order state — nothing can ever
   * change that, so it is recorded `out_of_order` terminally (named, visible)
   * and the producer is told to stop retrying.
   */
  | { readonly kind: "stale"; readonly from: string; readonly to: string; readonly reason: string }
  | { readonly kind: "proof_missing" }
  | { readonly kind: "poisoned"; readonly error: string }
  | { readonly kind: "error"; readonly error: string };

export interface ConsumeCoreFulfillmentDeps {
  /** صندوقُ الاستهلاكِ المملوكُ لخدمةِ التوصيلِ. */
  readonly inbox: CoreFulfillmentInboxStore;
  /** قراءةُ الطلبِ للإسقاطِ (المسارُ القائمُ لا جديدَ). */
  readonly orders: StoreOrderReadPort;
  /** مسارُ الانتقالِ الواحدُ القائمُ (لافتقاضُهُ من فولهُ). */
  readonly transition: FulfillmentTransitionDeps;
}

/**
 * يستهلكُ حدثَ إغلاقِ تنفيذٍ واحدًا من CORE.
 *
 * @param proof - إثباتُ التسليمِ إن كانَ الإغلاقُ بالتسليمِ (يأتي منَ الرحلةِ).
 * غيابُهُ معَ `→ delivered` يجوابُ `proof_missing` مسمّى — قابلًا للإعادةِ لا
 * نهائيًّا، لأنَّ الإثباتَ قد يصلُ معَ إعادةِ إرسالٍ لاحقةٍ منَ الرحلةِ.
 */
/** نمطُ UUID كما يفهمُهُ PostgreSQL — الحارسُ قبلَ أيِّ لمسٍ للقاعدةِ. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * مفتاحٌ بديلٌ حتميٌّ لحدثٍ لا يملكُ `event_id` صالحًا: القاعدةَ لا تقبلُ إلا
 * UUID، فالسمُّ يُسجَّلُ تحتَ بديلٍ مشتقٍّ منَ النصِّ الخامِ نفسِهِ — إعادةُ
 * الإرسالِ تعيدُ إنتاجَ المفتاحِ نفسِهِ فلا يتضاعفُ السمُّ ولا يختفي.
 */
function surrogateEventKey(rawEventId: string, rawEventType: string): string {
  const hex = createHash("sha256")
    .update(`core-fulfillment-poison\u0000${rawEventId}\u0000${rawEventType}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function consumeCoreFulfillmentEvent(
  deps: ConsumeCoreFulfillmentDeps,
  envelope: CoreEnvelopeInput,
  proof: ProofOfDelivery | null = null,
): Promise<CoreFulfillmentConsumeResult> {
  // 0) حارسُ السمِّ قبلَ أيِّ لمسٍ للقاعدةِ: مفتاحُ حدثٍ ليسَ UUID سيُفجّرُ
  //    استعلامَ القاعدةِ قبلَ أن يصلَ التصنيفُ — فالسمُّ هنا يُسجَّلُ سمًّا
  //    (بمفتاحٍ بديلٍ حتميٍّ) لا استثناءً غيرَ معالَجٍ. والنوعُ يُقصُّ إلى حدِّ
  //    عقدِ الصندوقِ (96) حتى لا يُفجّرَ CHECKُ الطولِ تسجيلَهُ.
  const rawEventId = String(envelope.event_id ?? "");
  if (!UUID_RE.test(rawEventId)) {
    const rawType = String(envelope.event_type ?? "unknown").slice(0, 96);
    const surrogate = surrogateEventKey(rawEventId, rawType);
    await deps.inbox.recordTerminal({
      eventId: surrogate,
      eventType: rawType,
      orderReference: null,
      consumedStatus: "poisoned",
      lastError: "invalid_event_id:not_a_uuid",
    });
    return { kind: "poisoned", error: "invalid_event_id:not_a_uuid" };
  }

  // 1) الإغلاقُ المفردُ: حدثٌ حُسِمَ نهائيًّا لا يُعالَجُ مرّةً ثانيةً.
  //    الحيُّ (pending/error) يُعادُ معالجتُهُ — لا فقدَ.
  const existing = await deps.inbox.find(envelope.event_id);
  if (existing !== null && isTerminal(existing.consumedStatus)) {
    return { kind: "duplicate" };
  }

  // 2) التصنيفُ: السمُّ وحدَهُ نهائيٌّ — يُسجَّلُ باسمِهِ ولا يُبلَعُ صامتًا.
  let event;
  try {
    event = classifyCoreFulfillmentEvent(envelope);
  } catch (error) {
    const message =
      error instanceof CoreFulfillmentPayloadError ? error.message : "classification_failed";
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: String(envelope.event_type ?? "unknown").slice(0, 96),
      orderReference: null,
      consumedStatus: "poisoned",
      lastError: message,
    });
    return { kind: "poisoned", error: message };
  }

  // 3) الطلبُ: مرجعٌ لا تملكُهُ هذهِ الخدمةُ **قابلٌ للإعادةِ** لا مفقودًا —
  //    فقد يكونُ سباقَ إدراجٍ (الحدثُ وصلَ قبلَ التزامِ الطلبِ).
  const order = await deps.orders.getOrderByPublicId(event.payload.order_reference);
  if (order === null) {
    await deps.inbox.recordRetryable(envelope.event_id, "order_not_found");
    return { kind: "order_not_found" };
  }

  // 4) الإيصالُ المرتبطُ بالحدثِ **قبلَ الإسقاطِ**: بصمتُهُ حتميةٌ منَ الحدثِ
  //    والطلبِ لا من نتيجةِ الإسقاطِ (المتغيّرةِ بتغيّرِ الحالةِ) — فلو
  //    التزمَ الانتقالُ أثرَهُ ثمّ انهارَ التنفيذُ قبلَ إيصالِ الصندوقِ،
  //    وتقدّمتِ الأحداثُ بعدهُ وغيّرتِ الحالةَ، فإعادةُ الإرسالِ تجدُ الإيصالَ
  //    هنا فتُسجِّلُ applied — لا أن يُعلنَها الإسقاطُ خارجَ الترتيبِ أبدًا.
  const intent: IdempotencyIntent = {
    key: `core-fulfillment:${envelope.event_id}:v1`,
    route: "POST /store-orders/{orderPublicId}/fulfillment-transition",
    fingerprint: deriveRequestFingerprint(
      "POST /store-orders/{orderPublicId}/fulfillment-transition",
      order.publicId,
      { event_type: event.kind },
    ),
    responseStatus: 200,
    buildResponseBody: () => ({ kind: "applied", event_type: event.kind }),
  };
  const receipt = await deps.orders.findIdempotentResponse(intent.key);
  if (receipt !== null) {
    if (receipt.fingerprint !== intent.fingerprint) {
      // مفتاحُ الحدثِ نادرًا ما يُعادُ استعمالُهُ — وإن وقعَ فالرفضُ مسمّى.
      await deps.inbox.recordRetryable(envelope.event_id, "receipt_fingerprint_mismatch");
      return { kind: "error", error: "receipt_fingerprint_mismatch" };
    }
    // §4.29: الإيصالُ يُثبِتُ وقوعَ الانتقالِ **لا اكتمالَ تسويةِ الإفراجِ** —
    // استئنافُ التسويةِ قبلَ أيِّ حسمٍ نهائيٍّ: فشلُ الإفراجِ بعدَ الالتزامِ لا
    // يُفقدُ بإجابةِ الإيصالِ بل يبقى مرئيًّا قابلًا للإعادةِ.
    let settledOrder = order;
    try {
      // §4.29: والطلبُ المعادُ هو ما بعدَ التسويةِ لا اللقطةُ قبلَها.
      const settlement = await settleCancellationInventory(deps.transition, order.publicId, envelope.correlation_id ?? null);
      settledOrder = settlement.order;
    } catch (error) {
      const message = error instanceof DeliveryError ? error.code : "settlement_failed";
      await deps.inbox.recordRetryable(envelope.event_id, `settlement:${message}`);
      return { kind: "error", error: `settlement:${message}` };
    }
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: event.kind,
      orderReference: event.payload.order_reference,
      consumedStatus: "applied",
      lastError: null,
    });
    return { kind: "applied", order: settledOrder };
  }

  // 5) الإسقاطُ: قرارٌ نقيٌّ منَ الآلةِ القائمةِ.
  const decision = projectCoreFulfillmentEvent(event, order.fulfillmentState);

  if (decision.kind === "observed") {
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: event.kind,
      orderReference: event.payload.order_reference,
      consumedStatus: "observed",
      lastError: null,
    });
    return { kind: "observed", note: decision.note };
  }

  if (
    (decision.kind === "transition" || decision.kind === "out_of_order") &&
    order.fulfillmentState === decision.to
  ) {
    // نافذةُ الانهيارِ: الانتقالُ وقعَ في محاولةٍ سابقةٍ وانتهارَ التنفيذُ قبلَ
    // إيصالِ الصندوقِ — الحالةُ المستهدفةُ قائمةٌ فالأثرُ وقعَ، والإيصالُ
    // يُكتبُ الآنَ. ولا يُعلنُ «خارجَ الترتيبِ» أبدًا لما وقعَ فعلًا — حتى
    // حينَ يُسقِطُهُ الإسقاطُ خارجَ الترتيبِ (من الحالةِ نفسِها إلى نفسِها) فذلكَ
    // عينُ «الأثرُ قائمٌ».
    // §4.29: وكالإيصالِ — الأثرُ القائمُ لا يعني اكتمالَ تسويةِ الإفراجِ:
    // الاستئنافُ قبلَ الحسمِ النهائيِّ.
    let settledOrder = order;
    try {
      // §4.29: والطلبُ المعادُ هو ما بعدَ التسويةِ لا اللقطةُ قبلَها.
      const settlement = await settleCancellationInventory(deps.transition, order.publicId, envelope.correlation_id ?? null);
      settledOrder = settlement.order;
    } catch (error) {
      const message = error instanceof DeliveryError ? error.code : "settlement_failed";
      await deps.inbox.recordRetryable(envelope.event_id, `settlement:${message}`);
      return { kind: "error", error: `settlement:${message}` };
    }
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: event.kind,
      orderReference: event.payload.order_reference,
      consumedStatus: "applied",
      lastError: null,
    });
    return { kind: "applied", order: settledOrder };
  }

  if (decision.kind === "out_of_order" && TERMINAL_ORDER_STATES.has(order.fulfillmentState)) {
    // §4.30: لا حافّةَ من حالةٍ نهائيّةٍ ولن تكونَ — الإعادةُ لا تُغيّرُ شيئًا،
    // فالحسمُ نهائيٌّ مسمًّى (`out_of_order`) والمنتجُ يُبلَّغُ بالتوقّفِ.
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: event.kind,
      orderReference: event.payload.order_reference,
      consumedStatus: "out_of_order",
      lastError: `stale:${decision.reason}`.slice(0, 500),
    });
    return { kind: "stale", from: decision.from, to: decision.to, reason: decision.reason };
  }

  if (decision.kind === "out_of_order") {
    // قابلٌ للإعادةِ عمدًا: الحالةُ تتغيّرُ وحدثٌ قبلَ أوانِهِ قد يصيرُ صالحًا.
    await deps.inbox.recordRetryable(envelope.event_id, decision.reason);
    return {
      kind: "out_of_order",
      from: decision.from,
      to: decision.to,
      reason: decision.reason,
    };
  }

  // 5) بوّابةُ الإثباتِ (§2.4): لا «delivered» بلا إثباتٍ، مسمّاةً وقابلةً
  //    للإعادةِ — الإثباتُ يأتي معَ الرحلةِ (XR-4.3) لا معَ الحدثِ.
  if (!proofSatisfied(decision, proof !== null)) {
    await deps.inbox.recordRetryable(envelope.event_id, "proof_missing:delivered_requires_proof");
    return { kind: "proof_missing" };
  }

  // 7) التطبيقُ: بمسارِ الانتقالِ الواحدِ القائمِ — لا مسارِ كتابةٍ ثانٍ —
  //    وبالإيصالِ المرتبطِ بالحدثِ نفسِهِ (يُلتزمُ معَ الانتقالِ، وفُحصَ قبلَ
  //    الإسقاطِ أعلاه).
  try {
    const result = await fulfillmentTransition(
      deps.transition,
      order.publicId,
      decision.to,
      decision.requiresProof ? proof : null,
      envelope.correlation_id,
      intent,
      // §4.30: the CORE projection — the only caller allowed on core-only edges.
      "core",
    );
    if (result.kind === "applied" || result.kind === "replayed") {
      await deps.inbox.recordTerminal({
        eventId: envelope.event_id,
        eventType: event.kind,
        orderReference: event.payload.order_reference,
        consumedStatus: "applied",
        lastError: null,
      });
      // «replayed» من المسارِ القائمِ: الانتقالُ وقعَ في طلبٍ سابقٍ — نُعيدُ
      // قراءةَ الحالةِ بعدَهُ لا أن نُخترعَ جوابًا.
      const after = await deps.orders.getOrderByPublicId(order.publicId);
      if (after === null) {
        await deps.inbox.recordRetryable(envelope.event_id, "order_vanished_after_transition");
        return { kind: "error", error: "order_vanished_after_transition" };
      }
      return { kind: "applied", order: after };
    }
    // أيُّ جوابٍ آخرَ منَ المسارِ القائمِ يُعامَلُ كخطأٍ قابلٍ للإعادةِ.
    await deps.inbox.recordRetryable(envelope.event_id, "transition_unexpected_result");
    return { kind: "error", error: "transition_unexpected_result" };
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "DELIVERY_CONCURRENT_UPDATE") {
      await deps.inbox.recordRetryable(envelope.event_id, error.code);
      return { kind: "error", error: error.code };
    }
    // سباقُ حالةٍ (تغيّرتِ الحالةُ بينَ القراءةِ والتطبيقِ) = قابلٌ للإعادةِ:
    // إعادةُ الإرسالِ تُعيدُ الإسقاطَ على الحالةِ الجديدةِ فلا يُفقدُ شيءٌ.
    // والفشلُ داخلَ التسويةِ (§4.29) يُسمّى بكودِهِ الثابتِ لا برسالتِهِ.
    const message = error instanceof DeliveryError ? error.code : error instanceof Error ? error.message : "transition_failed";
    await deps.inbox.recordRetryable(envelope.event_id, `transition_conflict:${message}`);
    return {
      kind: "out_of_order",
      from: order.fulfillmentState,
      to: decision.to,
      reason: message,
    };
  }
}

/** Order states with no outgoing fulfillment edge (ADR-026 §3.1). */
const TERMINAL_ORDER_STATES: ReadonlySet<string> = new Set(["delivered", "cancelled", "rejected", "failed"]);

/** الحسمُ النهائيُّ: ما لا تُعيدُهُ إعادةُ الإرسالِ. السمُّ وما وقعَ أثرُهُ. */

function isTerminal(consumedStatus: string): boolean {
  return (
    consumedStatus === "applied" ||
    // §4.30: recorded only for a stale event on a terminal order — final.
    consumedStatus === "out_of_order" ||
    consumedStatus === "observed" ||
    consumedStatus === "poisoned"
  );
}
