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
 * - **نافذةُ الانهيارِ مغلقةٌ بالمُكافأةِ لا بالوعدِ:** لو انهارَ التنفيذُ بعدَ
 *   نجاحِ الانتقالِ وقبلَ إيصالِهِ، فإعادةُ الإرسالِ تجدُ الطلبَ في الحالةِ
 *   المستهدفةِ أصلًا فتُسجِّلُ `applied` (تطابقُ الحالةِ = أثرٌ وقعَ) — لا
 *   أن تُعلنَهُ خارجَ الترتيبِ إلى الأبدِ.
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
import { DeliveryError } from "../domain/errors.js";
import { fulfillmentTransition, type FulfillmentTransitionDeps } from "./fulfillment-transition.js";

/** نتيجةُ استهلاكِ حدثٍ واحدٍ — كلُّ احتمالٍ مسمّى. */
export type CoreFulfillmentConsumeResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | { readonly kind: "observed"; readonly note: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "order_not_found" }
  | { readonly kind: "out_of_order"; readonly from: string; readonly to: string; readonly reason: string }
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
export async function consumeCoreFulfillmentEvent(
  deps: ConsumeCoreFulfillmentDeps,
  envelope: CoreEnvelopeInput,
  proof: ProofOfDelivery | null = null,
): Promise<CoreFulfillmentConsumeResult> {
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
      eventType: String(envelope.event_type ?? "unknown"),
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

  // 4) الإسقاطُ: قرارٌ نقيٌّ منَ الآلةِ القائمةِ.
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

  if (decision.kind === "transition" && order.fulfillmentState === decision.to) {
    // نافذةُ الانهيارِ: الانتقالُ وقعَ في محاولةٍ سابقةٍ وانتهارَ التنفيذُ قبلَ
    // إيصالِ الصندوقِ — الحالةُ المستهدفةُ قائمةٌ فالأثرُ وقعَ، والإيصالُ
    // يُكتبُ الآنَ. لا يُعلنُ «خارجَ الترتيبِ» أبدًا لما وقعَ فعلًا.
    await deps.inbox.recordTerminal({
      eventId: envelope.event_id,
      eventType: event.kind,
      orderReference: event.payload.order_reference,
      consumedStatus: "applied",
      lastError: null,
    });
    return { kind: "applied", order };
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

  // 6) التطبيقُ: بمسارِ الانتقالِ الواحدِ القائمِ — لا مسارِ كتابةٍ ثانٍ.
  try {
    const result = await fulfillmentTransition(
      deps.transition,
      order.publicId,
      decision.to,
      decision.requiresProof ? proof : null,
      envelope.correlation_id,
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
    const message = error instanceof Error ? error.message : "transition_failed";
    await deps.inbox.recordRetryable(envelope.event_id, `transition_conflict:${message}`);
    return {
      kind: "out_of_order",
      from: order.fulfillmentState,
      to: decision.to,
      reason: message,
    };
  }
}

/** الحسمُ النهائيُّ: ما لا تُعيدُهُ إعادةُ الإرسالِ. السمُّ وما وقعَ أثرُهُ. */
function isTerminal(consumedStatus: string): boolean {
  return (
    consumedStatus === "applied" ||
    consumedStatus === "observed" ||
    consumedStatus === "poisoned"
  );
}
