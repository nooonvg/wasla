import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute, TEST_CUSTOMER_ID } from "./helpers";

/**
 * البندُ 1.3 (خطةُ المراجعةِ الشاملةِ 2026-10-23): رحلةُ زبونٍ كاملةٍ على الويب —
 * تصفّح → بحث → منتج → طلب → طلباتي.
 *
 * الرحلةُ تمشي الشاشاتِ الحقيقيّةَ في تدفّقٍ واحدٍ (لا اختباراتَ منفصلةً لكلِّ
 * شاشةٍ — تلكَ موجودةٌ في navigation/order-flow/places-flow) وتُحاكي الخدماتِ
 * في طبقةِ المسارِ (كما في order-flow.spec.ts — لا خلفيّةَ حقيقيّةً مطلوبةً).
 * الجلسةُ مُلقّاةٌ عبرَ hook الاختبارِ المُصرَّفِ زمنيًّا (window.__waslaE2E).
 */

interface MockStore {
  store_id: string;
  slug: string;
  display_name: string;
  description?: string;
}

interface MockProduct {
  product_id: string;
  store_slug: string;
  name: string;
  price: number;
  currency: string;
  status: string;
}

const MOCK_STORES: MockStore[] = [
  {
    store_id: "store-1",
    slug: "al-baik",
    display_name: "مطعم البيك",
    description: "وجبات سريعة",
  },
  {
    store_id: "store-2",
    slug: "tamimi",
    display_name: "متجر التميمي",
    description: "بقالة",
  },
];

const MOCK_PRODUCTS: MockProduct[] = [
  {
    product_id: "prod-1",
    store_slug: "al-baik",
    name: "وجبة البروست",
    price: 25,
    currency: "SAR",
    status: "active",
  },
  {
    product_id: "prod-2",
    store_slug: "al-baik",
    name: "وجبة الشاورما",
    price: 20,
    currency: "SAR",
    status: "active",
  },
];

const MOCK_SEARCH_RESULTS = {
  items: [
    {
      product_id: "prod-1",
      name: "وجبة البروست",
      store_slug: "al-baik",
      price: 25,
      currency: "SAR",
    },
  ],
  total: 1,
};

const MOCK_DELIVERY_PREVIEW = {
  order_type: "delivery",
  vehicle_class: "sedan",
  stops: [
    { kind: "pickup", zone_id: "zone-1", label: "من البيت" },
    { kind: "dropoff", zone_id: "zone-2", label: "إلى المتجر" },
  ],
};

const MOCK_DELIVERY_ORDER_RESULT = {
  order_request_id: "ord-journey-1",
  order_public_id: "ORD-JRNY1",
  status: "submitted",
};

const MOCK_MY_ORDERS = {
  items: [
    {
      id: "ord-journey-1",
      order_type: "delivery",
      status: "submitted",
      vehicle_class: "sedan",
      price_mode: "negotiable",
      created_at: "2026-10-23T09:00:00Z",
    },
  ],
};

/** محاكاةُ كلِّ الخدماتِ التي تمسُّها الرحلةُ — معَ رفضِ أيِّ نداءٍ غيرِ مُحاكىً. */
async function stubJourneyApis(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/stores", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: MOCK_STORES, limit: 20 }),
    }),
  );
  await page.route("**/stores/*/products", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: MOCK_PRODUCTS, limit: 20 }),
    }),
  );
  await page.route("**/search/products*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SEARCH_RESULTS),
    }),
  );
  await page.route("**/search/stores*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: MOCK_STORES.map((s) => ({ store_id: s.store_id, store_slug: s.slug, title: s.display_name })), total: MOCK_STORES.length }),
    }),
  );
  // الأماكنُ المحفوظةُ (منتقي الأماكنِ في شاشةِ الطلبِ) — فارغةٌ: الرحلةُ تكتبُ المناطقَ يدويًّا.
  await page.route("**/customers/*/places", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], limit: 20 }),
    }),
  );
  // نُسجّلُ مسارَ الطلباتِ أولًا ثمّ مسارَ المعاينةِ آخرًا: مساراتُ Playwright
  // تُطابَقُ بترتيبٍ عكسيٍّ (الأخيرُ المسجَّلُ أسبقُ) — فمسارُ المعاينةِ الدقيقُ
  // (`order-requests/preview`) يسبقُ مسارَ الطلباتِ الأوسعَ (`order-requests*`).
  await page.route("**/customers/*/order-requests*", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_MY_ORDERS),
      });
    }
    const idempotencyKey = route.request().headers()["idempotency-key"];
    if (!idempotencyKey) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Missing Idempotency-Key" }),
      });
    }
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(MOCK_DELIVERY_ORDER_RESULT),
    });
  });
  await page.route("**/customers/*/order-requests/preview", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 405, body: "Method Not Allowed" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_DELIVERY_PREVIEW),
    });
  });
}

