/**
 * تكاملُ مستهلِكِ إغلاقِ التنفيذِ من CORE على PostgreSQL حقيقيةٍ (XR-3.5 ·
 * المراجعةُ 7) — شرطُ الإغلاقِ المكتوبُ في بندِ البندِ نفسِهِ: «اختبارُ
 * تكاملٍ على PostgreSQL حقيقيّةٍ».
 *
 * يختبرُ ما لا يستطيعُ مزيّفٌ إسقاطَهُ: CHECK عقدِ الصندوقِ، والإغلاقُ
 * المفردُ على مفتاحِ الحدثِ، والسمُّ المسمّى، وخارجُ الترتيبِ المسمّى،
 * والإثباتُ المفقودُ المسمّى — وكلُّها على القاعدةِ الحقيقيّةِ لا على
 * وعودٍ في الذاكرةِ.
 *
 * يتخطّى بلا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { PgCoreFulfillmentInbox } from "../infrastructure/pg-core-fulfillment-inbox.js";
import { fulfillmentTransition } from "../use-cases/fulfillment-transition.js";
import { consumeCoreFulfillmentEvent } from "../use-cases/consume-core-fulfillment.js";
import { DeliveryError } from "../domain/errors.js";
import { deriveRequestFingerprint } from "../domain/idempotency.js";
import type { IdempotencyIntent } from "../ports.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import {
  FakeCatalog,
  FakeReservationPort,
  CUSTOMER_REF,
  PRODUCT_A,
  PRODUCT_B,
  STORE_SLUG,
  uuidSequence,
} from "./store-order-fakes.js";
import type { ProofOfDelivery, StoreOrder } from "../domain/model.js";

const NOW = "2026-10-22T10:00:00.000Z";
const ORGANIZATION = "e83f50cc-5808-4873-b58a-722cc3f58070";

const PROOF: ProofOfDelivery = { proofType: "pin_code", proofRef: "pin-77" };

function coreEnvelope(
  eventId: string,
  event_type: string,
  payload: Record<string, unknown>,
) {
  return {
    event_id: eventId,
    event_type,
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-10-22T10:05:00.000Z",
    correlation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    causation_id: null,
    entity_type: "fulfillment",
    entity_id: "7f2c9e46-1111-4b22-8c33-0d1e2f3a4b5c",
    payload,
  };
}

function basePayload(orderReference: string): Record<string, unknown> {
  return {
    fulfillment_id: "7f2c9e46-1111-4b22-8c33-0d1e2f3a4b5c",
    organization_id: ORGANIZATION,
    order_reference: orderReference,
  };
}

describe.skipIf(!PG_ENABLED)("core fulfillment inbox — PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;
  let inbox: PgCoreFulfillmentInbox;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
    inbox = new PgCoreFulfillmentInbox(pool);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetData(pool);
  });

  const ids = () => ({
    newUuid: uuidSequence(`${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")}`),
    now: () => NOW,
  });

  const placement = {
    customer_ref: CUSTOMER_REF,
    store_slug: STORE_SLUG,
    items: [
      { product_id: PRODUCT_A, quantity: 2 },
      { product_id: PRODUCT_B, quantity: 1 },
    ],
    delivery_fee_minor_units: 500,
  };

  async function placedOrder(): Promise<StoreOrder> {
    const deps = {
      catalogPort: new FakeCatalog(),
      writePort: store,
      readPort: store,
      reservationPort: new FakeReservationPort(),
      // الدفترُ الحقيقيُّ (DB) لا الزائفةُ: إفراجُ §4.29 يقرأُ الحجوزاتِ النشطةَ
      // من الدفترِ — فتُخزَّنُ عندَ الحجزِ حيثَ يُقرؤُ الإفراجُ.
      reservationStore: store,
      ...ids(),
    };
    const result = await placeStoreOrder(deps, placement, "integration");
    if (result.kind !== "applied") throw new Error("placement failed");
    return result.order;
  }

  /** مسارُ التاجرِ القائمُ حتىَ جاهزيّةِ التسليمِ — بمسارٍ واحدٍ لا جسرًا. */
  async function walkToReadyForDelivery(order: StoreOrder): Promise<StoreOrder> {
    const deps = { readPort: store, writePort: store, ...ids() };
    const steps = ["confirmed", "picking", "picked", "ready_for_delivery"] as const;
    let current = order;
    for (const to of steps) {
      const result = await fulfillmentTransition(deps, current.publicId, to, null, "walk");
      if (result.kind !== "applied") throw new Error(`walk to ${to} failed`);
      current = result.order;
    }
    return current;
  }

  const consumeDeps = (reservationPort: FakeReservationPort = new FakeReservationPort()) => ({
    inbox,
    orders: store,
    transition: {
      readPort: store,
      writePort: store,
      reservationPort,
      reservationStore: store,
      ...ids(),
    },
  });

  it("الرحلةُ كاملةً: dispatched ← assigned (إسنادٌ لا استلامٌ) ثم completed بالتسليمِ والإثباتِ ← delivered", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());

    const dispatched = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(dispatched.kind).toBe("applied");
    expect(dispatched.kind === "applied" && dispatched.order.fulfillmentState).toBe("assigned");

    const delivered = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.completed", {
        ...basePayload(order.publicId),
        outcome: "completed",
        completed_at: "2026-10-22T10:40:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
      PROOF,
    );
    expect(delivered.kind).toBe("applied");
    expect(delivered.kind === "applied" && delivered.order.fulfillmentState).toBe("delivered");
  });

  it("الإغلاقُ المفردُ: إعادةُ إرسالِ حدثٍ حُسِمَ = duplicate بلا أثرٍ ولا انتقالٍ ثانٍ", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    const eventId = crypto.randomUUID();
    const first = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(first.kind).toBe("applied");
    const row = await pool.query<{ consumed_status: string; attempt_count: number }>(
      `SELECT consumed_status, attempt_count FROM core_fulfillment_inbox WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(row.rows[0]).toMatchObject({ consumed_status: "applied", attempt_count: 1 });

    const again = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(again.kind).toBe("duplicate");
    // ولا انتقالَ ثانيًا: الحالةُ كما هيَ والصندوقُ صفٌّ واحدٌ.
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("assigned");
    const count = await pool.query(`SELECT count(*)::int AS n FROM core_fulfillment_inbox`);
    expect(count.rows[0]["n"]).toBe(1);
  });

  it("الإثباتُ بوّابةٌ: completed بالتسليمِ بلا إثباتٍ = proof_missing مسمّى والحالةُ لا تتحرّكُ", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    const noProof = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.completed", {
        ...basePayload(order.publicId),
        outcome: "completed",
        completed_at: "2026-10-22T10:40:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
      // بلا إثباتٍ عمدًا — البوّابةُ (§2.4) لا تُستثنى لأحدٍ.
    );
    expect(noProof.kind).toBe("proof_missing");
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("assigned");
  });

  it("خارجُ الترتيبِ مسمّى: dispatched على طلبٍ لم يبلغِ الجاهزيّةَ = out_of_order لا قفزَ فوقَ الآلةِ", async () => {
    const order = await placedOrder(); // ما زالَ placed.
    const result = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(result).toMatchObject({
      kind: "out_of_order",
      from: "placed",
      to: "assigned",
    });
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("placed");
  });

  it("السمُّ مسمّى: حمولةٌ تخالفُ العقدَ = poisoned يُسجَّلُ بنوعِهِ الخامِ", async () => {
    const poisoned = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload("WS-0000000001"),
        job_reference: "job-1",
        // dispatched_at ناقصٌ — العقدُ يُلزِمُهُ.
      }),
    );
    expect(poisoned.kind).toBe("poisoned");
    const row = await pool.query<{ consumed_status: string; last_error: string }>(
      `SELECT consumed_status, last_error FROM core_fulfillment_inbox`,
    );
    expect(row.rows[0]).toMatchObject({
      consumed_status: "poisoned",
      last_error: expect.stringContaining("dispatched_at"),
    });
  });

  it("مرجعٌ لا تملكُهُ الخدمةُ = order_not_found مسمّى لا فقدًا صامتًا", async () => {
    const result = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.created", {
        ...basePayload("WS-9999999999"),
        requested_service: "delivery",
      }),
    );
    expect(result.kind).toBe("order_not_found");
  });

  it("الإيصالُ المرتبطُ بالحدثِ: انهيارٌ ثمّ تقدّمُ الأحداثِ — إعادةُ الإرسالِ تجدُ الإيصالَ فتعودُ applied لا خارجَ الترتيبِ", async () => {
    // هذا هوَ امتحانُ الحالةِ التي لا يُغني عنها كشفُ الحالةِ: الحدثُ التزمَ
    // أثرَهُ، وفُقدَ إيصالُ الصندوقِ، ثمّ تقدّمتِ الأحداثُ بعدهُ.
    const order = await walkToReadyForDelivery(await placedOrder());
    const eventId = crypto.randomUUID();
    const first = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(first.kind).toBe("applied");
    // محاكاةُ الانهيارِ: الأثرُ والتماثُلُ التزما، وإيصالُ الصندوقِ لم يُكتبْ.
    await pool.query(`DELETE FROM core_fulfillment_inbox WHERE event_id = $1::uuid`, [eventId]);
    // ثمّ يتقدّمُ الطلبُ: إغلاقٌ بالتسليمِ والإثباتِ ← delivered.
    const completion = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.completed", {
        ...basePayload(order.publicId),
        outcome: "completed",
        completed_at: "2026-10-22T10:40:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
      PROOF,
    );
    expect(completion.kind).toBe("applied");
    // الآنَ إعادةُ إرسالِ الحدثِ الأولِ: الحالةُ صارتْ delivered — ولا إعلانَ
    // «خارجَ الترتيبِ» أبدًا: إيصالُ التماثُلِ المرتبطُ بالحدثِ يُجيبُ applied.
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(replay.kind).toBe("applied");
    const row = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM core_fulfillment_inbox WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(row.rows[0]).toMatchObject({ consumed_status: "applied" });
    // والحالةُ لم تتأثرْ بإعادةِ الإرسالِ.
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("delivered");
  });

  it("مفتاحُ حدثٍ ليسَ UUID = سمٌّ مسمّى بمفتاحٍ بديلٍ حتميٍّ لا استثناءً يُفجّرُ القاعدةَ", async () => {
    const poisoned = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      {
        ...coreEnvelope("", "core.fulfillment.created", {
          ...basePayload("WS-0000000001"),
          requested_service: "delivery",
        }),
        event_id: "not-a-uuid-at-all",
      },
    );
    expect(poisoned).toMatchObject({ kind: "poisoned", error: expect.stringContaining("invalid_event_id") });
    // الصفُّ مسجّلٌ تحتَ المفتاحِ البديلِ — سمٌّ مرئيٌّ لا اختفاءٌ.
    const row = await pool.query<{ consumed_status: string; last_error: string }>(
      `SELECT consumed_status, last_error FROM core_fulfillment_inbox WHERE last_error LIKE 'invalid_event_id%'`,
    );
    expect(row.rows[0]).toMatchObject({ consumed_status: "poisoned" });
    // وإعادةُ الإرسالِ تعيدُ المفتاحَ نفسَهُ = duplicate (لا يتضاعفُ السمُّ).
    const again = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      {
        ...coreEnvelope("", "core.fulfillment.created", {
          ...basePayload("WS-0000000001"),
          requested_service: "delivery",
        }),
        event_id: "not-a-uuid-at-all",
      },
    );
    expect(again.kind).toBe("poisoned");
    const count = await pool.query(`SELECT count(*)::int AS n FROM core_fulfillment_inbox WHERE last_error LIKE 'invalid_event_id%'`);
    expect(count.rows[0]["n"]).toBe(1);
  });

  it("نوعٌ حدثٍ أطولُ من حدِّ العقدِ (96) = سمٌّ يُقصُّ ويسجَّلُ لا CHECKٌ يُفجّرُ التسجيلَ", async () => {
    const longType = "core.fulfillment." + "x".repeat(150);
    const poisoned = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), longType, { ...basePayload("WS-0000000001") }),
    );
    expect(poisoned.kind).toBe("poisoned");
    const row = await pool.query<{ event_type: string; consumed_status: string }>(
      `SELECT event_type, consumed_status FROM core_fulfillment_inbox WHERE consumed_status = 'poisoned' AND event_type LIKE 'core.fulfillment.x%'`,
    );
    expect(row.rows[0]).toMatchObject({ consumed_status: "poisoned" });
    expect((row.rows[0]["event_type"] as string).length).toBe(96);
  });

  it("CHECK عقدِ الصندوقِ نفسِهِ: نوعٌ قصيرٌ ترفضُهُ القاعدةُ لا التطبيقُ وحدَهُ", async () => {
    // attempt_count يُعطى صراحةً حتى يكونَ المُرفِضُ هوَ CHECKُ النوعِ لا NOT NULL قبله.
    await expect(
      pool.query(
        `INSERT INTO core_fulfillment_inbox (event_id, event_type, consumed_status, attempt_count)
         VALUES ($1::uuid, 'ab', 'pending', 1)`,
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow(/core_fulfillment_inbox_event_type_check/);
  });

  it("نافذةُ الانهيارِ: لو انهارَ التنفيذُ بعدَ الانتقالِ وقبلَ الإيصالِ فإعادةُ الإرسالِ تُسجِّلُ applied لا خارجَ الترتيبِ", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    const eventId = crypto.randomUUID();
    const first = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(first.kind).toBe("applied");
    // محاكاةُ الانهيارِ: الانتقالُ التزمَ والإيصالُ لم يُكتبْ بعدُ.
    await pool.query(`DELETE FROM core_fulfillment_inbox WHERE event_id = $1::uuid`, [eventId]);
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(replay.kind).toBe("applied");
    const row = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM core_fulfillment_inbox WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(row.rows[0]).toMatchObject({ consumed_status: "applied" });
  });

  it("الخصمُ النهائيُّ مرةً واحدةً: delivered من assigned بالإثباتِ يستهلِكُ المخزونَ، وإعادةُ الإرسالِ لا تُكرِّرُ (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    // قبلَ الإسنادِ: المخزونُ محجوزٌ لا مُستهلَك.
    const reserved = await store.getOrderByPublicId(order.publicId);
    expect(reserved?.inventoryState).toBe("reserved");
    await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    const completionId = crypto.randomUUID();
    const delivered = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(completionId, "core.fulfillment.completed", {
        ...basePayload(order.publicId),
        outcome: "completed",
        completed_at: "2026-10-22T10:40:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
      PROOF,
    );
    expect(delivered.kind).toBe("applied");
    expect(delivered.kind === "applied" && delivered.order.fulfillmentState).toBe("delivered");
    // الخصمُ النهائيُّ وقعَ في الإغلاقِ نفسِهِ (الوجهةُ delivered — §4.29).
    const consumed = await store.getOrderByPublicId(order.publicId);
    expect(consumed?.inventoryState).toBe("consumed");
    // وإعادةُ إرسالِ الإغلاقِ لا تُكرِّرُ الخصمَ: الإيصالُ يُجيبُ duplicate.
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(completionId, "core.fulfillment.completed", {
        ...basePayload(order.publicId),
        outcome: "completed",
        completed_at: "2026-10-22T10:40:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
      PROOF,
    );
    expect(replay.kind).toBe("duplicate");
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("delivered");
    expect(still?.inventoryState).toBe("consumed");
  });

  it("الإلغاءُ بعدَ الإسنادِ: core.fulfillment.cancelled على طلبٍ في assigned يُطبَّقُ (CORE يُغلقُ من dispatched)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    const dispatched = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(dispatched.kind).toBe("applied");
    const cancelled = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.cancelled", {
        ...basePayload(order.publicId),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T10:20:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(cancelled.kind).toBe("applied");
    expect(cancelled.kind === "applied" && cancelled.order.fulfillmentState).toBe("cancelled");
    // §4.29 (الإفراجُ المقيسُ): كلُّ حافّةٍ إلى `cancelled` — ومنها إلغاءُ CORE من
    // `assigned` — تُفرِجُ الحجزَ في المسارِ الواحدِ نفسِهِ (إعادةُ استخدامٍ لجزءِ
    // مسارِ إلغاءِ العميلِ): المخزونُ `released` لا `reserved`، والحدثُ في الصندوقِ.
    const afterCancel = await store.getOrderByPublicId(order.publicId);
    expect(afterCancel?.inventoryState).toBe("released");
    // والحجوزاتُ النشطةُ في الدفترِ انتهت.
    const activeReservations = await store.loadActiveReservations(afterCancel!.orderId);
    expect(activeReservations).toHaveLength(0);
    // وحدثُ الإفراجِ في الصندوقِ (نفسُ معاملةِ الانعكاسِ).
    const releasedRows = await pool.query(
      `SELECT event_type FROM delivery_outbox WHERE event_type = 'store_order.inventory_released' AND aggregate_id = $1`,
      [afterCancel!.orderId],
    );
    expect(releasedRows.rowCount).toBe(1);
  });

  it("إيصالٌ معامليٌّ تاريخيٌّ (نافذةُ الانهيارِ بالمعنى القديمِ): dispatched التزمَ قديمًا إلى handed_to_courier وصندوقُ الاستهلاكِ لم يُكتبْ — إعادةُ الإرسالِ تجدُ الإيصالَ فتُسجِّلُ applied بلا انتقالٍ جديدٍ ولا تراجعٍ (§4.29)", async () => {
    // هذهِ هيَ النافذةُ الأخطرُ: الانتهيارُ بعدَ التزامِ الانتقالِ وقبلَ إيصالِ
    // الصندوقِ — والإيصالُ المرتبطُ بالحدثِ (`core-fulfillment:${eventId}:v1`) مكتوبٌ
    // **بالمعنى القديمِ**: وجهةُ الإسقاطِ كانتَ `handed_to_courier`. بعدَ الرقعةِ،
    // إعادةُ الإرسالِ تجدُ الإيصالَ المعامليَّ قبلَ أيِّ إسقاطٍ فتُسجِّلُ الحسمَ
    // وتُجيبُ applied — لا انتقالَ جديدَ ولا إعادةَ تصنيفٍ ولا تراجعًا رغمَ تغيُّرِ
    // وجهةِ الإسقاطِ الجديدةِ إلى `assigned`.
    const order = await walkToReadyForDelivery(await placedOrder());
    const oldEventId = crypto.randomUUID();
    const intent: IdempotencyIntent = {
      key: `core-fulfillment:${oldEventId}:v1`,
      route: "POST /store-orders/{orderPublicId}/fulfillment-transition",
      fingerprint: deriveRequestFingerprint(
        "POST /store-orders/{orderPublicId}/fulfillment-transition",
        order.publicId,
        { event_type: "core.fulfillment.dispatched" },
      ),
      responseStatus: 200,
      buildResponseBody: () => ({ kind: "applied", event_type: "core.fulfillment.dispatched" }),
    };
    // الانتهيارُ المُحاكى بالمعنى القديمِ: الانتقالُ التزمَ (handed_to_courier)
    // والإيصالُ المعامليُّ مكتوبٌ، وصندوقُ الاستهلاكِ لم يُكتبْ بعدُ.
    const legacy = await fulfillmentTransition(
      { readPort: store, writePort: store, ...ids() },
      order.publicId,
      "handed_to_courier",
      null,
      "old-world-crash-window",
      intent,
    );
    expect(legacy.kind).toBe("applied");
    const receipt = await store.findIdempotentResponse(intent.key);
    expect(receipt).not.toBeNull();
    // إعادةُ الإرسالِ بعدَ الرقعةِ: الإيصالُ المعامليُّ يُجيبُ قبلَ الإسقاطِ.
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(oldEventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-old-crash",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(replay.kind).toBe("applied");
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("handed_to_courier");
  });

  it("استئنافُ التسويةِ (أ): إفراجُ السوقِ يفشلُ بعدَ التزامِ الإلغاءِ — إعادةُ الحدثِ تُستأنفُ الإفراجَ ولا تُكرِّرُ الانتقالَ ولا الأثرَ (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    const flaky = new FakeReservationPort();
    flaky.failNextReleases = 1;
    const eventId = crypto.randomUUID();
    // التطبيقُ: الانتقالُ يلتزمُ (cancelled) ثمّ إفراجُ السوقِ يفشلُ — الحدثُ
    // يبقى حيًّا قابلًا للإعادةِ (خطأٌ لا حسمٌ).
    const first = await consumeCoreFulfillmentEvent(
      consumeDeps(flaky),
      coreEnvelope(eventId, "core.fulfillment.cancelled", {
        ...basePayload(order.publicId),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T10:20:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(first.kind).not.toBe("applied");
    const afterFirst = await store.getOrderByPublicId(order.publicId);
    expect(afterFirst?.fulfillmentState).toBe("cancelled");
    expect(afterFirst?.inventoryState).toBe("reserved");
    // إعادةُ الحدثِ نفسِهِ: الإيصالُ المعامليُّ يُجيبُ — والتسويةُ **تُستأنفُ** قبلَ
    // الحسمِ: الإفراجُ يكتملُ والانتقالُ لا يتكرَّرُ.
    const second = await consumeCoreFulfillmentEvent(
      consumeDeps(flaky),
      coreEnvelope(eventId, "core.fulfillment.cancelled", {
        ...basePayload(order.publicId),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T10:20:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(second.kind).toBe("applied");
    // النتيجةُ المعادةُ نفسُها تحملُ ما بعدَ التسويةِ (لا اللقطةَ قبلَها) —
    // فحصُ الحالةِ في الجوابِ لا في قراءةٍ لاحقةٍ وحدَها.
    expect(second.kind === "applied" && second.order.inventoryState).toBe("released");
    const settled = await store.getOrderByPublicId(order.publicId);
    expect(settled?.inventoryState).toBe("released");
    // والأثرُ لا يتكرَّرُ: حدثُ إفراجٍ واحدٌ وحافةُ إلغاءٍ واحدةٌ في الدفترِ.
    const releasedRows = await pool.query(
      `SELECT count(*)::int AS n FROM delivery_outbox
        WHERE event_type = 'store_order.inventory_released' AND aggregate_id = $1`,
      [settled!.orderId],
    );
    expect(releasedRows.rows[0].n).toBe(1);
    const cancelledEdges = await pool.query(
      `SELECT count(*)::int AS n FROM store_order_transitions
        WHERE order_id = $1 AND state_kind = 'fulfillment' AND to_state = 'cancelled'`,
      [settled!.orderId],
    );
    expect(cancelledEdges.rows[0].n).toBe(1);
  });

  it("استئنافُ التسويةِ (ب): إفراجُ السوقِ ينجحُ والكتابةُ المحليّةُ تنهارُ — الإعادةُ تتقاربُ إلى released بلا فقدٍ ولا تكرارِ أثرٍ (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    // غلافٌ حولَ المخزنِ الحقيقيِّ يُسقِطُ settleInventoryRelease مرةً واحدةً —
    // محاكاةُ انهيارٍ بعدَ نجاحِ الإفراجِ الخارجيِّ وقبلَ اكتمالِ الكتابةِ المحليّةِ.
    const flakySettle = { armed: true };
    const wrappedWrite = new Proxy(store, {
      get(target: typeof store, prop: string, _receiver: unknown): unknown {
        if (prop === "settleInventoryRelease") {
          const bound = Reflect.get(target, prop, target) as (write: unknown) => unknown;
          return async (write: unknown) => {
            if (flakySettle.armed) {
              flakySettle.armed = false;
              throw new DeliveryError("DELIVERY_DATABASE_UNAVAILABLE", "انهيارٌ مُحاكى بعدَ الإفراجِ");
            }
            return bound.call(target, write);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const port = new FakeReservationPort();
    const depsWithFlakyWrite = {
      inbox,
      orders: store,
      transition: {
        readPort: store,
        writePort: wrappedWrite as unknown as typeof store,
        reservationPort: port,
        reservationStore: store,
        ...ids(),
      },
    };
    const eventId = crypto.randomUUID();
    const payload = {
      ...basePayload(order.publicId),
      reason: "customer_changed_mind",
      cancelled_at: "2026-10-22T10:20:00.000Z",
      settlement_state: "none",
      captured_minor: null,
      financial_decision_required: false,
    };
    const first = await consumeCoreFulfillmentEvent(
      depsWithFlakyWrite,
      coreEnvelope(eventId, "core.fulfillment.cancelled", payload),
    );
    expect(first.kind).not.toBe("applied");
    // الإفراجُ الخارجيُّ نجحَ (السوقَ نُوديَ) والكتابةُ المحليّةُ انهارتْ — الحجزُ
    // باقٍ في الدفترِ (الذرّيّةُ) فالإعادةُ تُعيدُ المحاولةَ كلَّها.
    expect(port.releaseCalls).toBe(1);
    const second = await consumeCoreFulfillmentEvent(
      depsWithFlakyWrite,
      coreEnvelope(eventId, "core.fulfillment.cancelled", payload),
    );
    expect(second.kind).toBe("applied");
    expect(second.kind === "applied" && second.order.inventoryState).toBe("released");
    const settled = await store.getOrderByPublicId(order.publicId);
    expect(settled?.inventoryState).toBe("released");
    // نداءُ السوقِ تكرَّرَ (إفراجٌ مُتماثِلٌ لا أثرٌ) والحدثُ واحدٌ لا يتضاعفُ.
    expect(port.releaseCalls).toBe(2);
    const releasedRows = await pool.query(
      `SELECT count(*)::int AS n FROM delivery_outbox
        WHERE event_type = 'store_order.inventory_released' AND aggregate_id = $1`,
      [settled!.orderId],
    );
    expect(releasedRows.rows[0].n).toBe(1);
  });

  it("استئنافُ التسويةِ (هـ): جوابُ replayed من فحصِ التماثُلِ داخلَ معاملةِ الكتابةِ لا يتجاوزُ التسويةَ (§4.29)", async () => {
    // سباقٌ محددٌ: الفحصُ الابتدائيُّ لا يجدُ إيصالًا، ثمّ يجيبُ محوّلُ الكتابةِ
    // `replayed` من فحصِهِ الداخليِّ (التزامٌ متزامنٌ بينَ الفحصينِ). هذا الجوابُ
    // كانَ سيتجاوزُ التسويةَ — والآن يمرُّ عبرَها: الإلغاءُ المحجوزُ يُسوَّى رغمَهُ.
    const order = await walkToReadyForDelivery(await placedOrder());
    const writePortReturningReplayed = new Proxy(store, {
      get(target: typeof store, prop: string, _receiver: unknown): unknown {
        if (prop === "fulfillmentTransition") {
          const bound = Reflect.get(target, prop, target) as (write: unknown) => Promise<unknown>;
          return async (write: unknown) => {
            // الانتقالُ يلتزمُ فعلًا (والإيصالُ يُخزَّنُ) — لكنّ الجوابَ للنمطِ
            // السباقيِّ: replayed.
            await bound.call(target, write);
            return { kind: "replayed", status: 200, body: null };
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const eventId = crypto.randomUUID();
    const result = await consumeCoreFulfillmentEvent(
      {
        inbox,
        orders: store,
        transition: {
          readPort: store,
          writePort: writePortReturningReplayed as unknown as typeof store,
          reservationPort: new FakeReservationPort(),
          reservationStore: store,
          ...ids(),
        },
      },
      coreEnvelope(eventId, "core.fulfillment.cancelled", {
        ...basePayload(order.publicId),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T10:20:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    // الجوابُ replayed (سباقُ التزامٍ) — والتسويةُ لم تتخطَّهُ: الإفراجُ وقعَ.
    expect(result.kind).toBe("applied");
    expect(result.kind === "applied" && result.order.inventoryState).toBe("released");
    const settled = await store.getOrderByPublicId(order.publicId);
    expect(settled?.inventoryState).toBe("released");
  });

  it("استئنافُ التسويةِ (و): سباقٌ محددٌ — محاولةٌ أخرى تُكمِلُ التسويةَ قبلَ مساعدِنا: النتيجةُ المعادةُ تحملُ released ونسخةَ ما بعدَ التسويةِ لا اللقطةَ القديمةَ (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    // غلافٌ حولَ المخزنِ الحقيقيِّ: الانتقالُ يلتزمُ (cancelled · v6 · reserved)
    // ثمّ يُكمِلُ الغلافُ التسويةَ **بنفسِهِ** قبلَ أن يُعيدَ نتيجةَ applied القديمةَ —
    // فحينَ يقرأُ مساعدُ التسويةِ الطلبَ يجدُهُ released فيُجيبُ not_needed بطلبٍ
    // طازجٍ: والعائدُ للخارجِ هوَ هذا الطازجُ (v7 · released) لا اللقطةُ القديمةُ.
    const port = new FakeReservationPort();
    const wrapper = new Proxy(store, {
      get(target: typeof store, prop: string, _receiver: unknown): unknown {
        if (prop === "fulfillmentTransition") {
          const bound = Reflect.get(target, prop, target) as (write: unknown) => Promise<unknown>;
          return async (write: unknown) => {
            const result = (await bound.call(target, write)) as { kind: string; order?: { orderId: string; version: number; publicId: string } };
            if (result.kind === "applied" && result.order && result.order.version >= 6) {
              // «محاولةٌ أخرى» أكمَلَتِ التسويةَ قبلَ عودةِ النتيجةِ.
              await port.release();
              await store.settleInventoryRelease({
                orderId: result.order.orderId,
                expectedVersion: result.order.version,
                fromInventoryState: "reserved",
                toInventoryState: "released",
                inventoryRef: "fake-reservation-ref",
                reasonCode: "INVENTORY_RELEASED",
                events: [],
                traceId: null,
              });
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    // الاستدعاءُ **مباشرٌ لحالةِ الاستخدامِ** لا عبرَ المستهلكِ — مسارُ المستهلكِ
    // يُعيدُ قراءةَ الطلبِ لاحقًا فيمكنُ أن ينجحَ حتى لو أعادتِ الحالةُ القديمةَ؛
    // هنا النتيجةُ المعادةُ من fulfillmentTransition نفسِها هي المفحوصةُ.
    const staleVersion = { value: -1 };
    const recordingWrapper = new Proxy(wrapper as object, {
      get(target: object, prop: string | symbol, receiver: object): unknown {
        if (prop === "fulfillmentTransition") {
          const inner = Reflect.get(target, prop, target) as (write: unknown) => Promise<unknown>;
          return async (write: unknown) => {
            const result = (await inner(write)) as { kind: string; order?: { version: number } };
            if (result.kind === "applied" && result.order) staleVersion.value = result.order.version;
            return result;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await fulfillmentTransition(
      {
        readPort: store,
        writePort: recordingWrapper as unknown as typeof store,
        reservationPort: port,
        reservationStore: store,
        ...ids(),
      },
      order.publicId,
      "cancelled",
      null,
      null,
      {
        key: `direct-cancel-${crypto.randomUUID()}`,
        route: "POST /store-orders/{orderPublicId}/fulfillment-transition",
        fingerprint: "a".repeat(64),
        responseStatus: 200,
        buildResponseBody: () => ({ kind: "applied" }),
      },
    );
    expect(result.kind).toBe("applied");
    // النتيجةُ الخارجيّةُ تحملُ ما بعدَ التسويةِ: released — ونسختُها ليست
    // «رقمًا ثابتًا» بل المعادلةُ المسجَّلةُ: نسخةُ اللقطةِ القديمةِ + 1 = نسخةُ
    // ما بعدَ التسويةِ في قاعدةِ البياناتِ.
    expect(result.kind === "applied" && result.order.inventoryState).toBe("released");
    const settled = await store.getOrderByPublicId(order.publicId);
    expect(settled?.inventoryState).toBe("released");
    expect(staleVersion.value).toBeGreaterThan(0);
    expect(result.kind === "applied" && result.order.version).toBe(staleVersion.value + 1);
    expect(result.kind === "applied" && result.order.version).toBe(settled?.version);
  });

  it("استئنافُ التسويةِ (جـ): السوقُ يرفضُ الإفراجَ (released: false) — لا حسمَ نهائيَّ صامتًا، الحدثُ يبقى حيًّا (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    const refusing = new FakeReservationPort();
    refusing.refuseReleases = true;
    const eventId = crypto.randomUUID();
    const payload = {
      ...basePayload(order.publicId),
      reason: "customer_changed_mind",
      cancelled_at: "2026-10-22T10:20:00.000Z",
      settlement_state: "none",
      captured_minor: null,
      financial_decision_required: false,
    };
    const first = await consumeCoreFulfillmentEvent(
      consumeDeps(refusing),
      coreEnvelope(eventId, "core.fulfillment.cancelled", payload),
    );
    expect(first.kind).not.toBe("applied");
    const second = await consumeCoreFulfillmentEvent(
      consumeDeps(refusing),
      coreEnvelope(eventId, "core.fulfillment.cancelled", payload),
    );
    // الرفضُ مسمًّى وقابلٌ للإعادةِ: لا applied ولا duplicate — الحدثُ حيٌّ.
    expect(second.kind).not.toBe("applied");
    expect(second.kind).not.toBe("duplicate");
    const row = await inbox.find(eventId);
    expect(row === null || !["applied", "observed", "poisoned"].includes(row.consumedStatus)).toBe(true);
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("cancelled");
    expect(still?.inventoryState).toBe("reserved");
  });

  it("استئنافُ التسويةِ (د): طلبٌ ملغًى reserved بلا حجوزاتٍ نشطةٍ — خطأٌ مسمًّى لا نجاحٌ صامتٌ (§4.29)", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    // الحالةُ الغريبةُ: دفترُ الحجوزاتِ فارغٌ والحالةُ reserved — لا يُفسَّرُ
    // التحريرُ صمتًا.
    await pool.query(`DELETE FROM delivery_inventory_reservations WHERE order_id = $1`, [order.orderId]);
    const eventId = crypto.randomUUID();
    const payload = {
      ...basePayload(order.publicId),
      reason: "customer_changed_mind",
      cancelled_at: "2026-10-22T10:20:00.000Z",
      settlement_state: "none",
      captured_minor: null,
      financial_decision_required: false,
    };
    const result = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.cancelled", payload),
    );
    expect(result.kind).not.toBe("applied");
    const row = await inbox.find(eventId);
    expect(row?.lastError ?? "").toContain("SETTLEMENT_INCONSISTENT");
  });

  it("إيصالٌ تاريخيٌّ بمعنى الرقعةِ القديمةِ: dispatched طُبِّق قديمًا إلى handed_to_courier — إعادةُ إرسالِهِ بعدَ الرقعةِ duplicate بلا تراجعٍ (§4.29)", async () => {
    // محاكاةُ عالمٍ ما قبلَ الرقعةِ: الانتقالُ وقعَ بالمعنىِ القديمِ (handed_to_courier)
    // وسُجِّلَ إيصالُهُ في الصندوقِ كما كانَ يسجّلُهُ المسارُ القديمُ (applied نهائيًّا).
    // بعدَ الرقعةِ، إعادةُ إرسالِ الحدثِ نفسِهِ لا تعيدُ تصنيفَ الطلبِ ولا تُتراجِعُ
    // ولا تعيدُ تطبيقَ الإسنادِ: الإيصالُ يُجيبُ duplicate — لا سجلَّ يُعادُ كتابتُهُ.
    const order = await walkToReadyForDelivery(await placedOrder());
    const legacy = await fulfillmentTransition(
      { readPort: store, writePort: store, ...ids() },
      order.publicId,
      "handed_to_courier",
      null,
      "old-world-correlation",
    );
    expect(legacy.kind).toBe("applied");
    const oldEventId = crypto.randomUUID();
    await inbox.recordTerminal({
      eventId: oldEventId,
      eventType: "core.fulfillment.dispatched",
      orderReference: order.publicId,
      consumedStatus: "applied",
      lastError: null,
    });
    // إعادةُ الإرسالِ بعدَ الرقعةِ: الإيصالُ التاريخيُّ حاسمٌ قبلَ أيِّ إسقاطٍ جديدٍ.
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(oldEventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-old-world",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(replay.kind).toBe("duplicate");
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("handed_to_courier");
  });

  it("المسارُ المحليُّ القديمُ لا يتغيّرُ: ready_for_delivery → handed_to_courier (COURIER_ACCEPTED) ما زالت حافّةً تعملُ، وdispatched عليها = out_of_order مسمّى", async () => {
    const order = await walkToReadyForDelivery(await placedOrder());
    // الحافّةُ المحليّةُ القديمةُ عبرَ مسارِ الانتقالِ الواحدِ (لا جسرًا للتكاملِ).
    const legacy = await fulfillmentTransition(
      { readPort: store, writePort: store, ...ids() },
      order.publicId,
      "handed_to_courier",
      null,
      "legacy-edge",
    );
    expect(legacy.kind).toBe("applied");
    expect(legacy.kind === "applied" && legacy.order.fulfillmentState).toBe("handed_to_courier");
    // وحدثُ الإسنادِ لا يُتراجِعُ بها ولا يُعيدُ تصنيفَها: مسمّىً لا صامتًا.
    const dispatched = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(crypto.randomUUID(), "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(dispatched).toMatchObject({ kind: "out_of_order", from: "handed_to_courier", to: "assigned" });
    const still = await store.getOrderByPublicId(order.publicId);
    expect(still?.fulfillmentState).toBe("handed_to_courier");
  });

  it("لا فقدَ: حدثٌ وصلَ قبلَ أوانِهِ يبقى حيًّا ثم ينطبقُ حينَ تبلغُ الحالةُ أوانَهُ", async () => {
    const order = await placedOrder(); // placed — لم يبلغِ الجاهزيّةَ بعدُ.
    const eventId = crypto.randomUUID();
    const early = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(early).toMatchObject({ kind: "out_of_order", from: "placed" });
    // الصفُّ حيٌّ (قابلٌ للإعادةِ) لا نهائيٌّ — الحدثُ لم يُفقدْ.
    const live = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM core_fulfillment_inbox WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(live.rows[0]["consumed_status"]).toBe("error");
    // ثمّ تبلغُ الحالةُ أوانَها — وإعادةُ الإرسالِ تُطبِّقُ الحدثَ نفسَهُ.
    await walkToReadyForDelivery(order);
    const replay = await consumeCoreFulfillmentEvent(
      consumeDeps(),
      coreEnvelope(eventId, "core.fulfillment.dispatched", {
        ...basePayload(order.publicId),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T10:10:00.000Z",
      }),
    );
    expect(replay.kind).toBe("applied");
    const settled = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM core_fulfillment_inbox WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(settled.rows[0]).toMatchObject({ consumed_status: "applied" });
  });
});
