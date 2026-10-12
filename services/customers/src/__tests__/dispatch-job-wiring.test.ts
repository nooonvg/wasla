/**
 * M5-13D — Dispatch job wiring (D-03) behavioral tests.
 *
 * The whole point of this file is to prove what the roadmap claims, not that a
 * function was called: after a successful `POST /orders/intake`, the customer
 * service asks `POST /dispatch/jobs` for that order, deterministically keyed,
 * and a failure of that call does not fail the handover — it is recorded so the
 * missing job is visible, not hidden.
 *
 * The dispatch contract (services/dispatch/contracts/api.openapi.yml) is
 * `additionalProperties: false` on the request body, so every assertion about
 * the payload is exact: `order_id`, `order_public_id`, `zone_id`, `order_type`,
 * `vehicle_class`, and nothing else. `Idempotency-Key` is a header, not a body
 * field, and is required (§43).
 *
 * Idempotency is proven on both sides:
 *  - a replay of the same request does not call `POST /dispatch/jobs` twice with
 *    a *new* key (the key is derived from the request's id, not the attempt);
 *  - a retry after a dispatch failure reuses the same key, so dispatch replays
 *    the job (HTTP `200`), not a duplicate (a second `201`).
 */

import { describe, expect, it } from "vitest";

import { UnavailableOrderIntake } from "../infrastructure/in-memory.js";
import { submitOrderRequest } from "../use-cases/order-requests.js";
import {
  CUSTOMER,
  makeContext,
  rideDraft,
  seedProfile,
  ZONE_A,
} from "./helpers.js";

const KEY = "order-key-dispatch-job";

describe("M5-13D: dispatch job wiring after a successful intake", () => {
  it("posts the published order to /dispatch/jobs with the pickup zone", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const { orderRequest, dispatchJob } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    expect(orderRequest.status).toBe("submitted");
    expect(orderRequest.orderPublicId).toBe("ORD-0000000001");
    // The dispatch contract requires exactly one zone per job: the pickup stop's.
    expect(dispatchJob).not.toBeNull();
    expect(dispatchJob?.status).toBe("pending");
    expect(dispatchJob?.orderPublicId).toBe("ORD-0000000001");

    const body = ctx.dispatch.lastRequest;
    expect(body).not.toBeUndefined();
    // order_id is the engine's own UUID, not this request's id (D-03).
    expect(body?.orderId).toBe("00000000-0000-4000-8000-000000000001");
    expect(orderRequest.orderId).toBe("00000000-0000-4000-8000-000000000001");
    expect(body?.orderPublicId).toBe("ORD-0000000001");
    expect(body?.zoneId).toBe(ZONE_A);
    expect(body?.orderType).toBe("ride");
    expect(body?.vehicleClass).toBe("sedan");
    // Deterministic so a retry is a replay, not a duplicate (§43).
    expect(body?.idempotencyKey).toBe(`dispatch-job-${orderRequest.id}`);
  });

  it("does not fail the handover when opening the dispatch job fails", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    ctx.dispatch.failWith("CUSTOMER_DISPATCH_JOB_UNAVAILABLE");

    const { orderRequest, dispatchJob } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    // The handover succeeded; only the dispatch job is missing.
    expect(orderRequest.status).toBe("submitted");
    expect(orderRequest.orderPublicId).toBe("ORD-0000000001");
    expect(dispatchJob).toBeNull();
  });

  it("does not open a dispatch job when the handover failed", async () => {
    const ctx = makeContext({
      orderIntake: new UnavailableOrderIntake(),
    });
    await seedProfile(ctx);

    await expect(
      submitOrderRequest(ctx, {
        waslaPublicId: CUSTOMER,
        idempotencyKey: KEY,
        draft: rideDraft(),
      }),
    ).rejects.toMatchObject({ code: "CUSTOMER_ORDER_INTAKE_UNAVAILABLE" });
    expect(ctx.dispatch.received).toHaveLength(0);
  });

  it("reuses the same dispatch key on retry so dispatch replays, not duplicates", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const first = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });
    const firstKey = first.dispatchJob !== null && ctx.dispatch.lastRequest
      ? ctx.dispatch.lastRequest.idempotencyKey
      : null;

    // A replay of the same request does not create a second dispatch job.
    const second = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });
    expect(second.replayed).toBe(true);
    expect(second.dispatchJob?.jobId).toBe(first.dispatchJob?.jobId);

    const keys = new Set(ctx.dispatch.received.map((body) => body.idempotencyKey));
    expect(keys.size).toBe(1);
    expect(firstKey).not.toBeNull();
    expect(keys.has(firstKey ?? "")).toBe(true);
  });

  it("retries the dispatch job with the same key after a failure", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    ctx.dispatch.failWith("CUSTOMER_DISPATCH_JOB_UNAVAILABLE");

    const first = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });
    expect(first.dispatchJob).toBeNull();
    expect(ctx.dispatch.received).toHaveLength(0);

    // The retry succeeds and the key is unchanged, so dispatch replays.
    ctx.dispatch.failWith(null);
    const second = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    expect(second.replayed).toBe(true);
    expect(second.dispatchJob).not.toBeNull();
    expect(second.dispatchJob?.status).toBe("pending");
    expect(ctx.dispatch.received).toHaveLength(1);
    expect(ctx.dispatch.lastRequest?.idempotencyKey).toBe(`dispatch-job-${first.orderRequest.id}`);
  });
});
