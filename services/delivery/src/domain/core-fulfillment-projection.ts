/**
 * `domain/core-fulfillment-projection.ts` — قرارُ إسقاطِ إغلاقِ التنفيذِ على طلبِ المتجرِ (XR-3.5).
 *
 * هذا الملفُّ **لا يقرأُ ولا يكتبُ**: يأخذُ حدثًا مصنَّفًا وحالةَ الطلبِ
 * الحاليةَ فيُقرِّرُ ماذا يفعلُ المستهلِكُ — وهو **خاضعٌ لآلةِ الحالةِ
 * القائمةَ خضوعًا تامًّا** (`state-machine.ts`): لا مسارًا خاصًّا للتكاملِ،
 * ولا حافّةً تُفتَحُ من أجلِ CORE. إذا لم يسمحِ الانتقالُ من الحالةِ
 * الحاليةِ فالجوابُ **مسمّى** (`out_of_order`) لا صامتًا — حدثٌ وصلَ في غيرِ
 * موضعهِ يُرى في السجلِّ، ولا يُطبَّقُ بالقوةِ.
 *
 * ## الخريطةُ (XR-4 · «core.fulfillment.* (closed) → store_order delivered / failed»)
 *
 * - `created` — CORE قبلَ العملَ: **ملاحظةٌ** لا انتقالَ (الطلبُ مُوضَعٌ أصلًا).
 * - `dispatched` — عُيِّنَ ساعٍ (مهمةُ MOVE): `→ handed_to_courier` من
 *   `ready_for_delivery` فقط (حافّةُ `COURIER_ACCEPTED` القائمة).
 * - `completed(outcome=completed)` — الإغلاقُ بالتسليم: `→ delivered` من
 *   `handed_to_courier` فقط، **وبإثباتِ تسليمٍ** (بوّابةُ §2.4 لا تُستثنى
 *   لأحدٍ — لو لم يُقدَّمِ الإثباتُ فالجوابُ `proof_missing` مسمّى، لأنَّ
 *   الإثباتَ يأتي معَ الرحلةِ في XR-4.3 لا معَ الحدثِ).
 * - `completed(outcome=failed)` — الإغلاقُ بالفشلِ: `→ failed` من
 *   `handed_to_courier` (حافّةُ `DELIVERY_ATTEMPTS_EXHAUSTED` القائمة).
 * - `cancelled` — الإغلاقُ بالإلغاءِ: `→ cancelled` من الحالاتِ التي تسمحُها
 *   الآلةُ (placed/confirmed/ready_for_delivery — «آخرُ نقطةٍ يملكُ فيها
 *   العميلُ قرارَهُ»)؛ فما بعدَها `out_of_order` مسمّى.
 * - `executed_after_cancellation` — **لا يحرِّكُ شيئًا** عمدًا: عملٌ نُفِّذَ بعدَ
 *   إلغاءٍ والمالُ تحرّكَ — رايةُ `financial_decision_required` تُرفَعُ في
 *   السجلِّ ولا يُحكَمُ هنا (قرارُ المالكِ B-20/B-30 — XR-4.4).
 */

import type { FulfillmentState } from "@wasla/contracts-delivery";

import { isFulfillmentTransitionAllowed } from "./state-machine.js";
import type { ClassifiedCoreFulfillmentEvent } from "./core-fulfillment-events.js";

/** قرارُ الإسقاطِ — كلُّ احتمالٍ مسمّى، ولا «تطبيقٍ صامتٍ» واحد. */
export type CoreFulfillmentProjection =
  | {
      readonly kind: "observed";
      readonly note:
        | "core_accepted_fulfillment"
        | "executed_after_cancellation_financial_decision_required";
    }
  | {
      readonly kind: "transition";
      readonly to: FulfillmentState;
      readonly requiresProof: boolean;
    }
  | {
      readonly kind: "out_of_order";
      readonly from: FulfillmentState;
      readonly to: FulfillmentState;
      readonly reason: string;
    };

/** الحالاتُ التي يملكُ فيها العميلُ إلغاءَ طلبِهِ (آلةُ الحالةِ القائمة). */
const CANCELLABLE_FROM: readonly FulfillmentState[] = [
  "placed",
  "confirmed",
  "ready_for_delivery",
];

/**
 * يُقرِّرُ أثرَ الحدثِ على طلبٍ في حالةٍ معلومةٍ. لا يكتبُ شيئًا — القرارُ
 * نقيٌّ والمستهلِكُ هو من يُنفِّذُهُ عبرَ مسارِ الانتقالِ الواحدِ.
 */
export function projectCoreFulfillmentEvent(
  event: ClassifiedCoreFulfillmentEvent,
  currentFulfillmentState: FulfillmentState,
): CoreFulfillmentProjection {
  switch (event.kind) {
    case "core.fulfillment.created":
      return { kind: "observed", note: "core_accepted_fulfillment" };

    case "core.fulfillment.dispatched":
      return transitionOrOutOfOrder(currentFulfillmentState, "handed_to_courier", false);

    case "core.fulfillment.completed":
      return event.payload.outcome === "completed"
        ? transitionOrOutOfOrder(currentFulfillmentState, "delivered", true)
        : transitionOrOutOfOrder(currentFulfillmentState, "failed", false);

    case "core.fulfillment.cancelled":
      if (!CANCELLABLE_FROM.includes(currentFulfillmentState)) {
        return {
          kind: "out_of_order",
          from: currentFulfillmentState,
          to: "cancelled",
          reason: "cancellation_not_allowed_from_state",
        };
      }
      return transitionOrOutOfOrder(currentFulfillmentState, "cancelled", false);

    case "core.fulfillment.executed_after_cancellation":
      // عمدًا لا انتقالَ: رايةٌ ماليّةٌ تُرفَعُ في السجلِّ، لا حُكمٌ هنا (XR-4.4).
      return {
        kind: "observed",
        note: "executed_after_cancellation_financial_decision_required",
      };
  }
}

function transitionOrOutOfOrder(
  from: FulfillmentState,
  to: FulfillmentState,
  requiresProof: boolean,
): CoreFulfillmentProjection {
  if (!isFulfillmentTransitionAllowed(from, to)) {
    return {
      kind: "out_of_order",
      from,
      to,
      reason: `transition_not_allowed:${from}→${to}`,
    };
  }
  return { kind: "transition", to, requiresProof };
}

/**
 * بوّابةُ الإثباتِ للإسقاطِ: هل يسمحُ القرارُ بتطبيقِ الانتقالِ بالإثباتِ
 * المُقدَّمِ؟ الإجابةُ «لا» مسمّاةً (`proof_missing`) لا استثناءً مكتومًا —
 * لأنَّ المستهلِكَ يسجِّلُها بندًا وحدَهُ في صندوقِهِ.
 */
export function proofSatisfied(
  decision: CoreFulfillmentProjection,
  hasProof: boolean,
): boolean {
  return decision.kind !== "transition" || !decision.requiresProof || hasProof;
}
