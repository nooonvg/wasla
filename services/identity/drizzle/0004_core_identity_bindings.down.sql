-- Rollback: drop core incarnation identity keys (CLM-0701).
-- Data loss on rollback is intentional: the binding table is the only record
-- of which CORE generation owns which MARKET identity. Rolling it back
-- returns the service to the legacy channel-only resolution (ADR-076
-- baseline) — no identity_users rows are removed, only the generation map.
-- @wasla-upgrade-proof: all-non-baseline

DROP TABLE IF EXISTS "core_identity_bindings";
