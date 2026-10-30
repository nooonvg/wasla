/**
 * The live MARKET ↔ CORE wiring — pure decisions + the signed intake over HTTP
 * (CLM-0708 · ADR-026 §4.30 · gaps G-1 · G-3 · G-6 · G-7).
 *
 * The PostgreSQL relays are proven in `core-relays.integration.test.ts`; here
 * every decision they carry out is pinned, and the HTTP intake is exercised
 * end-to-end over fakes WITHOUT a service token (CORE holds none).
 */
import { describe, expect, it } from "vitest";

import {
  backoffSeconds,
  classifyCancelResponse,
  classifyEgressResponse,
  closesFulfillment,
  intakeHttpStatus,
  signCoreBody,
  verifyCoreSignature,
} from "../domain/core-link.js";
import type { CoreFulfillmentInboxRecord, CoreFulfillmentInboxStore } from "../ports.js";
import type { CoreFulfillmentLinkStore } from "../infrastructure/pg-core-relays.js";
import { buildSignedDeliveryApp } from "./service-identity-support.js";
import {
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  fixedOrder,
  uuidSequence,
} from "./store-order-fakes.js";

const SECRET = "core-webhook-secret-0123456789abcdef";
const FULFILLMENT = "7f2c9e46-1111-4b22-8c33-0d1e2f3a4b5c";
const ORGANIZATION = "e83f50cc-5808-4873-b58a-722cc3f58070";

describe("classifyEgressResponse — what CORE's answer to a publish means (G-1)", () => {
  it("2xx publishes — including CORE's 202 for a duplicate event_id", () => {
    expect(classifyEgressResponse(200)).toBe("published");
    expect(classifyEgressResponse(202)).toBe("published");
  });
  it("a permanent 4xx is refused (visible, not retried); 408/429 retry", () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(classifyEgressResponse(s)).toBe("refused");
    expect(classifyEgressResponse(408)).toBe("retry");
    expect(classifyEgressResponse(429)).toBe("retry");
  });
  it("network failure and 5xx retry", () => {
    expect(classifyEgressResponse(null)).toBe("retry");
    for (const s of [500, 502, 503, 504]) expect(classifyEgressResponse(s)).toBe("retry");
  });
});

describe("classifyCancelResponse — what CORE's answer to a cancel means (G-6)", () => {
  it("200 and 409 (already closed) are both the end state MARKET wanted", () => {
    expect(classifyCancelResponse(200)).toBe("acknowledged");
    expect(classifyCancelResponse(409)).toBe("acknowledged");
  });
  it("404/403 are refused; 5xx, 408, 429 and network retry", () => {
    expect(classifyCancelResponse(404)).toBe("refused");
    expect(classifyCancelResponse(403)).toBe("refused");
    for (const s of [null, 408, 429, 500, 503]) expect(classifyCancelResponse(s)).toBe("retry");
  });
});

describe("backoffSeconds — bounded exponential", () => {
  it("doubles from the base and is capped", () => {
    expect(backoffSeconds(0)).toBe(5);
    expect(backoffSeconds(1)).toBe(10);
    expect(backoffSeconds(3)).toBe(40);
    expect(backoffSeconds(50)).toBe(900);
    expect(backoffSeconds(-3)).toBe(5);
  });
});

describe("verifyCoreSignature — CORE's HMAC-SHA256 over the raw body (G-3)", () => {
  const body = '{"event_id":"x","payload":{"a":1}}';
  it("accepts exactly CORE's scheme", () => {
    expect(verifyCoreSignature(SECRET, body, signCoreBody(SECRET, body))).toBe(true);
  });
  it("rejects a wrong secret, a changed body, a missing or malformed header", () => {
    expect(verifyCoreSignature(SECRET, body, signCoreBody("another-secret-0123456789abcdefghij", body))).toBe(false);
    expect(verifyCoreSignature(SECRET, `${body} `, signCoreBody(SECRET, body))).toBe(false);
    expect(verifyCoreSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyCoreSignature(SECRET, body, "sha256=zz")).toBe(false);
    expect(verifyCoreSignature(SECRET, body, signCoreBody(SECRET, body).replace("sha256=", "sha1="))).toBe(false);
  });
});

describe("intakeHttpStatus — which result CORE must retry", () => {
  it("settled results acknowledge; results that may become valid later answer 503", () => {
    for (const k of ["applied", "observed", "duplicate", "poisoned", "stale"] as const) expect(intakeHttpStatus(k)).toBe(200);
    for (const k of ["out_of_order", "proof_missing", "order_not_found", "error"] as const) expect(intakeHttpStatus(k)).toBe(503);
  });
  it("completed and cancelled close the fulfillment; created/dispatched do not", () => {
    expect(closesFulfillment("core.fulfillment.completed")).toBe(true);
    expect(closesFulfillment("core.fulfillment.cancelled")).toBe(true);
    expect(closesFulfillment("core.fulfillment.created")).toBe(false);
    expect(closesFulfillment("core.fulfillment.dispatched")).toBe(false);
  });
});

