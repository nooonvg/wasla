--
-- G-1 · G-6 (CLM-0708 · ADR-026 §4.30): the live MARKET ↔ CORE wiring.
--
-- 1) core_egress_outbox gains last_attempt_at (bounded exponential backoff for
--    the relay) and refused_at (CORE answered a permanent 4xx — the row is
--    VISIBLE and never retried; a refusal is not buried under endless retries).
-- 2) core_fulfillment_link records, once, the CORE fulfillment_id behind each
--    store order (every core.fulfillment.* event carries both) — the only key
--    the cancel route accepts. closed_by_core stops a cancel for a fulfillment
--    CORE already closed; the cancel_* columns track the cancel relay.
--
-- Purely additive: no rewrite, no reclassification of any existing row.
-- Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline
--
ALTER TABLE core_egress_outbox ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE core_egress_outbox ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS core_fulfillment_link (
    order_public_id        TEXT        PRIMARY KEY CHECK (order_public_id ~ '^WS-[0-9]{10}$'),
    fulfillment_id         UUID        NOT NULL,
    closed_by_core         BOOLEAN     NOT NULL DEFAULT false,
    cancel_attempts        INTEGER     NOT NULL DEFAULT 0 CHECK (cancel_attempts >= 0),
    cancel_last_error      TEXT,
    cancel_last_attempt_at TIMESTAMPTZ,
    cancel_acknowledged_at TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_core_fulfillment_link_cancel_pending
    ON core_fulfillment_link (cancel_last_attempt_at)
    WHERE closed_by_core = false AND cancel_acknowledged_at IS NULL;
