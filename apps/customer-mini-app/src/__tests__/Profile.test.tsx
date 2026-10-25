import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Profile } from "../screens/Profile";
import { useSessionStore } from "../store/session";
import "../i18n";

vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

vi.mock("../host/account-deletion", () => ({
  accountDeletionAvailable: vi.fn(() => true),
  requestAccountDeletion: vi.fn(),
}));
vi.mock("../session/session-init", () => ({
  logoutSession: vi.fn(async () => undefined),
}));

import { accountDeletionAvailable, requestAccountDeletion } from "../host/account-deletion";
import { logoutSession } from "../session/session-init";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockedPut = apiClient.put as ReturnType<typeof vi.fn>;
const mockedDeletionAvailable = accountDeletionAvailable as ReturnType<typeof vi.fn>;
const mockedRequestDeletion = requestAccountDeletion as ReturnType<typeof vi.fn>;

describe("Profile screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000, accountDeleted: false } as never);
    vi.clearAllMocks();
    mockedDeletionAvailable.mockReturnValue(true);
  });

  it("loads profile on mount", async () => {
    mockedGet.mockResolvedValueOnce({
      display_name: "Ahmed",
      phone_number: "+966500000000",
      email: "ahmed@example.com",
      preferred_language: "ar",
    });

    render(<Profile />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/profile");
    });
  });

  it("renders profile form with loaded data", async () => {
    mockedGet.mockResolvedValueOnce({
      display_name: "Ahmed",
      phone_number: "+966500000000",
      email: "ahmed@example.com",
      preferred_language: "ar",
    });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toHaveValue("Ahmed");
    });
    expect(screen.getByTestId("phone-number-input")).toHaveValue("+966500000000");
    expect(screen.getByTestId("email-input")).toHaveValue("ahmed@example.com");
  });

  it("saves profile via PUT", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });
    mockedPut.mockResolvedValueOnce({ display_name: "Test User" });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: "Test User" } });
    fireEvent.click(screen.getByTestId("save-profile-button"));

    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledWith(
        "/customers/WS-1234567890/profile",
        expect.objectContaining({ display_name: "Test User" })
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("profile-saved")).toBeInTheDocument();
    });
  });

  it("shows error on save failure", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });
    mockedPut.mockRejectedValueOnce(new Error("save_failed"));

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("save-profile-button"));

    await waitFor(() => {
      expect(screen.getByTestId("profile-error")).toBeInTheDocument();
    });
  });

  it("allows changing preferred language", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("preferred-language-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("preferred-language-select"), { target: { value: "en" } });

    expect(screen.getByTestId("preferred-language-select")).toHaveValue("en");
  });

  // ADR-072 D1 · CMS §3.8: saved places are managed from Profile.
  it("links to saved places management from Profile", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: "Ali" });
    render(<Profile />);
    const link = await screen.findByTestId("profile-places-link");
    expect(link.getAttribute("href")).toBe("#/places");
    expect(link).toHaveTextContent("الأماكن المحفوظة");
    expect(screen.getByRole("heading", { level: 2, name: "الأماكن المحفوظة" })).toBeInTheDocument();
  });

  // D-XR-13 (CLM-0699): حذفُ الحسابِ من الملفِ الشخصيّ.
  it("shows the deletion section with an explicit confirm, and a successful deletion begins the farewell", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null });
    render(<Profile />);

    // الزرُّ الأولُ لا يحذفُ — يطلبُ التأكيدَ.
    const button = await screen.findByTestId("delete-account-button");
    fireEvent.click(button);
    expect(screen.getByTestId("deletion-confirm-text")).toHaveTextContent(
      "لا يمكن التراجعُ بعدَ الحذف",
    );
    expect(mockedRequestDeletion).not.toHaveBeenCalled();

    // التأكيدُ هو الفعلُ: النواةُ ثمّ الوداعُ في المخزنِ ثمّ مسحُ جلسةِ السوقِ.
    mockedRequestDeletion.mockResolvedValueOnce({ status: "deleted" });
    fireEvent.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => {
      expect(useSessionStore.getState().accountDeleted).toBe(true);
    });
    expect(mockedRequestDeletion).toHaveBeenCalledTimes(1);
    expect(logoutSession).toHaveBeenCalledTimes(1);
  });

  it("names the organizations an admin must handle before deleting", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null });
    mockedRequestDeletion.mockResolvedValueOnce({
      status: "refused_admin",
      organizationIds: ["org-a"],
    });
    render(<Profile />);

    fireEvent.click(await screen.findByTestId("delete-account-button"));
    fireEvent.click(screen.getByTestId("delete-account-confirm"));

    const error = await screen.findByTestId("deletion-error");
    expect(error).toHaveTextContent("org-a");
    // الحسابُ لم يُحذف: لا وداعَ ولا مسحَ جلسةٍ.
    expect(useSessionStore.getState().accountDeleted).toBe(false);
    expect(logoutSession).not.toHaveBeenCalled();
  });

  it("guides a mini-app user to the web version instead of a dead button (the declared limit)", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null });
    mockedDeletionAvailable.mockReturnValue(false);
    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("deletion-web-only")).toHaveTextContent(
        "حذفُ الحسابِ يتمُّ من نسخةِ الويبِ",
      );
    });
    expect(screen.queryByTestId("delete-account-button")).toBeNull();
  });
});
