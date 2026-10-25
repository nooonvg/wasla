import { defineConfig, devices } from "@playwright/test";

// ADR-044: Playwright E2E + accessibility gate (Wave 6).
// Runs against the built Vite production bundle served by `vite preview`.
// API calls are mocked at the Playwright route layer — no real backend needed.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 375, height: 667 },
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    extraHTTPHeaders: {
      "Accept-Language": "ar",
    },
  },

  webServer: {
    // CLM-0699: `VITE_CORE_URL` بذاتِ الأصلِ — نداءُ حذفِ الحسابِ (`/v1/me/deletion`)
    // يُوجَّهُ إلى النواةِ مباشرةً كما في الإنتاجِ، وهنا تُحاكى استجابتُهُ على
    // مسارِهِ الحقيقيِّ نفسِهِ (`page.route`).
    command:
      "bash -c 'VITE_E2E=true VITE_CORE_URL=http://localhost:4173 npx vite build && npx vite preview --port 4173'",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
