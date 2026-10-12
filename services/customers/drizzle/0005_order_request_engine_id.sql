-- Add order_id (engine's UUID) to customer_order_requests (M5-13D · D-03 · CLM-0534).
--
-- The dispatch contract's POST /dispatch/jobs requires `order_id` (UUID) which
-- semantically refers to the order engine's own `orders.id`. The previous
-- implementation used the customer request's own id as `order_id`, which is a
-- semantic mismatch (order_id was not the engine's order id). The intake reply
-- now returns `order_id` explicitly, so it must be stored on the request.
--
-- Nullable: NULL until the engine accepts the handover.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "customer_order_requests" ADD COLUMN "order_id" uuid;
