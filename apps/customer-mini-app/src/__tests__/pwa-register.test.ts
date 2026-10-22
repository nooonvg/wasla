import { describe, it, expect, vi, afterEach } from "vitest";
import { registerServiceWorker } from "../pwa/register-service-worker";
import * as hostModule from "../host";
import type { Host } from "../host";

// XR-8.3 (CLM-0665 · المراجعة 6): عامل الخدمة يسجَّل بإنتاجٍ ومتصفحٍ فقط.
// الشروط الأربعة مقيسة واحدة واحدة، وفشل التسجيل لا يُفشل التطبيق.

const telegramHost: Host = {
  kind: "telegram",
  ready: () => undefined,
  sessionCredential: () => ({ kind: "telegram_init_data", value: "x" }),
};

const browserHost: Host = {
  kind: "browser",
  ready: () => undefined,
  sessionCredential: () => null,
};

function stubServiceWorker(register: () => Promise<unknown>) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(register) },
  });
}

afterEach(() => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("registerServiceWorker", () => {
  it("registers /sw.js when production, browser host, and service worker supported", () => {
    stubServiceWorker(() => Promise.resolve({}));
    vi.spyOn(hostModule, "detectHost").mockReturnValue(browserHost);
    registerServiceWorker({ prod: true });
    expect(navigator.serviceWorker?.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does nothing outside production", () => {
    stubServiceWorker(() => Promise.resolve({}));
    vi.spyOn(hostModule, "detectHost").mockReturnValue(browserHost);
    registerServiceWorker({ prod: false });
    expect(navigator.serviceWorker?.register).not.toHaveBeenCalled();
  });

  it("does nothing in Playwright e2e builds (VITE_E2E)", () => {
    stubServiceWorker(() => Promise.resolve({}));
    vi.spyOn(hostModule, "detectHost").mockReturnValue(browserHost);
    registerServiceWorker({ prod: true, e2e: true });
    expect(navigator.serviceWorker?.register).not.toHaveBeenCalled();
  });

  it("does nothing inside Telegram (host kind telegram)", () => {
    stubServiceWorker(() => Promise.resolve({}));
    vi.spyOn(hostModule, "detectHost").mockReturnValue(telegramHost);
    registerServiceWorker({ prod: true });
    expect(navigator.serviceWorker?.register).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no service worker API", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(hostModule, "detectHost").mockReturnValue(browserHost);
    expect(() => registerServiceWorker({ prod: true })).not.toThrow();
  });

  it("swallows registration rejection instead of failing the app", async () => {
    stubServiceWorker(() => Promise.reject(new Error("sw failed")));
    vi.spyOn(hostModule, "detectHost").mockReturnValue(browserHost);
    expect(() => registerServiceWorker({ prod: true })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
