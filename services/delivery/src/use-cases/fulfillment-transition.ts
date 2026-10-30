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
import { decideFulfillmentTransition, type FulfillmentTransitionOrigin } from "../domain/store-order-fulfillment-transition.js";
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

/**
 * §4.29: تسويةُ إفراجِ إلغاءٍ — **قابلةٌ للاستئنافِ** ومستقلّةٌ عن إثباتِ وقوعِ
 * الانتقالِ: الإيصالُ المعامليُّ يُثبِتُ أنَّ الانتقالَ التزمَ، لا أنَّ إفراجَ الحجزِ
 * اكتملَ. لذلك تُستدعى على **كلِّ** مساراتِ الحسمِ (التطبيقُ · الإعادةُ · صدى
 * الاستهلاكِ) وكلُّ مساراتِها مقاوِمةٌ للفشلِ الجزئيِّ:
 *
 *  1. لا حجوزاتٍ نشطةَ + `released` → لا عملَ (اكتملَتْ سابقًا).
 *  2. حجوزاتٌ نشطةَ → إفراجُ السوقِ **ويُفحَصُ جوابُهُ** (`released: false` = رفضٌ
 *     مسمّى لا نجاحٌ صامتٌ) ثمّ **معاملةٌ محليّةٌ واحدةٌ**: الدفترُ + الانعكاسُ +
 *     الحدثُ (لا حالةَ منتصفٍ بينَ الدفترِ والانعكاسِ).
 *  3. `reserved` بلا حجوزاتٍ نشطةٍ = حالةٌ لا تُفسَّرُ صامتًا (لا نجاحَ بلا تفسيرٍ
 *     لكيفيّةِ التحريرِ) — خطأٌ مسمًّى قابلٌ للإعادةِ.
 *
 * وفشلُ أيِّ خطوةٍ يُبقي التسويةَ **معلَّقةً مرئيّةً**: الطلبُ ملغًى و`reserved`
 * والحجوزاتُ كما هي — فإعادةُ المحاولةِ (حدثًا كانَ أو نداءً) تُستأنفُ من الخطوةِ
 * نفسِها بلا فقدٍ ولا تكرارِ أثرٍ.
 */
export type CancellationSettlementResult =
  | { readonly kind: "not_needed"; readonly order: StoreOrder }
  | { readonly kind: "settled"; readonly order: StoreOrder };

