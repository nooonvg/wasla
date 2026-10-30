/**
 * Unit tests for the fulfillment transition domain decision and use case
 * (review 11/N, ADR-026 §4.13).
 */

import { describe, it, expect } from "vitest";

import { decideFulfillmentTransition } from "../domain/store-order-fulfillment-transition.js";
import { DeliveryError } from "../domain/errors.js";
import type { ProofOfDelivery, StoreOrder } from "../domain/model.js";

function makeOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    orderId: "00000000-0000-4000-8000-000000000001",
    publicId: "WS-0000000001",
    customerRef: "WS-CUST-0001",
    storeId: "00000000-0000-4000-8000-000000000010",
    storeSlug: "test-store",
    fulfillmentState: "confirmed",
    paymentState: "authorized",
    paymentRef: "pay-ref-001",
    inventoryState: "reserved",
    inventoryRef: "res-ref-001",
    currencyCode: "SAR",
    itemsTotalMinorUnits: 1000,
    deliveryFeeMinorUnits: 0,
    totalMinorUnits: 1000,
    items: [],
    version: 2,
    ...overrides,
  } as StoreOrder;
}

const PROOF: ProofOfDelivery = {
  proofType: "otp",
  proofRef: "OTP-123456",
};

describe("decideFulfillmentTransition — domain decision (review 11/N)", () => {
  it("allows confirmed → picking", () => {
    const order = makeOrder({ fulfillmentState: "confirmed" });
    const decision = decideFulfillmentTransition(order, "picking", null, "T-1");
    expect(decision.fromFulfillmentState).toBe("confirmed");
    expect(decision.toFulfillmentState).toBe("picking");
    expect(decision.reasonCode).toBe("PICKING_STARTED");
    expect(decision.consumesInventory).toBe(false);
  });

  it("allows picking → picked", () => {
    const order = makeOrder({ fulfillmentState: "picking" });
    const decision = decideFulfillmentTransition(order, "picked", null, "T-2");
    expect(decision.toFulfillmentState).toBe("picked");
    expect(decision.reasonCode).toBe("PICKING_COMPLETED");
    expect(decision.consumesInventory).toBe(false);
  });

  it("allows picked → ready_for_delivery", () => {
    const order = makeOrder({ fulfillmentState: "picked" });
    const decision = decideFulfillmentTransition(order, "ready_for_delivery", null, "T-3");
    expect(decision.reasonCode).toBe("READY_FOR_HANDOVER");
  });

  it("allows ready_for_delivery → handed_to_courier", () => {
    const order = makeOrder({ fulfillmentState: "ready_for_delivery" });
    const decision = decideFulfillmentTransition(order, "handed_to_courier", null, "T-4");
    expect(decision.reasonCode).toBe("COURIER_ACCEPTED");
  });

  it("allows handed_to_courier → delivered WITH proof and consumes inventory", () => {
    const order = makeOrder({ fulfillmentState: "handed_to_courier" });
    const decision = decideFulfillmentTransition(order, "delivered", PROOF, "T-5");
    expect(decision.toFulfillmentState).toBe("delivered");
    expect(decision.reasonCode).toBe("DELIVERED_WITH_PROOF");
    expect(decision.consumesInventory).toBe(true);
  });

  it("rejects handed_to_courier → delivered WITHOUT proof", () => {
    const order = makeOrder({ fulfillmentState: "handed_to_courier" });
    try {
      decideFulfillmentTransition(order, "delivered", null, "T-6");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
    }
  });

  it("rejects illegal transition (e.g., confirmed → delivered)", () => {
    const order = makeOrder({ fulfillmentState: "confirmed" });
    try {
      decideFulfillmentTransition(order, "delivered", PROOF, "T-7");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
    }
  });

  it("rejects illegal transition (e.g., delivered → picking)", () => {
    const order = makeOrder({ fulfillmentState: "delivered" });
    try {
      decideFulfillmentTransition(order, "picking", null, "T-8");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
    }
  });

  it("does not consume inventory on non-delivered transitions", () => {
    const order = makeOrder({ fulfillmentState: "confirmed" });
    const decision = decideFulfillmentTransition(order, "picking", null);
    expect(decision.consumesInventory).toBe(false);
  });
});

describe("G-7 core-only failure edges (ADR-026 §4.30 · CLM-0708)", () => {
  const PRE_ASSIGNMENT = ["placed", "confirmed", "picking", "picked", "ready_for_delivery"] as const;

  it("the CORE consumer may close a pre-assignment order as failed — and the reservation is released", () => {
    for (const from of PRE_ASSIGNMENT) {
      const decision = decideFulfillmentTransition(makeOrder({ fulfillmentState: from }), "failed", null, "T-G7", "core");
      expect(decision.toFulfillmentState).toBe("failed");
      expect(decision.reasonCode).toBe("CORE_FULFILLMENT_FAILED");
      expect(decision.releasesInventory).toBe(true);
      expect(decision.consumesInventory).toBe(false);
    }
  });

  it("the public route (origin http — the default) can NOT take a core-only edge", () => {
    for (const from of PRE_ASSIGNMENT) {
      for (const origin of [undefined, "http"] as const) {
        try {
          decideFulfillmentTransition(makeOrder({ fulfillmentState: from }), "failed", null, "T-G7", origin);
          expect.fail(`${from} → failed must be refused from the public route`);
        } catch (e) {
          expect(e).toBeInstanceOf(DeliveryError);
          expect((e as DeliveryError).code).toBe("DELIVERY_TRANSITION_NOT_ALLOWED");
        }
      }
    }
  });

  it("assigned → failed stays a public edge (unchanged) and now releases a still-reserved reservation", () => {
    const decision = decideFulfillmentTransition(makeOrder({ fulfillmentState: "assigned" }), "failed", null);
    expect(decision.reasonCode).toBe("DELIVERY_ATTEMPTS_EXHAUSTED");
    expect(decision.releasesInventory).toBe(true);
  });

  it("draft → failed is not an edge even for CORE", () => {
    expect(() => decideFulfillmentTransition(makeOrder({ fulfillmentState: "draft" }), "failed", null, "T", "core")).toThrow(DeliveryError);
  });
});
