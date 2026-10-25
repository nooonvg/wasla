/**
 * G-S8 (CLM-0610): the app shell never parks on an endless loading screen —
 * a failed session init is shown with a retry that calls `retrySession`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "../i18n";

vi.mock("../session/session-init", () => ({ retrySession: vi.fn(async () => false) }));

import { App } from "../App";
import { retrySession } from "../session/session-init";
import { useSessionStore } from "../store/session";

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ token: null, customerId: null, expiresAt: null, initStatus: "idle", initError: null, accountDeleted: false } as never);
});

describe("App session states", () => {
  it("shows the failure reason and a retry button instead of loading when init failed", () => {
    useSessionStore.setState({ initStatus: "failed", initError: "network" });
    const { container } = render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر الاتصال لبدء الجلسة");
    expect(container.querySelector(".app-loading")).toBeNull();
    fireEvent.click(screen.getByTestId("session-retry"));
    expect(retrySession).toHaveBeenCalledTimes(1);
  });

  it("names the not-in-Telegram case explicitly", () => {
    useSessionStore.setState({ initStatus: "failed", initError: "not_in_telegram" });
    render(<App />);
    expect(screen.getByTestId("session-error")).toHaveTextContent("افتح التطبيق من تلغرام لبدء الجلسة");
  });

  it("shows loading only while an init is in progress", () => {
    useSessionStore.setState({ initStatus: "initializing", initError: null });
    const { container } = render(<App />);
    expect(container.querySelector(".app-loading")).not.toBeNull();
    expect(screen.queryByTestId("session-retry")).toBeNull();
  });
});

describe("Account deletion farewell (D-XR-13 · CLM-0699)", () => {
  it("a deleted account shows the farewell screen, not the sign-in screen", () => {
    useSessionStore.setState({ accountDeleted: true, token: null, initStatus: "failed", initError: "web_login_required" });
    render(<App />);
    expect(screen.getByTestId("account-deleted-screen")).toBeVisible();
    // لا شاشةَ دخولٍ ولا زرَّ دخولٍ — الوداعُ أولًا.
    expect(screen.queryByTestId("web-sign-in")).toBeNull();
    expect(screen.getByTestId("account-deleted-message")).toHaveTextContent(
      "حُذف حسابُك نهائيًا وانتُهيت جلساتُك كلُّها",
    );
  });

  it("fresh start is the person's own choice — it returns to the normal logged-out screen", () => {
    useSessionStore.setState({ accountDeleted: true, token: null, initStatus: "failed", initError: "web_login_required" });
    render(<App />);
    fireEvent.click(screen.getByTestId("account-deleted-fresh-start"));
    // عادَ الوضعُ الطبيعيّ: شاشةُ الدخولِ ظاهرةٌ (البدءُ من جديدٍ = تسجيلٌ جديدٌ عندَ النواةِ).
    expect(screen.queryByTestId("account-deleted-screen")).toBeNull();
    expect(screen.getByTestId("web-sign-in")).toBeVisible();
  });
});