// ── the signed intake over HTTP ───────────────────────────────────────────────

class FakeInbox implements CoreFulfillmentInboxStore {
  readonly rows = new Map<string, CoreFulfillmentInboxRecord>();
  async find(eventId: string) {
    return this.rows.get(eventId) ?? null;
  }
  async recordTerminal(cmd: Parameters<CoreFulfillmentInboxStore["recordTerminal"]>[0]) {
    const prev = this.rows.get(cmd.eventId);
    if (prev && prev.consumedStatus !== "pending" && prev.consumedStatus !== "error") return;
    this.rows.set(cmd.eventId, { ...cmd } as unknown as CoreFulfillmentInboxRecord);
  }
  async recordRetryable(eventId: string, lastError: string) {
    const prev = this.rows.get(eventId);
    this.rows.set(eventId, {
      eventId,
      eventType: prev?.eventType ?? "unknown",
      orderReference: prev?.orderReference ?? null,
      consumedStatus: "error",
      lastError,
    } as unknown as CoreFulfillmentInboxRecord);
  }
}

class FakeLinks implements CoreFulfillmentLinkStore {
  readonly rows = new Map<string, { fulfillmentId: string; closed: boolean }>();
  async record(orderPublicId: string, fulfillmentId: string, closedByCore: boolean) {
    const prev = this.rows.get(orderPublicId);
    this.rows.set(orderPublicId, { fulfillmentId: prev?.fulfillmentId ?? fulfillmentId, closed: (prev?.closed ?? false) || closedByCore });
  }
}

function harness(options: { wired?: boolean } = {}) {
  const store = new FakeStoreOrderStore();
  const reservationStore = new FakeReservationStore();
  store.linkedReservationLedger = reservationStore;
  const inbox = new FakeInbox();
  const links = new FakeLinks();
  const { app, rawInject } = buildSignedDeliveryApp({
    readPort: store,
    writePort: store,
    reservationPort: new FakeReservationPort(),
    reservationStore,
    newUuid: uuidSequence(),
    now: () => "2026-10-30T01:00:00.000Z",
    ...(options.wired === false ? {} : { coreFulfillmentIntake: { secret: SECRET, inbox, links } }),
  });
  return { app, rawInject, store, inbox, links, reservationStore };
}

function seedActiveReservation(reservationStore: FakeReservationStore, order: ReturnType<typeof fixedOrder>) {
  void reservationStore.saveReservations(order.orderId, [
    {
      reservationId: `resv-${order.publicId}`,
      orderId: order.orderId,
      storeSlug: order.storeSlug,
      productId: order.items[0].productId,
      sku: order.items[0].sku,
      quantityReserved: order.items[0].quantity,
      unitPriceMinorUnits: order.items[0].unitPriceMinorUnits,
      marketplaceReservationRef: order.inventoryRef ?? "fake-reservation-ref",
      status: "active",
      reservedAt: "2026-10-30T00:00:00.000Z",
      traceId: null,
    },
  ]);
}

let eventCounter = 0;
function coreEvent(eventType: string, orderRef: string, extra: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    event_id: `01234567-89ab-4cde-8f01-${String(eventCounter).padStart(12, "0")}`,
    event_type: eventType,
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-10-30T00:59:00.000Z",
    correlation_id: "12345678-90ab-4cde-8f01-23456789abce",
    causation_id: null,
    entity_type: "fulfillment",
    entity_id: FULFILLMENT,
    payload: { fulfillment_id: FULFILLMENT, organization_id: ORGANIZATION, order_reference: orderRef, ...extra },
  };
}

function failedCompletion(orderRef: string) {
  return coreEvent("core.fulfillment.completed", orderRef, {
    outcome: "failed",
    completed_at: "2026-10-30T00:59:00.000Z",
    reason: "move_job_rejected",
    settlement_state: "none",
    captured_minor: null,
    financial_decision_required: false,
  });
}

async function deliver(rawInject: ReturnType<typeof harness>["rawInject"], event: unknown, sign = SECRET) {
  const body = JSON.stringify(event);
  return rawInject({
    method: "POST",
    url: "/delivery/core/fulfillment-events",
    headers: {
      "content-type": "application/json",
      "x-wasla-signature": signCoreBody(sign, body),
      "x-wasla-event-id": (event as { event_id?: string }).event_id ?? "",
      "x-wasla-delivery-attempt": "1",
    },
    payload: body,
  });
}

