/**
 * قرارُ انتقالِ التنفيذِ (المراجعةُ 11/N · ADR-026 §4.13).
 *
 * انتقالاتُ الإكمالِ الستّةُ الباقيةُ (`confirmed → picking → picked →
 * ready_for_delivery → handed_to_courier → delivered`) تُدارُ من مسارٍ واحدٍ.
 *
 * # البوّابةُ المركَّبةُ: `delivered` يتطلَّبُ إثباتاً
 *
 * حافّةُ `handed_to_courier → delivered` هي الحافّةُ الوحيدةُ التي تتطلَّبُ إثباتَ
 * تسليمٍ (§2.4). ولا يُسمحُ بالوصولِ إلى `delivered` من أيِّ طريقٍ آخر.
 *
 * # الخصمُ النهائيُّ عندَ `delivered`
 *
 * عندَ `handed_to_courier → delivered` تنتقلُ حالةُ المخزونِ من `reserved` إلى
 * `consumed` في نفسِ المعاملةِ. لا نداءَ للسوقِ: الحجزُ خصمٌ بالفعل، والخصمُ
 * النهائيُّ قرارُ تسليمٍ داخليٌّ. والإلغاءُ بعدَ `consumed` لا يُطلِقُ الحجزَ.
 */

import { illegalTransition } from "./errors.js";
import type { StoreOrder } from "./model.js";
import type { ProofOfDelivery } from "./model.js";
import { isFulfillmentTransitionAllowed } from "./state-machine.js";
import type { FulfillmentReasonCode, FulfillmentState } from "@wasla/contracts-delivery";

/** ما يحتاجُهُ المخزنُ ليكتبَ انتقالَ التنفيذِ. */
export interface FulfillmentTransitionDecision {
  readonly fromFulfillmentState: FulfillmentState;
  readonly toFulfillmentState: FulfillmentState;
  readonly reasonCode: FulfillmentReasonCode;
  /**
   * true when this edge consumes inventory — every edge into `delivered`
   * (§4.29: the graph only allows it from the live courier states `assigned`
   * and `handed_to_courier`; the proof gate and the `reserved` precondition
   * apply unchanged).
   */
  readonly consumesInventory: boolean;
  /**
   * true when this edge releases the inventory reservation — every edge into
   * `cancelled` (§4.29): cancellation frees the stock, symmetric with
   * `delivered` consuming it. The caller guards on `inventoryState === "reserved"`
   * (an order already `consumed` is terminal inventory-wise).
   */
  readonly releasesInventory: boolean;
}

const REASON_CODES: Record<string, FulfillmentReasonCode> = {
  "confirmed→picking": "PICKING_STARTED",
  "picking→picked": "PICKING_COMPLETED",
  "picked→ready_for_delivery": "READY_FOR_HANDOVER",
  "ready_for_delivery→handed_to_courier": "COURIER_ACCEPTED",
  "ready_for_delivery→assigned": "MOVE_JOB_ACCEPTED",
  "assigned→delivered": "DELIVERED_WITH_PROOF",
  "assigned→failed": "DELIVERY_ATTEMPTS_EXHAUSTED",
  "assigned→cancelled": "CORE_FULFILLMENT_CANCELLED",
  "handed_to_courier→delivered": "DELIVERED_WITH_PROOF",
};

/**
 * @param order - The order as read from the store.
 * @param toState - The target fulfillment state.
 * @param proof - Proof of delivery (required for `delivered`).
 * @param traceId - For error context.
 */
export function decideFulfillmentTransition(
  order: StoreOrder,
  toState: FulfillmentState,
  proof: ProofOfDelivery | null,
  traceId?: string,
): FulfillmentTransitionDecision {
  const from = order.fulfillmentState;

  if (!isFulfillmentTransitionAllowed(from, toState)) {
    throw illegalTransition(from, toState, traceId);
  }

  // The proof gate (§2.4): delivered ONLY with proof of delivery.
  if (toState === "delivered" && proof === null) {
    throw illegalTransition(from, toState, traceId);
  }

  const key = `${from}→${toState}`;
  const reasonCode = REASON_CODES[key] ?? "FULFILLMENT_TRANSITION";

  // §4.29: generalized to the destination — the graph only allows `delivered`
  // from the live courier states (`assigned` | `handed_to_courier`).
  const consumesInventory = toState === "delivered";
  // §4.29: every edge into `cancelled` releases the reservation — إلغاءٌ بلا
  // إفراجٍ يتركُ رفًّا محجوزًا لطلبٍ ميتٍ (مرآةُ مسارِ إلغاءِ العميلِ · §2.3).
  const releasesInventory = toState === "cancelled";

  return {
    fromFulfillmentState: from,
    toFulfillmentState: toState,
    reasonCode,
    consumesInventory,
    releasesInventory,
  };
}
