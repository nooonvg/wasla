import { test, expect } from "@playwright/test";
import { seedSession } from "./helpers";

// M3-06 frontend quality gate: locale override, offline banner, responsive layout.
// Mobile viewport (375x667) and RTL Arabic default come from playwright.config.ts.

test.describe("Frontend quality (M3-06)", () => {
  test("locale override ?locale=en switches document lang/dir and renders English", async ({ page }) => {
    await page.goto("http://localhost:4173/?locale=en##/home");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    // G-S8 (CLM-0610): outside Telegram the shell shows the session error, not an
    // endless "Loading..." — so the English probe is that text. (Was: "Loading...".)
    await expect(page.getByText("Open the app from Telegram to start a session")).toBeVisible();
  });

  test("offline banner appears when the network drops and clears on reconnect", async ({ page }) => {
    await page.goto("http://localhost:4173/#/home");

    await page.context().setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("غير متصل");

    // corrective hardening (CLM-0324): the banner must be a full-width top bar,
    // never a side-by-side flex child of the loading/shell container.
    const bannerGeo = await page.getByTestId("offline-banner").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, width: r.width, viewport: window.innerWidth };
    });
    expect(bannerGeo.top).toBeLessThanOrEqual(1);
    expect(bannerGeo.viewport - bannerGeo.width).toBeLessThanOrEqual(1);

    await page.context().setOffline(false);
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:4173##/home");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// XR-8.3a (CLM-0658): التطبيقُ نفسُه يُثبَّتُ من المتصفّحِ ويُقرأُ على الحاسوب.
function pngSize(buf: Buffer): { width: number; height: number } {
  // ترويسةُ PNG: 8 بايتاتِ توقيعٍ، ثمّ مقطعُ IHDR وفيه العرضُ والارتفاع (big-endian).
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test.describe("Web install and desktop (XR-8.3a)", () => {
  test("the page links a manifest that satisfies Chrome's install criteria", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBeTruthy();
    expect(["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]).toContain(m.display);
    expect(m.lang).toBe("ar");
    expect(m.dir).toBe("rtl");
    const sizes = (m.icons as { src: string; sizes: string; type: string }[]).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      const img = await request.get(new URL(icon.src, new URL(href!, "http://x")).pathname);
      expect(img.status()).toBe(200);
      expect(icon.type).toBe("image/png");
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(Buffer.from(await img.body()))).toEqual({ width: w, height: h });
    }
  });

  test("on a 1280px desktop the app is one centred, readable column", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSession(page);
    await page.goto("/");
    await expect(page.locator(".app")).toBeVisible();
    const box = await page.locator(".app").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box!.x + box!.width / 2 - 640)).toBeLessThanOrEqual(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

