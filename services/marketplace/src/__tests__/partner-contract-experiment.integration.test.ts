/**
 * `partner-contract-experiment.integration.test.ts` — **تجربةُ العقدِ الحاسمةِ لشريحةِ ب.2**
 * (مذكرةُ التصميمِ: docs/11-partners/B2_PARTNER_MINI_APP_SLICE.md §4) — جانبُ السوقِ.
 *
 * **ما تُثبتهُ هذهِ التجربةُ:** إنفاذُ العضويةِ عندَ حدِّ الخدمةِ لمسارِ قراءةِ الطاقمِ
 * (`GET /stores/:storeSlug/staff` — `tenantScoped(staffRead)` = فئة N) بنداءٍ حقيقيٍّ
 * موقَّعٍ يحملُ `obo` (المعرّفَ العامَّ للشخصِ) — لا معرّفًا يرسلُهُ المتصفحُ:
 *
 * - المالكُ (obo = ownerPublicId) يقرأُ طاقمَ متجرِهِ — 200.
 * - العضوُ النشطُ يقرأُ — 200 (قراءةُ الطاقمِ بلا فحصِ رتبةٍ: الرتبةُ للتعديلِ).
 * - العضويةُ المختومةُ (المُزالة) — `STORE_NOT_FOUND` (404 لا تسريبَ وجودٍ).
 * - غيرُ العضوِ — `STORE_NOT_FOUND`.
 * - بلا `obo` — الرفضُ (المُنتَفِعُ المطلوبُ غائبٌ).
 *
 * **حدٌّ تعاقديٌّ مسجَّلٌ (M1-05):** نجاحُ هذهِ التجربةِ بدورِ `e2e-harness` (المُعلَنِ
 * في الاختبارِ) ليسَ دليلًا على صلاحياتِ `customer-bot` الإنتاجيةِ على `marketplace` —
 * تلكَ منحةُ إنتاجٍ تُتَّخذُ بقرارٍ تقنيٍّ عبرَ مسارِ الحوكمةِ (المذكرةُ §3.2).
 *
 * **والرابطُ معَ جانبِ الهويةِ** (اختبارُ `app-edge-e2e`): المعرّفُ العامُّ نفسُهُ —
 * منَ الجلسةِ (`wasla_public_id`) إلى `obo` النداءِ إلى عضويةِ المتجرِ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

import { draftStore } from "../domain/catalog.js";
import type { Clock } from "../domain/time.js";
import { MarketplaceCatalogService } from "../app/catalog.js";
import { MarketplaceProductService } from "../app/products.js";
import { MarketplaceStoreService } from "../app/stores.js";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import { MARKETPLACE_SCOPES } from "../http/service-identity.js";
import {
  MEMBER,
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  T1,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";
import { buildSignedMarketplaceApp, signFor } from "./service-identity-support.js";

/** ساعةُ الخدمةِ: لحظةٌ ثابتةٌ يقرؤها كلُّ ختمٍ في هذا الملفِّ. */
const fixedClock: Clock = { now: () => T1 };

const CATEGORY = { slug: "electronics-phones", depth: 2, isActive: true } as const;
const SLUG = "medina-dates";
/** شخصٌ لا صلةَ لهُ بالمتجرِ — لإثباتِ رفضِ غيرِ العضوِ. */
const OUTSIDER = "WS-1000000009";

describe.skipIf(!PG_ENABLED)("تجربةُ العقدِ — ب.2: قراءةُ الطاقمِ بإنفاذِ العضويةِ عندَ الحدِّ", () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let keys: ReturnType<typeof buildSignedMarketplaceApp>["keys"];
  let storeId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    const categoryId = await seedLeafCategory(pg.stores, CATEGORY.slug);
    const store = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: OWNER,
        slug: SLUG,
        titleAr: "متجرُ تمورِ المدينة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    storeId = store.storeId;
    // المالكُ — عضويةُ الملكيةِ.
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: OWNER,
      role: "owner",
      addedByPublicId: OWNER,
      addedAt: T0,
    });
    // عضوٌ نشطٌ — قراءةُ الطاقمِ لهُ.
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T0,
    });
    // عضوٌ أُزيلَ (ختمٌ لا حذف) — عضويتُهُ غيرُ نشطةٍ فقراءةُ المتجرِ تُرفضُ.
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MODERATOR,
      role: "manager",
      addedByPublicId: OWNER,
      addedAt: T0,
    });
    const sealed = await pg.stores.staff.sealRemoval({
      storeId,
      memberPublicId: MODERATOR,
      removedAt: T1,
      removedByPublicId: OWNER,
    });
    expect(sealed).toBeDefined();

    const uow = new MarketplaceUnitOfWork(pg.db);
    const deps = { uow, clock: fixedClock };
    const harness = buildSignedMarketplaceApp({
      mode: "postgres",
      services: {
        stores: new MarketplaceStoreService(deps),
        products: new MarketplaceProductService(deps),
        catalog: new MarketplaceCatalogService(deps),
      },
    });
    app = harness.app;
    keys = harness.keys;
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    await pg?.close();
  });

  /** نداءُ قراءةِ الطاقمِ بـ`obo` الشخصِ — الدورُ الاختباريُّ المُعلَنُ (`e2e-harness`). */
  async function readStaffAs(onBehalfOfPublicId?: string): Promise<LightMyRequestResponse> {
    return await app.inject({
      method: "GET",
      url: `/stores/${SLUG}/staff`,
      headers: {
        ...signFor("GET", `/stores/${SLUG}/staff`, {
          keys,
          serviceName: "e2e-harness",
          scopes: [MARKETPLACE_SCOPES.staffRead],
          ...(onBehalfOfPublicId === undefined ? {} : { onBehalfOfPublicId }),
        }),
      },
    });
  }

  it("المالكُ (obo = ownerPublicId) يقرأُ طاقمَ متجرِهِ — 200 وقائمةُ الطاقمِ كاملةً", async () => {
    const response = await readStaffAs(OWNER);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { staff?: Array<{ member_public_id?: string }> };
    expect(body.staff).toHaveLength(3); // المالكُ + النشطُ + المختومُ — الطاقمُ كلُّهُ.
  });

  it("العضوُ النشطُ يقرأُ — 200 (قراءةُ الطاقمِ بلا فحصِ رتبةٍ: الرتبةُ للتعديلِ)", async () => {
    const response = await readStaffAs(MEMBER);
    expect(response.statusCode).toBe(200);
  });

  it("العضويةُ المختومةُ (المُزالة) — `STORE_NOT_FOUND` (404 لا تسريبَ وجودٍ)", async () => {
    const response = await readStaffAs(MODERATOR);
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("STORE_NOT_FOUND");
  });

  it("غيرُ العضوِ — `STORE_NOT_FOUND` (404)", async () => {
    const response = await readStaffAs(OUTSIDER);
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("STORE_NOT_FOUND");
  });

  it("بلا `obo` — الرفضُ (المُنتَفِعُ المطلوبُ غائبٌ، لا قراءةَ بلا مُنتَفِعٍ)", async () => {
    const response = await readStaffAs(undefined);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});
