/**
 * The live MARKET ↔ CORE relays on real PostgreSQL (CLM-0708 · ADR-026 §4.30).
 *
 * G-1: a placed order's outbox row reaches `POST {CORE}/v1/events` with the
 *      full envelope, is marked published, refused (visible) or retried with
 *      backoff, and two concurrent relays never send the same row twice.
 * G-6: a locally cancelled order whose CORE fulfillment is still open is
 *      cancelled in CORE; a fulfillment CORE already closed is never cancelled.
 * G-3: the link store records once and `closed_by_core` only goes false → true.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import {
  PgCoreFulfillmentLinks,
  relayCoreCancelsOnce,
  relayCoreEgressOnce,
  type CoreFetch,
} from "../infrastructure/pg-core-relays.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReservationPort,
  PRODUCT_A,
  STORE_ID,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";
import type { StoreOrder } from "../domain/model.js";
import { PgCoreFulfillmentInbox } from "../infrastructure/pg-core-fulfillment-inbox.js";
import { fulfillmentTransition } from "../use-cases/fulfillment-transition.js";
import { signCoreBody } from "../domain/core-link.js";
import { buildSignedDeliveryApp } from "./service-identity-support.js";

const NOW = "2026-10-30T01:00:00.000Z";
const ORGANIZATION = "e83f50cc-5808-4873-b58a-722cc3f58070";
const FULFILLMENT = "7f2c9e46-1111-4b22-8c33-0d1e2f3a4b5c";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function recordingFetch(statuses: Array<number | "throw">): { fetch: CoreFetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch: CoreFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (next === "throw") throw new Error("ECONNREFUSED");
    return { status: next, text: async () => (next >= 400 ? "nope" : "{}") };
  };
  return { fetch, calls };
}

describe.skipIf(!PG_ENABLED)("CORE relays — PostgreSQL (G-1 · G-6 · G-3)", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetData(pool);
  });

  async function place(): Promise<StoreOrder> {
    const result = await placeStoreOrder(
      {
        catalogPort: new FakeCatalog({ storeId: STORE_ID, orderable: true, organizationId: ORGANIZATION }),
        writePort: store,
        readPort: store,
        reservationPort: new FakeReservationPort(),
        reservationStore: store,
        newUuid: uuidSequence(Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")),
        now: () => NOW,
      },
      { customer_ref: CUSTOMER_REF, store_slug: STORE_SLUG, items: [{ product_id: PRODUCT_A, quantity: 1 }], delivery_fee_minor_units: 500 },
      "relay-trace",
    );
    if (result.kind !== "applied") throw new Error("placement failed");
    return result.order;
  }

  const opts = (fetch: CoreFetch) => ({ coreUrl: "https://core.test/", token: "market-token", fetch, backoffBaseSeconds: 5 });

  it("G-1: publishes the full envelope with MARKET's bearer and marks the row published", async () => {
    const order = await place();
    const { fetch, calls } = recordingFetch([202]);
    expect(await relayCoreEgressOnce(pool, opts(fetch))).toEqual({ sent: 1, refused: 0, retried: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://core.test/v1/events");
    expect(calls[0].headers.authorization).toBe("Bearer market-token");
    expect(calls[0].body).toMatchObject({ event_type: "market.order.created", version: 1, producer: "wasla-market" });
    expect(Object.keys(calls[0].body).sort()).toEqual(
      ["causation_id", "correlation_id", "entity_id", "entity_type", "event_id", "event_type", "occurred_at", "payload", "producer", "version"],
    );
    expect(String(calls[0].body.occurred_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect((calls[0].body.payload as Record<string, unknown>).order_reference ?? order.publicId).toBeTruthy();
    const row = await pool.query(`SELECT published_at, attempts, refused_at FROM core_egress_outbox`);
    expect(row.rows[0].published_at).not.toBeNull();
    expect(row.rows[0].refused_at).toBeNull();
    // a second run sends nothing
    const again = recordingFetch([202]);
    expect(await relayCoreEgressOnce(pool, opts(again.fetch))).toEqual({ sent: 0, refused: 0, retried: 0 });
    expect(again.calls).toHaveLength(0);
  });

  it("G-1: a permanent 4xx is refused — visible, never retried", async () => {
    await place();
    const { fetch } = recordingFetch([422]);
    expect(await relayCoreEgressOnce(pool, opts(fetch))).toEqual({ sent: 0, refused: 1, retried: 0 });
    const row = await pool.query(`SELECT published_at, refused_at, last_error, attempts FROM core_egress_outbox`);
    expect(row.rows[0]).toMatchObject({ published_at: null, attempts: 1 });
    expect(row.rows[0].refused_at).not.toBeNull();
    expect(row.rows[0].last_error).toContain("HTTP 422");
    const again = recordingFetch([202]);
    await pool.query(`UPDATE core_egress_outbox SET last_attempt_at = now() - interval '1 day'`);
    expect((await relayCoreEgressOnce(pool, opts(again.fetch))).sent).toBe(0);
    expect(again.calls).toHaveLength(0);
  });

  it("G-1: network failure and 5xx retry with backoff, then publish", async () => {
    await place();
    const first = recordingFetch(["throw"]);
    expect(await relayCoreEgressOnce(pool, opts(first.fetch))).toEqual({ sent: 0, refused: 0, retried: 1 });
    // inside the backoff window: not attempted
    const early = recordingFetch([202]);
    expect((await relayCoreEgressOnce(pool, opts(early.fetch))).sent).toBe(0);
    expect(early.calls).toHaveLength(0);
    // window elapsed (5s · 2^0) → 503 → retried again
    await pool.query(`UPDATE core_egress_outbox SET last_attempt_at = now() - interval '6 seconds'`);
    const second = recordingFetch([503]);
    expect((await relayCoreEgressOnce(pool, opts(second.fetch))).retried).toBe(1);
    // attempts = 2 → window is 10s: 6s is not enough, 11s is
    await pool.query(`UPDATE core_egress_outbox SET last_attempt_at = now() - interval '6 seconds'`);
    expect((await relayCoreEgressOnce(pool, opts(recordingFetch([202]).fetch))).sent).toBe(0);
    await pool.query(`UPDATE core_egress_outbox SET last_attempt_at = now() - interval '11 seconds'`);
    expect((await relayCoreEgressOnce(pool, opts(recordingFetch([202]).fetch))).sent).toBe(1);
    const row = await pool.query(`SELECT attempts, last_error, published_at FROM core_egress_outbox`);
    expect(row.rows[0]).toMatchObject({ attempts: 3, last_error: null });
  });

  it("G-1: two relays at once never send the same row (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 4; i++) await place();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const slow: CoreFetch = async (_url, init) => {
      seen.push(String((JSON.parse(init.body) as { event_id: string }).event_id));
      await gate;
      return { status: 202, text: async () => "{}" };
    };
    const a = relayCoreEgressOnce(pool, { ...opts(slow), batchSize: 2 });
    const b = relayCoreEgressOnce(pool, { ...opts(slow), batchSize: 2 });
    await new Promise((r) => setTimeout(r, 200));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.sent + rb.sent).toBe(4);
    expect(new Set(seen).size).toBe(seen.length);
    const pub = await pool.query(`SELECT count(*)::int AS n FROM core_egress_outbox WHERE published_at IS NOT NULL`);
    expect(pub.rows[0].n).toBe(4);
  });

  it("G-3: the link records once; closed_by_core only goes false → true; non-WS references are ignored", async () => {
    const links = new PgCoreFulfillmentLinks(pool);
    await links.record("WS-0000000101", FULFILLMENT, false);
    await links.record("WS-0000000101", "11111111-2222-4333-8444-555555555555", true);
    await links.record("WS-0000000101", FULFILLMENT, false);
    await links.record("not-a-public-id", FULFILLMENT, true);
    const rows = await pool.query(`SELECT order_public_id, fulfillment_id::text AS f, closed_by_core FROM core_fulfillment_link`);
    expect(rows.rows).toEqual([{ order_public_id: "WS-0000000101", f: FULFILLMENT, closed_by_core: true }]);
  });

  async function setState(publicId: string, state: string): Promise<void> {
    await pool.query(`UPDATE store_orders SET fulfillment_state = $2 WHERE public_id = $1`, [publicId, state]);
  }

  it("G-6: a local cancellation reaches CORE's cancel route once; 409 (already closed) also acknowledges", async () => {
    const a = await place();
    const b = await place();
    const links = new PgCoreFulfillmentLinks(pool);
    await links.record(a.publicId, FULFILLMENT, false);
    await links.record(b.publicId, "11111111-2222-4333-8444-555555555555", false);
    await setState(a.publicId, "cancelled");
    await setState(b.publicId, "rejected");
    const { fetch, calls } = recordingFetch([200, 409]);
    expect(await relayCoreCancelsOnce(pool, opts(fetch))).toEqual({ sent: 2, refused: 0, retried: 0 });
    expect(calls.map((c) => c.url).sort()).toEqual(
      [`https://core.test/v1/fulfillments/${FULFILLMENT}/cancel`, "https://core.test/v1/fulfillments/11111111-2222-4333-8444-555555555555/cancel"].sort(),
    );
    expect(calls.map((c) => c.body.reason).sort()).toEqual(["market_order_cancelled", "market_order_rejected"]);
    expect(calls[0].headers.authorization).toBe("Bearer market-token");
    const again = recordingFetch([200]);
    expect((await relayCoreCancelsOnce(pool, opts(again.fetch))).sent).toBe(0);
    expect(again.calls).toHaveLength(0);
  });

  it("G-6: never cancels a fulfillment CORE closed, nor an order still open locally", async () => {
    const closed = await place();
    const open = await place();
    const links = new PgCoreFulfillmentLinks(pool);
    await links.record(closed.publicId, FULFILLMENT, true);
    await links.record(open.publicId, "11111111-2222-4333-8444-555555555555", false);
    await setState(closed.publicId, "cancelled");
    const { fetch, calls } = recordingFetch([200]);
    expect(await relayCoreCancelsOnce(pool, opts(fetch))).toEqual({ sent: 0, refused: 0, retried: 0 });
    expect(calls).toHaveLength(0);
  });

  it("G-6: a cancel made BEFORE the link is known is sent once the link arrives; failures retry, 404 is refused", async () => {
    const order = await place();
    await setState(order.publicId, "cancelled");
    const none = recordingFetch([200]);
    expect((await relayCoreCancelsOnce(pool, opts(none.fetch))).sent).toBe(0);
    await new PgCoreFulfillmentLinks(pool).record(order.publicId, FULFILLMENT, false);
    const fail = recordingFetch([503]);
    expect((await relayCoreCancelsOnce(pool, opts(fail.fetch))).retried).toBe(1);
    await pool.query(`UPDATE core_fulfillment_link SET cancel_last_attempt_at = now() - interval '6 seconds'`);
    const gone = recordingFetch([404]);
    expect((await relayCoreCancelsOnce(pool, opts(gone.fetch))).refused).toBe(1);
    await pool.query(`UPDATE core_fulfillment_link SET cancel_last_attempt_at = now() - interval '1 day'`);
    const after = recordingFetch([200]);
    expect((await relayCoreCancelsOnce(pool, opts(after.fetch))).sent).toBe(0);
    const row = await pool.query(`SELECT cancel_attempts, cancel_last_error, cancel_acknowledged_at FROM core_fulfillment_link`);
    expect(row.rows[0]).toMatchObject({ cancel_attempts: 2, cancel_acknowledged_at: null });
    expect(row.rows[0].cancel_last_error).toMatch(/^refused:HTTP 404/u);
  });

  it("end-to-end on PostgreSQL: signed intake → G-7 failed + reservation released + link closed; a later cancel is NOT sent", async () => {
    const order = await place();
    const walk = { readPort: store, writePort: store, newUuid: uuidSequence("e2e00001"), now: () => NOW };
    for (const to of ["confirmed", "picking", "picked", "ready_for_delivery"] as const) {
      const r = await fulfillmentTransition(walk, order.publicId, to, null, "walk");
      if (r.kind !== "applied") throw new Error(`walk to ${to} failed`);
    }
    const secret = "core-webhook-secret-0123456789abcdef";
    const { rawInject, app } = buildSignedDeliveryApp({
      readPort: store,
      writePort: store,
      reservationPort: new FakeReservationPort(),
      reservationStore: store,
      newUuid: uuidSequence("e2e00002"),
      now: () => NOW,
      coreFulfillmentIntake: { secret, inbox: new PgCoreFulfillmentInbox(pool), links: new PgCoreFulfillmentLinks(pool) },
    });
    const event = {
      event_id: "0e2e0000-0000-4000-8000-000000000001",
      event_type: "core.fulfillment.completed",
      version: 1,
      producer: "wasla-core",
      occurred_at: NOW,
      correlation_id: "0e2e0000-0000-4000-8000-0000000000c1",
      causation_id: null,
      entity_type: "fulfillment",
      entity_id: FULFILLMENT,
      payload: {
        fulfillment_id: FULFILLMENT,
        organization_id: ORGANIZATION,
        order_reference: order.publicId,
        outcome: "failed",
        completed_at: NOW,
        reason: "move_job_rejected",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      },
    };
    const body = JSON.stringify(event);
    const res = await rawInject({
      method: "POST",
      url: "/delivery/core/fulfillment-events",
      headers: { "content-type": "application/json", "x-wasla-signature": signCoreBody(secret, body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "applied" });
    const after = await store.getOrderByPublicId(order.publicId);
    expect(after?.fulfillmentState).toBe("failed");
    expect(after?.inventoryState).toBe("released");
    const link = await pool.query(`SELECT fulfillment_id::text AS f, closed_by_core FROM core_fulfillment_link WHERE order_public_id = $1`, [order.publicId]);
    expect(link.rows[0]).toEqual({ f: FULFILLMENT, closed_by_core: true });
    const inboxRow = await pool.query(`SELECT consumed_status FROM core_fulfillment_inbox WHERE event_id = $1`, [event.event_id]);
    expect(inboxRow.rows[0].consumed_status).toBe("applied");
    const transition = await pool.query(
      `SELECT t.from_state, t.reason_code, t.actor_type FROM store_order_transitions t JOIN store_orders o ON o.order_id = t.order_id
        WHERE o.public_id = $1 AND t.state_kind = 'fulfillment' AND t.to_state = 'failed'`,
      [order.publicId],
    );
    expect(transition.rows).toEqual([{ from_state: "ready_for_delivery", reason_code: "CORE_FULFILLMENT_FAILED", actor_type: "system" }]);
    // CORE closed it → the cancel relay never asks CORE to cancel it.
    const { fetch, calls } = recordingFetch([200]);
    await relayCoreCancelsOnce(pool, opts(fetch));
    expect(calls).toHaveLength(0);
    await app.close();
  });
});
