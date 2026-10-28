import { test, expect } from "@playwright/test";
import { seedSession, stubTelegramSdk } from "./helpers";

// Security E2E tests: verify that the in-memory session model is secure.
// ADR-044 Decision 4: Session token in memory only, no localStorage.
// ADR-019 §2.5: Token never persisted to localStorage, sessionStorage, or cookies.

test.describe("Session security", () => {
  // G-S8 (CLM-0610): outside Telegram there is no session source, so the app
  // says so with a retry instead of parking on «جارٍ التحميل» forever. (Was:
  // "fresh browser shows loading state without session".)
  // XR-8.5: in the browser the app now offers the Telegram web login (CORE
  // session) instead of a dead-end message — the button is the probe.
  test("fresh browser outside Telegram shows an explicit session error, not endless loading", async ({ page }) => {
    await page.goto("http://localhost:4173/");

    await expect(page.getByTestId("session-error")).toHaveText("سجّل الدخول بحساب تيليجرام للمتابعة");
    await expect(page.getByTestId("web-sign-in")).toBeVisible();
    await expect(page.locator(".app-loading")).toHaveCount(0);
  });

  // CLM-0703: inside Telegram the bridge is the path — a rejected core
  // exchange is the visible failure (core_rejected), and the retry re-runs the
  // exchange and recovers. The legacy /edge/session path is a unit-tested
  // environment decision (VITE_CORE_URL unset) and cannot be exercised in
  // this build, which always carries the bridge.
  test("a rejected core exchange is shown with retry, and retry recovers the app", async ({ page }) => {
    await stubTelegramSdk(page, "query_id=e2e&hash=abc");
    let exchangeCalls = 0;
    await page.route("**/v1/web-session/telegram/init-data", (route) => {
      exchangeCalls += 1;
      if (exchangeCalls === 1) {
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "CORE_UNAVAILABLE", message: "x" }) });
        return;
      }
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "core-e2e-retry",
          access_token: "e2e-core-token",
          token_type: "Bearer",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          identity_id: "i-e2e",
          identity_created: true,
        }),
      });
    });
    await page.route("**/edge/session/web", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "e2e-test-token",
          wasla_public_id: "WS-1234567890",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          session_id: "market-e2e-retry",
        }),
      }),
    );

    await page.goto("http://localhost:4173/");
    await expect(page.getByTestId("session-error")).toHaveText("تعذّر إثبات الحساب عند النواة — أعد فتح التطبيق");
    expect(exchangeCalls).toBe(1);

    await page.getByTestId("session-retry").click();
    await expect(page.locator(".app")).toBeVisible();
    expect(exchangeCalls).toBe(2);
  });

  test("no API calls are made without a session token", async ({ page }) => {
    // Intercept all requests to verify no customer API calls happen
    const apiCalls: string[] = [];
    await page.route("**/customers/**", (route) => {
      apiCalls.push(route.request().url());
      route.abort();
    });

    await page.goto("http://localhost:4173/");

    // Wait a moment for any potential requests
    await page.waitForTimeout(1000);

    expect(apiCalls).toHaveLength(0);
  });

  test("localStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4173/");
    await page.waitForTimeout(500);

    const localStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.localStorage);
    });

    // localStorage should be empty or at least not contain token/session
    expect(localStorageContent).not.toContain("e2e-test-token");
    expect(localStorageContent).not.toContain("token");
    expect(localStorageContent).not.toContain("WS-");
  });

  test("sessionStorage does not contain session token", async ({ page }) => {
    await page.goto("http://localhost:4173/");
    await page.waitForTimeout(500);

    const sessionStorageContent = await page.evaluate(() => {
      return JSON.stringify(window.sessionStorage);
    });

    expect(sessionStorageContent).not.toContain("e2e-test-token");
    expect(sessionStorageContent).not.toContain("token");
    expect(sessionStorageContent).not.toContain("WS-");
  });

  test("authenticated session shows app content", async ({ page }) => {
    await seedSession(page);
    await page.goto("http://localhost:4173/");

    // Should show the app, not loading state
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".home")).toBeVisible();
  });
});
