/**
 * The live MARKET ↔ CORE wiring — pure decisions (CLM-0708 · ADR-026 §4.30).
 *
 * Four gaps closed by one boundary, every decision here is pure and unit-tested;
 * the PostgreSQL relays and the HTTP intake only carry them out:
 *
 * - G-1 `classifyEgressResponse`  — what a CORE answer to `POST /v1/events` means.
 * - G-3 `verifyCoreSignature`     — the HMAC-SHA256 CORE signs every delivery with.
 * - G-3 `intakeHttpStatus`        — which consumer result CORE must retry.
 * - G-6 `classifyCancelResponse`  — what a CORE answer to the cancel route means.
 * - G-1/G-6 `backoffSeconds`      — bounded exponential backoff for both relays.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Minimum length of the shared webhook secret — CORE refuses shorter ones too. */
export const CORE_WEBHOOK_SECRET_MIN_LENGTH = 32;

/**
 * CORE's answer to a published MARKET event (G-1).
 * - `published`: 2xx (CORE answers 202 to a first copy AND to a duplicate —
 *   ingress is deduplicated by event_id, so a retried publish is safe).
 * - `refused`: a permanent 4xx — CORE will refuse this exact envelope forever,
 *   so the row is marked refused (visible) and never retried.
 * - `retry`: network failure, timeout, 408, 429 or 5xx.
 */
export type EgressOutcome = "published" | "refused" | "retry";

export function classifyEgressResponse(status: number | null): EgressOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "published";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "refused";
  return "retry";
}

/**
 * CORE's answer to `POST /v1/fulfillments/{id}/cancel` (G-6).
 * - `acknowledged`: 200, or 409 — the fulfillment is already closed (cancelled,
 *   completed or failed), which is exactly the end state MARKET wanted to reach.
 * - `refused`: another permanent 4xx (404 unknown fulfillment, 403 not owner…)
 *   — recorded, visible, not retried.
 * - `retry`: everything else.
 */
export type CancelOutcome = "acknowledged" | "refused" | "retry";

export function classifyCancelResponse(status: number | null): CancelOutcome {
  if (status === null) return "retry";
  if ((status >= 200 && status < 300) || status === 409) return "acknowledged";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "refused";
  return "retry";
}

/**
 * Bounded exponential backoff: base · 2^attempts, capped. `attempts` is the
 * count BEFORE this attempt (0 → the first retry waits `base`).
 */
export function backoffSeconds(attempts: number, baseSeconds = 5, maxSeconds = 900): number {
  const exp = Math.min(Math.max(attempts, 0), 20);
  return Math.min(maxSeconds, baseSeconds * 2 ** exp);
}

/**
 * Verify `x-wasla-signature: sha256=<hex>` = HMAC-SHA256(secret, raw body) —
 * the exact scheme CORE's delivery worker signs with. Constant-time; any shape
 * error is simply "not verified" (never an exception the caller must catch).
 */
export function verifyCoreSignature(secret: string, rawBody: string, header: string | undefined | null): boolean {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const got = header.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(got)) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(want, Buffer.from(got, "hex"));
}

/** Sign a body the way CORE does — used by tests and the journey harness. */
export function signCoreBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/**
 * The consumer result → the HTTP status CORE acts on (G-3). CORE retries 5xx,
 * 408, 429 and network failures; any other 4xx stops the delivery for good.
 * So: settled results acknowledge (200); results that may become valid later
 * answer 503 so CORE keeps the delivery alive.
 */
export type ConsumerResultKind =
  | "applied"
  | "observed"
  | "duplicate"
  | "poisoned"
  | "stale"
  | "out_of_order"
  | "proof_missing"
  | "order_not_found"
  | "error";

const RETRYABLE: ReadonlySet<ConsumerResultKind> = new Set(["out_of_order", "proof_missing", "order_not_found", "error"]);

export function intakeHttpStatus(kind: ConsumerResultKind): 200 | 503 {
  return RETRYABLE.has(kind) ? 503 : 200;
}

/** Events after which CORE will not act on the fulfillment again. */
export function closesFulfillment(eventKind: string): boolean {
  return eventKind === "core.fulfillment.completed" || eventKind === "core.fulfillment.cancelled";
}

/** MARKET public id shape — the only `order_reference` a link may carry. */
export const ORDER_PUBLIC_ID = /^WS-[0-9]{10}$/u;

/** Trim + bound a free-text error for a `last_error` column. */
export function boundedError(detail: string, max = 500): string {
  return detail.length > max ? detail.slice(0, max) : detail;
}
