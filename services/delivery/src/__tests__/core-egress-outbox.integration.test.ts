/**
 * تكاملُ صادرِ CORE على PostgreSQL حقيقيةٍ (XR-3.4 · F-38 · المراجعةُ 8).
 *
 * هذا هوَ امتحانُ «الأنبوبِ» الذي تفتحُهُ الحقيقةُ F-38: طلبُ متجرٍ يوضعُ،
 * فإمّا أن يخرجَ `market.order.created` **كاملًا** بمغلّفِ CORE في
 * `core_egress_outbox` (في معاملةِ الوضعِ نفسِها)، أو أن يُسجَّلَ القرارُ
 * المحجوزُ المتينُ في `core_egress_blocked`. لا ثالثَ — لا فقدَ صامتًا ولا
 * حدثًا مُختلَقًا.
 *
 * **العقدُ هو المرجعُ:** الصفُّ يُطابَقُ معَ المخططاتِ المنقولةِ في
 * `docs/contracts/core/` نفسِها (المغلّفُ و`market.order.created.v1`) — فالصفُّ
 * الذي لا يشبعُ العقدَ لا يُنشَرُ ولو كُتبَ في الجدولِ.
 *
 * ## جدولٌ مستقلٌّ عمدًا — والامتحانُ يحرسُ السببَ
 *
 * المُحوِّلُ يعيدُ استخدامَ `event_id` المحليِّ (حدثٌ واحدٌ لا حدثانِ)، و
 * `delivery_outbox` يرفضُ التكرارَ **بصمتٍ** (UNIQUE + ON CONFLICT DO
 * NOTHING) — صفُّ CORE هناكَ كانَ سيختفي لا أن يُنشَر. الامتحانُ الأخيرُ
 * يُثبتُ التعايشَ: الحدثُ المحليُّ وصفُّ CORE معًا، مرةً واحدةً كلٌّ، حتى
 * بعدَ إعادةِ اللعبِ بمفتاحِ التماثُلِ.
 *
 * يتخطّى بلا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import {
  FakeCatalog,
  FakeReservationPort,
  FakeReservationStore,
  CUSTOMER_REF,
  PRODUCT_A,
  PRODUCT_B,
  STORE_SLUG,
  STORE_ID,
  uuidSequence,
} from "./store-order-fakes.js";
import type { IdempotencyIntent } from "../ports.js";
import type { StoreOrder } from "../domain/model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, "../../../..", "docs", "contracts", "core");

const NOW = "2026-10-22T12:00:00.000Z";
const ORGANIZATION = "e83f50cc-5808-4873-b58a-722cc3f58070";

const envelopeSchema = JSON.parse(
  readFileSync(resolve(contractsDir, "envelope.schema.json"), "utf8"),
) as { required: string[]; properties: Record<string, Record<string, unknown>> };
const orderCreatedSchema = JSON.parse(
  readFileSync(resolve(contractsDir, "market.order.created.v1.schema.json"), "utf8"),
) as {
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, Record<string, unknown>>;
};

interface EgressRow {
  event_id: string;
  event_type: string;
  version: number;
  producer: string;
  occurred_at: Date;
  correlation_id: string;
  causation_id: string | null;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  published_at: Date | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe.skipIf(!PG_ENABLED)("core egress outbox — PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
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

  async function place(
    organizationId: string | null,
    idempotency?: IdempotencyIntent,
  ): Promise<StoreOrder> {
    const deps = {
      catalogPort: new FakeCatalog({ storeId: STORE_ID, orderable: true, organizationId }),
      writePort: store,
      readPort: store,
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      ...ids(),
    };
    const result = await placeStoreOrder(deps, placement, "egress-trace", idempotency);
    if (result.kind !== "applied") throw new Error("placement failed");
    return result.order;
  }

  async function egressRows(): Promise<EgressRow[]> {
    const rows = await pool.query(
      `SELECT event_id, event_type, version, producer, occurred_at, correlation_id,
              causation_id, entity_type, entity_id, payload, published_at
         FROM core_egress_outbox`,
    );
    return rows.rows as unknown as EgressRow[];
  }

  /** يُثبتُ أنَّ الصفَّ يشبعُ المخططينِ المنقولينِ حرفًا — العقدُ يقودُ. */
  function expectRowToSatisfyContracts(row: EgressRow): void {
    // المغلّفُ: كلُّ حقلٍ مطلوبٍ حاضرٌ وبنوعِهِ.
    for (const field of envelopeSchema.required) {
      const value = (row as unknown as Record<string, unknown>)[field];
      expect(value, `envelope field ${field}`).toBeDefined();
    }
    expect(UUID_RE.test(row.event_id)).toBe(true);
    expect(row.event_type).toBe("market.order.created");
    expect(row.version).toBe(1);
    expect(row.producer).toBe("wasla-market");
    expect(row.correlation_id.length).toBeGreaterThan(0);
    expect(row.entity_type).toBe("store_order");
    expect(UUID_RE.test(row.entity_id)).toBe(true);

    // الحمولةُ: كلُّ required حاضرٌ، وكلُّ حقلٍ موجودٍ معلَنٌ في المخططِ
    // (additionalProperties: false — حقلًا زائدًا يعني انحرافًا عنِ العقدِ).
    for (const field of orderCreatedSchema.required) {
      expect(row.payload[field], `payload field ${field}`).toBeDefined();
    }
    for (const key of Object.keys(row.payload)) {
      expect(orderCreatedSchema.properties[key], `payload key ${key} declared`).toBeDefined();
    }
    expect(UUID_RE.test(String(row.payload["organization_id"]))).toBe(true);
    expect(row.payload["order_id"]).toMatch(/^WS-[0-9]{10}$/);
    expect(row.payload["requested_service"]).toBe("delivery");
  }

  it("متجرٌ مربوطٌ بمنظمةٍ: الحدثُ يخرجُ كاملًا بمغلّفِ CORE في معاملةِ الوضعِ — ويشبعُ العقدَ المنقولَ حرفًا", async () => {
    const order = await place(ORGANIZATION);

    const rows = await egressRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expectRowToSatisfyContracts(row);
    expect(row.payload["order_id"]).toBe(order.publicId);
    // لم يُنشَرْ بعدُ — النقلُ (XR-4.3) مرحلةٌ لاحقةٌ، والصفُّ شاهدٌ عليها.
    expect(row.published_at).toBeNull();
  });

  it("متجرٌ بلا منظمةٍ: قرارٌ محجوزٌ متينٌ لا فقدًا صامتًا ولا حدثًا مُختلَقًا", async () => {
    const order = await place(null);

    const rows = await egressRows();
    expect(rows).toHaveLength(0);

    const blocked = await pool.query(
      `SELECT order_id, order_public_id, reason FROM core_egress_blocked WHERE order_id = $1`,
      [order.orderId],
    );
    expect(blocked.rows[0]).toMatchObject({
      order_public_id: order.publicId,
      reason: "organization_not_linked",
    });
  });

  it("الحدثُ المحليُّ وصادرُ CORE يتعايشانِ: مرةً واحدةً كلٌّ حتى بعدَ إعادةِ اللعبِ بمفتاحِ التماثُلِ", async () => {
    // المفتاحُ نفسُهُ: إعادةُ اللعبِ تُعيدُ الجوابَ المخزَّنَ لا أن تُعيدَ الوضعَ.
    const intent: IdempotencyIntent = {
      key: "egress-coexist-1",
      route: "POST /store-orders",
      fingerprint: "a".repeat(64),
      responseStatus: 201,
      buildResponseBody: (order) => ({ public_id: order.publicId }),
    };
    const order = await place(ORGANIZATION, intent);
    const replayDeps = {
      catalogPort: new FakeCatalog({ storeId: STORE_ID, orderable: true, organizationId: ORGANIZATION }),
      writePort: store,
      readPort: store,
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      ...ids(),
    };
    const replay = await placeStoreOrder(replayDeps, placement, "egress-trace", intent);
    expect(replay.kind).toBe("replayed");

    // صفُّ واحدٌ في كلِّ جدولٍ — والحدثُ المحليُّ لم يتضاعفْ ولم يُبتلَعْ.
    const local = await pool.query(
      `SELECT count(*)::int AS n FROM delivery_outbox WHERE aggregate_id = $1`,
      [order.orderId],
    );
    expect(local.rows[0]["n"]).toBe(2); // store_order.created + delivery_task.created
    const rows = await egressRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload["order_id"]).toBe(order.publicId);
    const blocked = await pool.query(`SELECT count(*)::int AS n FROM core_egress_blocked`);
    expect(blocked.rows[0]["n"]).toBe(0);
  });

  it("فشلُ كتابةِ الصادرِ يُرجعُ الوضعَ كلَّهُ: لا طلبَ بلا حدثٍ ولا حدثَ بلا طلبٍ", async () => {
    // نُفجّرُ جدولَ الصادرِ مؤقتًا (إسقاطُهُ) فيُفشلُ الوضعُ كلُّهُ — الطلبُ
    // نفسُهُ لا يلتزمُ بلا صادرِهِ.
    await pool.query(`DROP TABLE core_egress_outbox`);
    await expect(place(ORGANIZATION)).rejects.toThrow();
    // ولا أثرَ للطلبِ: لا صفَّ طلبٍ ولا صفًّا محجوزًا — كلُّهُ أو لا شيءَ.
    const orders = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(orders.rows[0]["n"]).toBe(0);
    const blocked = await pool.query(`SELECT count(*)::int AS n FROM core_egress_blocked`);
    expect(blocked.rows[0]["n"]).toBe(0);
    // والجدولُ يعودُ (الترحيلاتُ في beforeAll لأغراضِ هذا الاختبارِ وحدهُ).
    await pool.query(
      `CREATE TABLE IF NOT EXISTS core_egress_outbox (
         event_id UUID PRIMARY KEY,
         event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 96),
         version INTEGER NOT NULL CHECK (version >= 1),
         producer TEXT NOT NULL,
         occurred_at TIMESTAMPTZ NOT NULL,
         correlation_id TEXT NOT NULL,
         causation_id TEXT,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         payload JSONB NOT NULL,
         published_at TIMESTAMPTZ,
         attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
         last_error TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  });
});
