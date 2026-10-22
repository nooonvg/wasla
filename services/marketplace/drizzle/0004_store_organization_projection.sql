-- Store → CORE organization projection (XR-3.4 · F-38): the storage for the
-- store→organization link. Deliberately NULL until a verified binding exists
-- (XR-6.1) — ordinary store creation does NOT accept it (a bare UUID check
-- would bind a store to another tenant). The delivery service keeps the
-- CORE egress blocked (core_egress_blocked) while this is null.
--
-- Backfill-safe: nullable, existing rows keep their meaning (no organization).
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "organization_id" UUID;