export async function settleCancellationInventory(
  deps: FulfillmentTransitionDeps,
  publicId: WaslaPublicId,
  traceId: string | null,
): Promise<CancellationSettlementResult> {
  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }
  // ليست إلغاءً محجوزًا — لا تسويةَ (المحفوظُ بعدَ consumed لا يُفرَّجُ · §2.3).
  // §4.30: `failed` is terminal too — its reservation can never be consumed.
  if ((order.fulfillmentState !== "cancelled" && order.fulfillmentState !== "failed") || order.inventoryState !== "reserved") {
    return { kind: "not_needed", order };
  }
  if (!deps.reservationPort || !deps.reservationStore) {
    throw new DeliveryError(
      "DELIVERY_MARKETPLACE_UNAVAILABLE",
      "لا منفذَ حجزِ مخزونٍ مُركَّبٌ — الإفراجُ عنِ الحجزِ لا يُتخطّى (ADR-026 §2.3 · §4.29)",
      { traceId: traceId ?? undefined },
    );
  }
  const reservations = await deps.reservationStore.loadActiveReservations(order.orderId);
  if (reservations.length === 0) {
    // §4.29: طلبٌ `reserved` ملغًى بلا حجوزاتٍ نشطةٍ تُفسِّرُ تحريرَهُ — الدفترُ
    // والانعكاسُ معاملةٌ واحدةٌ فلا حالةَ منتصفٍ مشروعةٍ: هذهِ حالةٌ غريبةٌ تُسمّى
    // ولا يُنجَحُ صمتًا.
    throw new DeliveryError(
      "DELIVERY_INVENTORY_SETTLEMENT_INCONSISTENT",
      "الطلبُ ملغًى وحالةُ مخزونِهِ reserved ولا حجوزاتٍ نشطةَ في الدفترِ تُفسِّرُ تحريرَهُ — تُدقَّقُ يدويّاً",
      { traceId: traceId ?? undefined, details: { field: "inventoryState", actual: order.inventoryState, expected: "reserved-with-active-reservations" } },
    );
  }
  const first = reservations[0];
  const release = await deps.reservationPort.release({
    orderPublicId: order.publicId,
    storeSlug: order.storeSlug,
    reservationRef: first.marketplaceReservationRef,
    items: reservations.map((r) => ({ productId: r.productId, quantity: r.quantityReserved })),
  });
  if (!release.released) {
    // §4.29: السوقُ أجابَ بالإفراجِ المرفوضِ — لا حسمَ صامتًا؛ التسويةُ تبقى
    // معلَّقةً قابلةً للاستئنافِ والرفضُ مرئيٌّ في الصندوقِ.
    throw new DeliveryError(
      "DELIVERY_INVENTORY_RELEASE_REFUSED",
      "السوقُ رفضَ الإفراجَ عنِ الحجزِ (released: false) — لا حسمًا صامتًا",
      { traceId: traceId ?? undefined, details: { field: "reservationRef", actual: first.marketplaceReservationRef, expected: "released:true" } },
    );
  }
  const settled = await deps.writePort.settleInventoryRelease({
    orderId: order.orderId,
    expectedVersion: order.version,
    fromInventoryState: "reserved",
    toInventoryState: "released",
    inventoryRef: first.marketplaceReservationRef,
    reasonCode: "INVENTORY_RELEASED",
    events: [
      storeOrderInventoryReleasedEvent(
        order,
        { eventId: deps.newUuid(), occurredAt: deps.now(), traceId } satisfies EventContext,
        { reservation_ref: first.marketplaceReservationRef },
      ),
    ],
    traceId,
  });
  return { kind: "settled", order: settled.order };
}

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
  origin: FulfillmentTransitionOrigin = "http",
): Promise<FulfillmentTransitionResult> {
  const replay = await resolveIdempotentReplay(deps.readPort, idempotency, traceId);
  if (replay !== null) {
    // §4.29: الإيصالُ يُثبِتُ وقوعَ الانتقالِ **لا اكتمالَ تسويةِ الإفراجِ** —
    // الإلغاءُ المحجوزُ يُستأنفُ تسويتُهُ حتى على الإعادةِ (الفشلُ بعدَ الالتزامِ
    // لا يُفقدُ الإفراجَ: التسويةَ لا الانتقالَ يُعادُ).
    await settleCancellationInventory(deps, publicId, traceId);
    // وبعدَ التسويةِ يُعادُ قراءةُ الردِّ المخزَّنِ نفسِهِ: التسويةُ أعادت كتابتَهُ
    // (النسخةُ بعدَ الإفراجِ) فلا يُعادُ الجوابُ القديمُ بلقطةِ ما قبلَها.
    return (await resolveIdempotentReplay(deps.readPort, idempotency, traceId)) ?? replay;
  }

  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }

  const decision = decideFulfillmentTransition(order, toState, proof, traceId ?? undefined, origin);

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
  if (result.kind !== "applied") {
    // §4.29: فحصُ التماثُلِ **داخلَ معاملةِ الكتابةِ** قد يُجيبُ `replayed` حتى
    // بعدَ أن وجدَ الفحصُ الابتدائيُّ لا إيصالَ (التزامٌ متزامنٌ بينَ الفحصينِ) —
    // وهذا الجوابُ يمرُّ عبرَ التسويةِ أيضًا لا يتجاوزُها.
    await settleCancellationInventory(deps, publicId, traceId);
    return (await resolveIdempotentReplay(deps.readPort, idempotency, traceId)) ?? result;
  }

  // ── §4.29: إفراجُ الحجزِ عندَ الإلغاءِ ─────────────────────────────────
  // كلُّ حافّةٍ إلى `cancelled` تُفرِجُ الحجزَ — بتسويةٍ **قابلةٍ للاستئنافِ**:
  // فشلُ أيِّ خطوةٍ بعدَ التزامِ الانتقالِ لا يُفقدُ الإفراجَ (إعادةُ المحاولةِ
  // تُستأنفُهُ منَ الإيصالِ نفسِهِ) ولا تُكرِّرُ أثرًا وقعَ.
  if (decision.releasesInventory && order.inventoryState === "reserved") {
    // §4.29: والطلبُ المعادُ في **الحالتينِ** — `settled` و`not_needed` كلاهما يحملُ
    // قراءةً طازجةً بعدَ التسويةِ: فإذا أكملتْ محاولةٌ أخرى التسويةَ قبلَ مساعدِنا
    // رجعَ `not_needed` بطلبٍ حالتُهُ `released` — وإعادتُهُ أصدقُ من إعادةِ لقطةِ
    // ما قبلَ التسويةِ (`result`) بحالةِ `reserved`.
    const settlement = await settleCancellationInventory(deps, publicId, traceId);
    return { kind: "applied" as const, order: settlement.order };
  }

  return result;
}
