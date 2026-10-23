import { test, expect } from "@playwright/test";
import { seedSession, gotoRoute } from "./helpers";

/**
 * البندُ 1.5 (خطةُ المراجعةِ الشاملةِ 2026-10-23): PWA مكتملة — التحققُ
 * البرمجيُّ من القابليةِ للتثبيتِ (معيارُ القبولِ: تثبيتٌ على iOS وAndroid +
 * عملٌ دون اتصالٍ للشاشاتِ الأساسيّةِ).
 *
 * ما يُقاسُ هنا قابليةُ التثبيتِ الموضوعيّةُ (الأصولُ التي يشترطُها المتصفحُ
 * للتثبيتِ) ومرونةُ عدمِ الاتصالِ (التطبيقُ لا ينهارُ بل يُعلِمُ ويُظهرُ حالةً).
 * **الحدُّ المُعلَن:** التثبيتُ الحقيقيُّ على جهازٍ (iOS · Android) والعملُ
 * دون اتصالٍ عبرَ عاملِ الخدمةِ **غيرُ مُقاسَينَ هنا** — عاملُ الخدمةِ
 * مستثنى صراحةً من بيئةِ الاختبارِ (`VITE_E2E` · pwa/register-service-worker.ts)
 * فلا يمكنَ قياسُ ذاكرةِ العملِ منَ المتصفحِ في الاختبارِ؛ ذاكَ فحصُ جهازٍ
 * حقيقيٍّ يحتاجُ نشرًا (انظرِ الدليلَ).
 */

test.describe("PWA — القابلية للتثبيت (البند 1.5)", () => {
  test("بيانُ التطبيقِ (manifest) مُقدَّمٌ وبحقولِ التثبيتِ المطلوبةِ", async ({ request }) => {
    const response = await request.get("http://localhost:4173/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");

    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      dir: string;
      lang: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    // متطلباتُ التثبيتِ التي يشترطُها المتصفحُ (Chrome · Safari)
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
    // التطبيقُ عربيٌّ RTL — الاتجاهُ جزءٌ من العقدِ
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");

    // أيقوناتُ التثبيتِ: 192 (Android) و512 (أندرويد/سطحَ المكتبِ)
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src).toMatch(/^icons\//);
    }
  });

  test("عاملُ الخدمةِ (sw.js) مُقدَّمٌ كجافاسكربت", async ({ request }) => {
    const response = await request.get("http://localhost:4173/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    // جوهرُ العاملِ: معالجُ الجلبِ (fetch) — شرطُ PWA
    const body = await response.text();
    expect(body).toContain("addEventListener(\"fetch\"");
  });

  test("أيقوناتُ التثبيتِ مُقدَّمةٌ كصور", async ({ request }) => {
    for (const icon of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"]) {
      const response = await request.get(`http://localhost:4173/${icon}`);
      expect(response.status(), icon).toBe(200);
      expect(response.headers()["content-type"], icon).toContain("image/png");
    }
  });

  test("صفحةُ التطبيقِ تحملُ بيانَ التثبيتِ ووسومَ iOS", async ({ page }) => {
    await page.goto("http://localhost:4173/");

    // بيانُ التثبيتِ مربوطٌ بالصفحةِ
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(manifestHref).toContain("manifest");

    // iOS: أيقونةُ الشاشةِ الرئيسيةِ (شرطُ «إضافةٌ إلى الشاشةِ الرئيسيةِ»)
    const appleIcon = await page
      .locator('link[rel="apple-touch-icon"]')
      .getAttribute("href");
    expect(appleIcon).toBeTruthy();

    // لونُ الواجهةِ (شريطُ العنوانِ على الجوالِ)
    const themeColor = await page
      .locator('meta[name="theme-color"]')
      .getAttribute("content");
    expect(themeColor).toBeTruthy();

    // الاتجاهُ واللغةُ — عربيٌّ RTL
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });
});

test.describe("PWA — مرونةُ عدمِ الاتصالِ (البند 1.5)", () => {
  test("دونَ اتصالٍ: التطبيقُ لا ينهارُ — الشاشةُ تعملُ والشريطُ يُعلِمُ", async ({ page }) => {
    // **الحدُّ المُعلَنُ أولًا:** عداءُ الاختبارِ لا يستطيعُ تحميلَ الصفحةِ
    // بلا شبكةٍ منَ البدايةِ (لا يوجدَ عاملُ خدمةٍ في الاختبارِ — مستثنىً
    // صراحةً) فلا «إقلاعٌ دونَ اتصالٍ» هنا. ما يُقاسُ هوَ **المرونةُ**:
    // التطبيقُ محمَّلٌ (بجلسةٍ) ثمّ تنقطعُ الشبكةُ — فلا ينهارُ بل تبقى
    // الشاشةُ الأساسيّةُ تعملُ ويُعلِمُ الشريطُ.
    await seedSession(page);
    await gotoRoute(page, "home");

    // الشاشةُ تعملُ (الرئيسيةُ ظاهرةٌ) قبلَ الانقطاعِ
    await expect(page.getByText("تصفح المتاجر")).toBeVisible();

    // انقطاعُ الشبكةِ: الشريطُ يظهرُ والتطبيقُ لا ينهارُ (الشاشةُ باقيةٌ)
    await page.context().setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByText("تصفح المتاجر")).toBeVisible();

    // عودةُ الشبكةِ: الشريطُ يختفي (التطبيقُ يستجيبُ للتغيّرِ)
    await page.context().setOffline(false);
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });
});
