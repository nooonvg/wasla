-- Rollback: drop the CORE account deletion inbox (CLM-0701).
-- Data loss on rollback is intentional and bounded: the inbox is operational
-- consumption state, not domain data. The purged customer data is NOT restored
-- by this rollback (a purge is not undoable by design).
-- @wasla-upgrade-proof: all-non-baseline

DROP TABLE IF EXISTS core_account_deletion_inbox;
