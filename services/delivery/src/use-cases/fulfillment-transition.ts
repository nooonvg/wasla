/**
 * انتقالُ تنفيذِ طلبِ متجرٍ (المراجعةُ 11/N · ADR-026 §4.13).
 *
 * مسارٌ واحدٌ يُديرُ انتقالاتِ الإكمالِ الستّةَ الباقيةَ:
 * `confirmed → picking → picked → ready_for_delivery → handed_to_courier → delivered`.
 *
 * عندَ `handed_to_courier → delivered`:
 *  - إثباتُ التسليمِ مطلوبٌ (§2.4)
 *  - المخزونُ ينتقلُ `reserved → consumed` في نفسِ المعاملةِ
 *  - لا نداءَ للسوقِ: الحجزُ خصمٌ بالفعل
 *  - الإلغاءُ بعدَ `consumed` لا يُطلِقُ الحجزَ
 */

import type { FulfillmentReasonCode, FulfillmentState, WaslaPublicId } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import {
  storeOrderFulfillmentStateChangedEvent,
  storeOrderInventoryConsumedEvent,
  storeOrderInventoryReleasedEvent,
  type DeliveryDomainEvent,
  type EventContext,
} from "../domain/events.js";
import type { ProofOfDelivery, StoreOrder } from "../domain/model.js";
import { decideFulfillmentTransition } from "../domain/store-order-fulfillment-transition.js";
import { resolveIdempotentReplay } from "./idempotency-guard.js";
import type {
  FulfillmentTransitionWrite,
  IdempotencyIntent,
  IdempotentReplay,
  InventoryReservationPort,
  InventoryReservationStore,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";

export type FulfillmentTransitionResult =
  | { readonly kind: "applied"; readonly order: StoreOrder }
  | IdempotentReplay;

export interface FulfillmentTransitionDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  readonly reservationStore?: InventoryReservationStore;
  /** Required by the `cancelled` edge when the order holds a live reservation. */
  readonly reservationPort?: InventoryReservationPort;
  readonly newUuid: () => string;
  readonly now: () => string;
}

