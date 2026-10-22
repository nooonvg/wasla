--
-- XR-3.4 (CLM-0670 · Revision 8): the CORE egress outbox + the durable blocked
-- decision (F-38). The event is prepared COMPLETE with its CORE envelope at
-- placement and committed in the placement transaction. Deliberately a SEPARATE
-- table from delivery_outbox: the converter reuses the local event's event_id
-- ("one event, not two"), and the existing table's UNIQUE(event_id) +
-- ON CONFLICT DO NOTHING would silently swallow the CORE row.
--
-- core_egress_blocked records orders whose store has no CORE organization yet
-- (the linking is XR-6.1) — a documented durable outcome, not a silent skip;
-- the verified binding will find these rows to backfill.
--
-- Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline
--
CREATE TABLE IF NOT EXISTS core_egress_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
    version        INTEGER     NOT NULL CHECK (version >= 1),
    producer       TEXT        NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    correlation_id TEXT        NOT NULL,
    causation_id   TEXT,
    entity_type    TEXT        NOT NULL,
    entity_id      TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    published_at   TIMESTAMPTZ,
    attempts       INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_core_egress_outbox_unpublished
    ON core_egress_outbox (event_id)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS core_egress_blocked (
    order_id        UUID        PRIMARY KEY,
    order_public_id TEXT        NOT NULL CHECK (order_public_id ~ '^WS-[0-9]{10}$'),
    reason          TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 96),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