describe("POST /delivery/core/fulfillment-events — the signed intake (G-3)", () => {
  it("not wired → 503 (fail-closed, never an unsigned door)", async () => {
    const { rawInject } = harness({ wired: false });
    const res = await deliver(rawInject, failedCompletion("WS-0000000001"));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ result: "not_wired" });
  });

  it("a wrong signature → 401 and nothing recorded", async () => {
    const { rawInject, inbox, links } = harness();
    const res = await deliver(rawInject, failedCompletion("WS-0000000001"), "forged-secret-0123456789abcdefghijkl");
    expect(res.statusCode).toBe(401);
    expect(inbox.rows.size).toBe(0);
    expect(links.rows.size).toBe(0);
  });

  it("G-7 end-to-end: MOVE rejected → CORE completed(failed) → a ready order becomes failed, reservation released, link closed (200)", async () => {
    const { rawInject, store, links, reservationStore } = harness();
    const order = fixedOrder({
      fulfillmentState: "ready_for_delivery",
      paymentState: "authorized",
      paymentRef: "pay-ref-001",
      inventoryState: "reserved",
      inventoryRef: "fake-reservation-ref",
      version: 5,
    });
    store.seed(order);
    seedActiveReservation(reservationStore, order);
    const res = await deliver(rawInject, failedCompletion(order.publicId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "applied" });
    const after = await store.getOrderByPublicId(order.publicId);
    expect(after?.fulfillmentState).toBe("failed");
    expect(after?.inventoryState).toBe("released");
    expect([...reservationStore.rows.values()].map((r) => r.status)).toEqual(["released"]);
    expect(links.rows.get(order.publicId)).toEqual({ fulfillmentId: FULFILLMENT, closed: true });
  });

  it("a duplicate delivery of the same event → 200 duplicate (no second transition)", async () => {
    const { rawInject, store, reservationStore } = harness();
    const order = fixedOrder({ fulfillmentState: "picking", version: 3 });
    store.seed(order);
    seedActiveReservation(reservationStore, order);
    const event = failedCompletion(order.publicId);
    expect((await deliver(rawInject, event)).statusCode).toBe(200);
    const again = await deliver(rawInject, event);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ result: "duplicate" });
  });

  it("an unknown order → 503 (retryable: the event may have raced the insert) — but the link is recorded", async () => {
    const { rawInject, links } = harness();
    const res = await deliver(rawInject, coreEvent("core.fulfillment.created", "WS-0000000777", { requested_service: "delivery" }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ result: "order_not_found" });
    expect(links.rows.get("WS-0000000777")).toEqual({ fulfillmentId: FULFILLMENT, closed: false });
  });

  it("§4.30-3: an event with no edge from a TERMINAL order is settled stale (200), not retried forever", async () => {
    const { rawInject, store, inbox } = harness();
    const order = fixedOrder({ fulfillmentState: "cancelled", version: 4 });
    store.seed(order);
    const event = coreEvent("core.fulfillment.dispatched", order.publicId, {
      job_reference: "move-job-1",
      dispatched_at: "2026-10-30T00:58:00.000Z",
    });
    const res = await deliver(rawInject, event);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "stale" });
    expect(inbox.rows.get(event.event_id)?.consumedStatus).toBe("out_of_order");
    expect((await deliver(rawInject, event)).json()).toMatchObject({ result: "duplicate" });
  });

  it("a non-terminal out-of-order event stays retryable (503)", async () => {
    const { rawInject, store } = harness();
    const order = fixedOrder({ fulfillmentState: "confirmed", version: 2 });
    store.seed(order);
    const res = await deliver(
      rawInject,
      coreEvent("core.fulfillment.dispatched", order.publicId, { job_reference: "j", dispatched_at: "2026-10-30T00:58:00.000Z" }),
    );
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ result: "out_of_order" });
  });

  it("delivered without proof stays proof_missing (503) — G-4 is still open, proof is never invented", async () => {
    const { rawInject, store } = harness();
    const order = fixedOrder({ fulfillmentState: "handed_to_courier", version: 7 });
    store.seed(order);
    const res = await deliver(
      rawInject,
      coreEvent("core.fulfillment.completed", order.publicId, {
        outcome: "completed",
        completed_at: "2026-10-30T00:59:00.000Z",
        reason: null,
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ result: "proof_missing" });
    expect((await store.getOrderByPublicId(order.publicId))?.fulfillmentState).toBe("handed_to_courier");
  });

  it("a signed malformed payload is poisoned (200 — a retry cannot fix it)", async () => {
    const { rawInject } = harness();
    const bad = coreEvent("core.fulfillment.created", "WS-0000000001");
    (bad.payload as Record<string, unknown>).fulfillment_id = "not-a-uuid";
    const res = await deliver(rawInject, bad);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "poisoned" });
  });

  it("a signed body that is not an envelope at all → 400 (non-retryable)", async () => {
    const { rawInject } = harness();
    const res = await deliver(rawInject, { hello: "world" });
    expect(res.statusCode).toBe(400);
  });

  it("the public fulfillment-transition route can NOT take the core-only edge (409)", async () => {
    const { app, store } = harness();
    const order = fixedOrder({ fulfillmentState: "ready_for_delivery", version: 5 });
    store.seed(order);
    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers: { "idempotency-key": "clm-0708-core-only-edge-0001" },
      payload: { to_state: "failed" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error_code: "DELIVERY_TRANSITION_NOT_ALLOWED" });
    expect((await store.getOrderByPublicId(order.publicId))?.fulfillmentState).toBe("ready_for_delivery");
  });
});