export async function fulfillmentTransition(
  deps: FulfillmentTransitionDeps,
  publicId: WaslaPublicId,
  toState: FulfillmentState,
  proof: ProofOfDelivery | null,
  traceId: string | null,
  idempotency?: IdempotencyIntent,
): Promise<FulfillmentTransitionResult> {
  const replay = await resolveIdempotentReplay(deps.readPort, idempotency, traceId);
  if (replay !== null) return replay;

  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }

  const decision = decideFulfillmentTransition(order, toState, proof, traceId ?? undefined);

  const transitionedOrder: StoreOrder = {
    ...order,
    fulfillmentState: decision.toFulfillmentState,
    version: order.version + 1,
  };

  const events: DeliveryDomainEvent[] = [
    storeOrderFulfillmentStateChangedEvent(
      transitionedOrder,
      decision.fromFulfillmentState,
      decision.reasonCode as FulfillmentReasonCode,
      { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
      { actor_type: "system", actor_ref: null },
    ),
  ];

  let inventoryConsume: FulfillmentTransitionWrite["inventoryConsume"] = null;

  if (decision.consumesInventory) {
    if (order.inventoryState !== "reserved") {
      throw new DeliveryError(
        "DELIVERY_INVENTORY_NOT_RESERVED",
        `لا خصمَ نهائيَّ والحالةُ ${order.inventoryState} — البوّابةُ تطلبُ reserved`,
        {
          traceId: traceId ?? undefined,
          details: { expected: "reserved", actual: order.inventoryState },
        },
      );
    }

    // Build the consumed event against the post-transition order (inventory
    // state is about to become "consumed").
    const consumedOrder: StoreOrder = {
      ...transitionedOrder,
      inventoryState: "consumed",
    };

    // Get the reservation ref for the inventory_ref field
    const reservations = deps.reservationStore
      ? await deps.reservationStore.loadActiveReservations(order.orderId)
      : [];
    const reservationRef =
      reservations.length > 0
        ? reservations[0].marketplaceReservationRef
        : order.inventoryRef ?? "unknown";

    inventoryConsume = {
      fromInventoryState: "reserved",
      toInventoryState: "consumed",
      inventoryRef: reservationRef,
      reasonCode: "INVENTORY_CONSUMED",
      events: [
        storeOrderInventoryConsumedEvent(
          consumedOrder,
          { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
          { reservation_ref: reservationRef },
        ),
      ],
    };

    // Mark reservations as consumed in the delivery-side ledger
    if (deps.reservationStore && reservations.length > 0) {
      await deps.reservationStore.consumeReservations(order.orderId);
    }
  }

  const write: FulfillmentTransitionWrite = {
    orderId: order.orderId,
    expectedVersion: order.version,
    fromFulfillmentState: decision.fromFulfillmentState,
    toFulfillmentState: decision.toFulfillmentState,
    reasonCode: decision.reasonCode,
    actor: { actor_type: "system", actor_ref: null },
    events,
    traceId,
    idempotency,
    inventoryConsume,
  };

  const result = await deps.writePort.fulfillmentTransition(write);
  if (result.kind !== "applied") return result;

  // ── §4.29: إفراجُ الحجزِ عندَ الإلغاءِ ─────────────────────────────────
  // كلُّ حافّةٍ إلى `cancelled` تُفرِجُ الحجزَ — إعادةُ استخدامٍ للجزءِ المناسبِ
  // من مسارِ إلغاءِ العميلِ (cancelStoreOrder · المراجعةُ 10/N · §2.3) لا
  // اختراعٌ: إلغاءٌ بلا إفراجٍ يتركُ رفًّا محجوزًا لطلبٍ ميتٍ. والمحفوظُ بعدَ
  // `consumed` لا يُفرَّجُ (خصمٌ نهائيٌّ لا يُستردُّ). وإن فشلَ الإفراجُ بعدَ
  // نجاحِ الكتابةِ فالطلبُ مُلغًى والحجزُ تنقضي صلاحيّتُهُ عندَ السوقِ أو يُسوّى
  // لاحقًا — سماحيّاتُ مسارِ الإلغاءِ القائمِ نفسُهُ.
  if (decision.releasesInventory && order.inventoryState === "reserved") {
    if (!deps.reservationPort || !deps.reservationStore) {
      throw new DeliveryError(
        "DELIVERY_MARKETPLACE_UNAVAILABLE",
        "لا منفذَ حجزِ مخزونٍ مُركَّبٌ — الإفراجُ عنِ الحجزِ لا يُتخطّى (ADR-026 §2.3 · §4.29)",
        { traceId: traceId ?? undefined },
      );
    }
    const reservations = await deps.reservationStore.loadActiveReservations(order.orderId);
    if (reservations.length > 0) {
      const first = reservations[0];
      await deps.reservationPort.release({
        orderPublicId: order.publicId,
        storeSlug: order.storeSlug,
        reservationRef: first.marketplaceReservationRef,
        items: reservations.map((r) => ({ productId: r.productId, quantity: r.quantityReserved })),
      });
      await deps.reservationStore.releaseReservations(order.orderId);
      const mirrored = await deps.writePort.mirrorInventoryState({
        orderId: order.orderId,
        expectedVersion: result.order.version,
        fromInventoryState: "reserved",
        toInventoryState: "released",
        inventoryRef: first.marketplaceReservationRef,
        reasonCode: "INVENTORY_RELEASED",
        events: [
          storeOrderInventoryReleasedEvent(
            result.order,
            { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
            { reservation_ref: first.marketplaceReservationRef },
          ),
        ],
        traceId,
      });
      if (mirrored.kind === "applied") return { kind: "applied" as const, order: mirrored.order };
    }
  }

  return result;
}
