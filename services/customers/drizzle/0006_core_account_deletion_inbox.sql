-- CLM-0701 (استثناءُ ADR-076 المؤرّخُ 2026-10-25): the CORE account deletion
-- inbox — the customer service's own inbox for consuming
-- `core.identity.account.deleted` events from CORE.
--
-- Same standing inbox pattern as XR-3.5 (core_fulfillment_inbox): single
-- consumption keyed by the event id, every rejection NAMED (poisoned /
-- error-retryable), and only the terminal verdict closes the row. The
-- disposition column records the EXPLICIT per-data-category decision (what
-- was purged, what was retained and why — the order_requests retention is an
-- unresolved owner decision, written, never assumed).
--
-- Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline
--
CREATE TABLE IF NOT EXISTS core_account_deletion_inbox (
    event_id         UUID        PRIMARY KEY,
    event_type       TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    core_identity_id  TEXT,
    consumed_status  TEXT        NOT NULL CHECK (consumed_status IN (
                                    'pending','applied','observed','poisoned','error')),
    last_error       TEXT,
    attempt_count    INTEGER     NOT NULL CHECK (attempt_count >= 1),
    disposition      TEXT,
    consumed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the live, retryable rows are ever scanned.
CREATE INDEX IF NOT EXISTS ix_core_account_deletion_inbox_retryable
    ON core_account_deletion_inbox (updated_at)
    WHERE consumed_status IN ('pending', 'error');
