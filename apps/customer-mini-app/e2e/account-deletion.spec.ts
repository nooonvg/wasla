import { test, expect } from "@playwright/test";
import { seedSession, stubTelegramSdk } from "./helpers";

/**
 * رحلةُ حذفِ الحسابِ على الويبِ (D-XR-13 · CLM-0699) — خاتمةُ رحلةِ الزبونِ
 * التي يقيسُها XR-8.3: دخولٌ ← تصفّحٌ وطلبٌ (يقيسُها `customer-journey.spec.ts`)
 * ← خروجٌ وحذفٌ. الحذفُ نداءٌ مباشرٌ إلى النواةِ بجلسةِ الشخصِ (`/v1/me/deletion`)
 * يُحاكى هنا على مسارِهِ الحقيقيِّ نفسِهِ (`VITE_CORE_URL` بذاتِ الأصلِ في
 * `playwright.config.ts`)، ودخولُ الويبِ يُبذَرُ كما تُبذَرُ الجلسةُ — بلا بابٍ
 * خلفيٍّ في الإنتاجِ (الكتلةُ المجمّعةُ شرطيًّا في `main.tsx`).
 */

test.describe("Account deletion — the web journey's end (XR-8.3 · D-XR-13)", () => {
  test("الرحلةُ تنتهي بالحذفِ: وداعٌ، وجلسةُ السوقِ انتهت، ولا أثرَ في أيِّ تخزينٍ", async ({ page }) => {
    await seedSession(page);
    // دخولُ الويبِ مُكمَّلٌ (إثباتُ النواةِ) — كما يفعلهُ الشخصُ عبرَ تيليجرامَ OIDC.
    await page.addInitScript(() => {
      (window as unknown as { __waslaE2EWebCredential?: string }).__waslaE2EWebCredential =
        "e2e-core-token";
    });

    let deletionCalls = 0;
    let logoutCalls = 0;
    let deletionAuthorization: string | undefined;
    await page.route("**/v1/me/deletion", (route) => {
      deletionCalls += 1;
      deletionAuthorization = route.request().headers()["authorization"];
      route.fulfill({ status: 204 });
    });
    await page.route("**/edge/session/logout", (route) => {
      logoutCalls += 1;
      route.fulfill({ status: 204 });
    });
    await page.route("**/customers/WS-1234567890/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ display_name: "E2E", phone_number: null, email: null, preferred_language: "ar" }),
      }),
    );

    await page.goto("http://localhost:4173/#/profile");
    await expect(page.getByTestId("delete-account-button")).toBeVisible();

    // تأكيدٌ صريحٌ: الزرُّ الأولُ لا يحذفُ شيئًا.
    await page.getByTestId("delete-account-button").click();
    await expect(page.getByTestId("deletion-confirm-text")).toBeVisible();
    await page.getByTestId("delete-account-confirm").click();

    // الوداعُ — لا وميضَ شاشةِ دخولٍ ولا عودةً للملفِ.
    await expect(page.getByTestId("account-deleted-screen")).toBeVisible();
    expect(deletionCalls).toBe(1);
    expect(deletionAuthorization).toBe("Bearer e2e-core-token");
    // الخروجُ من جلسةِ السوقِ أيضًا — الحذفُ ينهي الوجودَ كلَّهُ لا النواةَ وحدَها.
    expect(logoutCalls).toBe(1);

    // لا رمزَ في أيِّ تخزينٍ محليٍّ (ADR-044 §4) — الحذفُ لا يخلّ بذلك بل يؤكّدُه.
    const localStorageContent = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(localStorageContent).not.toContain("e2e-test-token");
    expect(localStorageContent).not.toContain("e2e-core-token");
  });

  test("المديرُ يُرفَضُ بالاسمِ: المنظماتُ التي يديرُها تُعرَضُ والحذفُ لا يقعُ", async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
      (window as unknown as { __waslaE2EWebCredential?: string }).__waslaE2EWebCredential =
        "e2e-core-token";
    });

    let deletionCalls = 0;
    await page.route("**/v1/me/deletion", (route) => {
      deletionCalls += 1;
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "conflict",
          message: "transfer or close the organizations you administer first",
          retryable: false,
          correlation_id: "e2e",
          details: { organization_ids: ["11111111-1111-4111-8111-111111111111"] },
        }),
      });
    });
    await page.route("**/customers/WS-1234567890/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ display_name: "E2E" }),
      }),
    );

    await page.goto("http://localhost:4173/#/profile");
    await page.getByTestId("delete-account-button").click();
    await page.getByTestId("delete-account-confirm").click();

    // الرفضُ المسمّى: المنظماتُ في الرسالةِ، والشاشةُ باقيةٌ، والوداعُ لم يبدأ.
    await expect(page.getByTestId("deletion-error")).toContainText(
      "11111111-1111-4111-8111-111111111111",
    );
    await expect(page.getByTestId("account-deleted-screen")).toHaveCount(0);
    expect(deletionCalls).toBe(1);
  });

  test("مستعملُ المصغّرِ بلا إثباتِ ويبٍ: إرشادٌ لا زرٌّ ميتٌ (الحدُّ المعلَنُ)", async ({ page }) => {
    await seedSession(page);
    await page.route("**/customers/WS-1234567890/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ display_name: "E2E" }),
      }),
    );

    await page.goto("http://localhost:4173/#/profile");
    await expect(page.getByTestId("deletion-web-only")).toBeVisible();
    await expect(page.getByTestId("delete-account-button")).toHaveCount(0);
  });
});

