-- Core incarnation identity keys (CLM-0701): the durable binding between
-- each authenticated CORE account generation and its MARKET identity, plus
-- the anchor the identity service uses to resolve a channel to ONE wasla
-- public id per generation.
--
-- Why: CORE accounts can be deleted and re-created with the SAME channel
-- (e.g. the same Telegram id). Without a generation-scoped key, a re-registered
-- account would inherit the deleted account's MARKET data and identity. With
-- it, each CORE generation gets a FRESH MARKET identity (new wasla_public_id)
-- and the shared channel link is MOVED (not duplicated) to the live
-- generation's identity. The unique (provider, external_id) constraint on
-- identity_links stays intact — one channel owner at any moment.
--
-- This migration is the dated, owner-authorized exception to the ADR-076
-- services/identity freeze (2026-10-25): it ADDS a generation table without
-- touching any of the frozen baseline behavior.
--
-- Backfill-safe: the table starts empty; existing identities are legacy
-- (channel-only) until their next authenticated CORE session binds a
-- generation. Delete flows are driven by the binding, not by this DDL.
-- @wasla-upgrade-proof: all-non-baseline

CREATE TABLE IF NOT EXISTS "core_identity_bindings" (
    "core_identity_id" TEXT PRIMARY KEY,
    "user_internal_uuid" UUID NOT NULL,
    "wasla_public_id" TEXT NOT NULL,
    "bound_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "superseded_at" TIMESTAMPTZ,
    "superseded_by_core_identity_id" TEXT
);

ALTER TABLE "core_identity_bindings"
    ADD CONSTRAINT "core_identity_bindings_user_internal_uuid_fkey"
    FOREIGN KEY ("user_internal_uuid")
    REFERENCES "identity_users" ("internal_uuid")
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS "ix_core_identity_bindings_user"
    ON "core_identity_bindings" (user_internal_uuid, bound_at DESC);
