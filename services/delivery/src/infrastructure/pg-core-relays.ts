/**
 * The live MARKET ↔ CORE relays over PostgreSQL (CLM-0708 · ADR-026 §4.30).
 *
 * G-1 `relayCoreEgressOnce`  — reads `core_egress_outbox` and publishes each
 *     unpublished, unrefused row to `POST {CORE}/v1/events`.
 * G-6 `relayCoreCancelsOnce` — sends `POST {CORE}/v1/fulfillments/{id}/cancel`
 *     for every store order cancelled/rejected locally whose CORE fulfillment is
 *     still open and not yet acknowledged.
 * G-3 `PgCoreFulfillmentLinks` — records the fulfillment link the intake learns.
 *
 * Both relays: a small batch under `FOR UPDATE SKIP LOCKED` (two replicas never
 * send the same row at once), bounded exponential backoff, a per-request
 * timeout, and every outcome written back in the same transaction. The meaning
 * of each HTTP answer is decided by the pure functions in `domain/core-link.ts`.
 */
import type { Pool } from "pg";

import {
  ORDER_PUBLIC_ID,
  boundedError,
  classifyCancelResponse,
  classifyEgressResponse,
} from "../domain/core-link.js";

/** The minimal HTTP surface the relays need — `globalThis.fetch` satisfies it. */
export type CoreFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface CoreRelayOptions {
  /** CORE base URL, e.g. `https://core.example` (no trailing slash needed). */
  readonly coreUrl: string;
  /** MARKET's CORE bearer token (bootstrap-issued, producer `wasla-market`). */
  readonly token: string;
  readonly fetch?: CoreFetch;
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  /** Backoff base / cap in seconds (see `backoffSeconds`). */
  readonly backoffBaseSeconds?: number;
  readonly backoffMaxSeconds?: number;
}

export interface RelayRunResult {
  readonly sent: number;
  readonly refused: number;
  readonly retried: number;
}

function base(url: string): string {
  return url.replace(/\/+$/u, "");
}

