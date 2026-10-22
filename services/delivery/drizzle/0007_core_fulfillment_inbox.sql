--
-- XR-3.5 (CLM-0668 · Revision 7): the CORE fulfillment inbox.
--
-- The delivery service's own inbox for consuming `core.fulfillment.*` events
-- from CORE (the return leg of the XR-4 journey): single-consumption keyed by
-- the event id, and every rejection is NAMED (poisoned / out_of_order /
-- proof_missing) — nothing is swallowed silently. The event_type column is
-- deliberately free-text: a poisoned event is recorded with its raw type even
-- outside the five known ones, and the classifier is the guard.
--
-- Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline
--
CREATE TABLE IF NOT EXISTS core_fulfillment_inbox (
    event_id        UUID        PRIMARY KEY,
    event_type      TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    order_reference TEXT        CHECK (order_reference IS NULL OR order_reference ~ '^WS-[0-9]{10}$'),
    consumed_status TEXT        NOT NULL CHECK (consumed_status IN (
                                   'pending','applied','observed','out_of_order',
                                   'proof_missing','poisoned','error')),
    last_error      TEXT,
    attempt_count   INTEGER     NOT NULL CHECK (attempt_count >= 1),
    consumed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the live, retryable rows are ever scanned.
CREATE INDEX IF NOT EXISTS ix_core_fulfillment_inbox_retryable
    ON core_fulfillment_inbox (updated_at)
    WHERE consumed_status IN ('pending', 'error');