test.describe("رحلة الزبون الكاملة على الويب (البند 1.3)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await stubJourneyApis(page);
  });

  test("تصفّح → بحث → منتج → طلب → طلباتي", async ({ page }) => {
    // ── 1) تصفّح: الرئيسيةُ تُظهرُ مسارَ الرحلةِ كلَّهُ ──
    await gotoRoute(page, "home");
    await expect(page.getByText("تصفح المتاجر")).toBeVisible();
    await expect(page.getByText("ابحث")).toBeVisible();
    await expect(page.getByText("اطلب توصيل")).toBeVisible();
    await expect(page.getByText("طلباتي")).toBeVisible();

    // ── 2) تصفّح المتاجر: المتجرُ ثمّ منتجاتُهُ ──
    await gotoRoute(page, "marketplace");
    await expect(page.locator(".marketplace-screen")).toBeVisible();
    await expect(page.locator("[data-testid='store-al-baik']")).toBeVisible();
    await page.click("[data-testid='store-al-baik']");
    // المنتجاتُ (منتج): ظهرت منتجاتُ المتجرِ المُختارِ
    await expect(page.locator("[data-testid='products-list']")).toBeVisible();
    await expect(page.getByText("وجبة البروست")).toBeVisible();
    await expect(page.getByText("وجبة الشاورما")).toBeVisible();
    await expect(page.getByText("25 SAR")).toBeVisible();

    // ── 3) بحث: ابحثْ عن منتجٍ فظهرت نتيجتُهُ ──
    await gotoRoute(page, "search");
    await expect(page.locator(".search-screen")).toBeVisible();
    await page.fill(".search-bar input", "بروست");
    await page.keyboard.press("Enter");
    await expect(page.getByText("وجبة البروست")).toBeVisible();

    // ── 4) طلب: اطلبْ توصيلًا (مناطقُ مختلفةٌ) فظهرت المعاينةُ ثمّ الإرسالُ ──
    await gotoRoute(page, "delivery");
    await expect(page.locator(".delivery-order-screen")).toBeVisible();
    await page.fill("[data-testid='d-pickup-zone-input']", "zone-1");
    await page.fill("[data-testid='d-pickup-label-input']", "من البيت");
    await page.fill("[data-testid='d-dropoff-zone-input']", "zone-2");
    await page.fill("[data-testid='d-dropoff-label-input']", "إلى المتجر");
    // المعاينةُ
    await page.click("[data-testid='d-preview-button']");
    await expect(page.locator("[data-testid='d-preview-result']")).toBeVisible();
    // الإرسالُ
    await page.click("[data-testid='d-submit-button']");
    await expect(page.locator("[data-testid='d-submit-success']")).toBeVisible();

    // ── 5) طلباتي: الطلبُ المُرسَلُ ظاهرٌ في القائمةِ ──
    await gotoRoute(page, "orders");
    await expect(page.locator(".my-orders-screen")).toBeVisible();
    await expect(page.locator("[data-testid='order-ord-journey-1']")).toBeVisible();
    await expect(page.getByText("ord-journey-1")).toBeVisible();
  });
});
