-- Rollback: drop order_id column (M5-13D · D-03 · CLM-0534).
-- Data loss on rollback is intentional: dropping it loses the engine's order
-- reference, but the column is populated only after intake succeeds and the
-- request still carries order_public_id which is the customer-facing reference.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "customer_order_requests" DROP COLUMN IF EXISTS "order_id";