test.describe("Account deletion — the mini-app bridge (CLM-0703 · D-XR-13)", () => {
  test("رحلةُ المصغّرِ عبرَ الجسرِ: تبادلُ الدليلِ عندَ النواةِ ثمّ الحذفُ بجلسةِ الشخصِ", async ({ page }) => {
    // داخلَ تيليجرامَ: السكربتُ الرسميُّ مُخدَّمٌ بدليلٍ موقَّعٍ — التطبيقُ
    // يكتشفُ مضيفَ تيليجرامَ منَ initData لا منْ بذرِ جلسةٍ.
    await stubTelegramSdk(page, "query_id=e2e&user=%7B%22id%22:445566778%7D&signature=e2e");

    // النواةُ (بذاتِ الأصلِ — VITE_CORE_URL في playwright.config): تبادلُ
    // الدليلِ يُصدِرُ جلسةَ شخصٍ على قناةِ تيليجرامَ.
    let exchangeCalls = 0;
    await page.route("**/v1/web-session/telegram/init-data", (route) => {
      exchangeCalls += 1;
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "core-e2e-1",
          access_token: "e2e-core-token",
          token_type: "Bearer",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          identity_id: "i-e2e",
          identity_created: true,
        }),
      });
    });
    // ثمّ جسرُ الحدِّ: جلسةُ النواةِ تُستبدَلُ بجلسةِ السوقِ كما في الويبِ.
    await page.route("**/edge/session/web", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "e2e-test-token",
          wasla_public_id: "WS-1234567890",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          session_id: "market-e2e-1",
        }),
      }),
    );
    await page.route("**/customers/WS-1234567890/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ display_name: "E2E", phone_number: null, email: null, preferred_language: "ar" }),
      }),
    );
    let deletionCalls = 0;
    let deletionAuthorization: string | undefined;
    await page.route("**/v1/me/deletion", (route) => {
      deletionCalls += 1;
      deletionAuthorization = route.request().headers()["authorization"];
      route.fulfill({ status: 204 });
    });

    await page.goto("http://localhost:4173/#/profile");
    // الجلسةُ قامتْ عبرَ الجسرِ الحقيقيِّ: تبادلٌ واحدٌ عندَ النواةِ ثمّ
    // استبدالٌ واحدٌ عندَ الحدّ.
    await expect(page.getByTestId("delete-account-button")).toBeVisible();
    await expect(page.getByTestId("deletion-web-only")).toHaveCount(0);
    expect(exchangeCalls).toBe(1);

    // الحذفُ منَ المصغّرِ نفسِهِ — بجلسةِ الشخصِ التي فتحَها الدليلُ.
    await page.getByTestId("delete-account-button").click();
    await expect(page.getByTestId("deletion-confirm-text")).toBeVisible();
    await page.getByTestId("delete-account-confirm").click();
    await expect(page.getByTestId("account-deleted-screen")).toBeVisible();
    expect(deletionCalls).toBe(1);
    expect(deletionAuthorization).toBe("Bearer e2e-core-token");

    // لا رمزَ في أيِّ تخزينٍ محليٍّ (ADR-044 §4) — الجسرُ لا يُغيّرُ ذلك.
    const localStorageContent = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(localStorageContent).not.toContain("e2e-core-token");
    expect(localStorageContent).not.toContain("e2e-test-token");
  });
});