async function post(
  options: CoreRelayOptions,
  path: string,
  body: unknown,
): Promise<{ status: number | null; detail: string }> {
  const doFetch: CoreFetch = options.fetch ?? (globalThis.fetch as unknown as CoreFetch);
  try {
    const res = await doFetch(`${base(options.coreUrl)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    let text = "";
    try {
      text = await res.text();
    } catch {
      text = "";
    }
    return { status: res.status, detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { status: null, detail: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** SQL fragment: the row is due (never tried, or its backoff has elapsed). */
function dueClause(attemptsCol: string, lastAttemptCol: string): string {
  return `(${lastAttemptCol} IS NULL OR ${lastAttemptCol} + make_interval(secs => LEAST($2::float8, $3::float8 * power(2, LEAST(GREATEST(${attemptsCol} - 1, 0), 20)))) <= now())`;
}

/** G-1: publish one batch of the egress outbox to CORE. */
export async function relayCoreEgressOnce(pool: Pool, options: CoreRelayOptions): Promise<RelayRunResult> {
  const client = await pool.connect();
  let sent = 0;
  let refused = 0;
  let retried = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT event_id, event_type, version, producer, occurred_at, correlation_id, causation_id,
              entity_type, entity_id, payload
         FROM core_egress_outbox
        WHERE published_at IS NULL AND refused_at IS NULL
          AND ${dueClause("attempts", "last_attempt_at")}
        ORDER BY created_at, event_id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [options.batchSize ?? 20, options.backoffMaxSeconds ?? 900, options.backoffBaseSeconds ?? 5],
    );
    for (const r of rows) {
      const envelope = {
        event_id: r.event_id,
        event_type: r.event_type,
        version: r.version,
        producer: r.producer,
        occurred_at: new Date(r.occurred_at).toISOString(),
        correlation_id: r.correlation_id,
        causation_id: r.causation_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        payload: r.payload,
      };
      const { status, detail } = await post(options, "/v1/events", envelope);
      const outcome = classifyEgressResponse(status);
      if (outcome === "published") {
        await client.query(
          `UPDATE core_egress_outbox
              SET published_at = now(), attempts = attempts + 1, last_attempt_at = now(), last_error = NULL
            WHERE event_id = $1`,
          [r.event_id],
        );
        sent++;
      } else if (outcome === "refused") {
        await client.query(
          `UPDATE core_egress_outbox
              SET refused_at = now(), attempts = attempts + 1, last_attempt_at = now(), last_error = $2
            WHERE event_id = $1`,
          [r.event_id, boundedError(detail)],
        );
        refused++;
      } else {
        await client.query(
          `UPDATE core_egress_outbox
              SET attempts = attempts + 1, last_attempt_at = now(), last_error = $2
            WHERE event_id = $1`,
          [r.event_id, boundedError(detail)],
        );
        retried++;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return { sent, refused, retried };
}

/** G-6: propagate one batch of local cancellations/rejections to CORE. */
export async function relayCoreCancelsOnce(pool: Pool, options: CoreRelayOptions): Promise<RelayRunResult> {
  const client = await pool.connect();
  let sent = 0;
  let refused = 0;
  let retried = 0;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT l.order_public_id, l.fulfillment_id::text AS fulfillment_id, o.fulfillment_state
         FROM core_fulfillment_link l
         JOIN store_orders o ON o.public_id = l.order_public_id
        WHERE o.fulfillment_state IN ('cancelled', 'rejected')
          AND l.closed_by_core = false
          AND l.cancel_acknowledged_at IS NULL
          AND (l.cancel_last_error IS NULL OR l.cancel_last_error NOT LIKE 'refused:%')
          AND ${dueClause("l.cancel_attempts", "l.cancel_last_attempt_at")}
        ORDER BY l.created_at, l.order_public_id
        LIMIT $1
        FOR UPDATE OF l SKIP LOCKED`,
      [options.batchSize ?? 20, options.backoffMaxSeconds ?? 900, options.backoffBaseSeconds ?? 5],
    );
    for (const r of rows) {
      const reason = r.fulfillment_state === "rejected" ? "market_order_rejected" : "market_order_cancelled";
      const { status, detail } = await post(
        options,
        `/v1/fulfillments/${encodeURIComponent(r.fulfillment_id)}/cancel`,
        { reason },
      );
      const outcome = classifyCancelResponse(status);
      if (outcome === "acknowledged") {
        await client.query(
          `UPDATE core_fulfillment_link
              SET cancel_acknowledged_at = now(), cancel_attempts = cancel_attempts + 1,
                  cancel_last_attempt_at = now(), cancel_last_error = NULL
            WHERE order_public_id = $1`,
          [r.order_public_id],
        );
        sent++;
      } else {
        await client.query(
          `UPDATE core_fulfillment_link
              SET cancel_attempts = cancel_attempts + 1, cancel_last_attempt_at = now(), cancel_last_error = $2
            WHERE order_public_id = $1`,
          [r.order_public_id, boundedError(outcome === "refused" ? `refused:${detail}` : detail)],
        );
        if (outcome === "refused") refused++;
        else retried++;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return { sent, refused, retried };
}

/** G-3: what the intake records about every valid CORE fulfillment event. */
export interface CoreFulfillmentLinkStore {
  record(orderPublicId: string, fulfillmentId: string, closedByCore: boolean): Promise<void>;
}

export class PgCoreFulfillmentLinks implements CoreFulfillmentLinkStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Insert once; the fulfillment_id is immutable (the first one CORE named
   * wins), and `closed_by_core` only ever goes false → true.
   */
  async record(orderPublicId: string, fulfillmentId: string, closedByCore: boolean): Promise<void> {
    if (!ORDER_PUBLIC_ID.test(orderPublicId)) return;
    await this.pool.query(
      `INSERT INTO core_fulfillment_link (order_public_id, fulfillment_id, closed_by_core)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_public_id) DO UPDATE
         SET closed_by_core = core_fulfillment_link.closed_by_core OR EXCLUDED.closed_by_core`,
      [orderPublicId, fulfillmentId, closedByCore],
    );
  }
}
