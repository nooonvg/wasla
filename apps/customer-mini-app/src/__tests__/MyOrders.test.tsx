import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MyOrders } from "../screens/MyOrders";
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

import { apiClient, ApiError } from "../api/client";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;

describe("MyOrders screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads orders on mount", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      // G-S9.10 (CLM-0616): CMS §3.6 L90 `?limit=5`. (Was the bare path — no limit.)
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/order-requests?limit=5");
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("renders orders list", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        { id: "req-2", order_type: "delivery", status: "completed", vehicle_class: "van", created_at: "2026-09-21T00:00:00Z" },
      ],
      limit: 20,
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("order-req-2")).toBeInTheDocument();
  });

  it("shows empty state when no orders", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
    });
  });

  it("filters orders by status", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("status-filter-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "submitted" } });

    await waitFor(() => {
      // G-S9.10 (CLM-0616): the filter is kept and `limit=5` rides along.
      // (Was `?status=submitted` — no limit.)
      expect(mockedGet).toHaveBeenCalledWith(
        "/customers/WS-1234567890/order-requests?status=submitted&limit=5",
      );
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect((screen.getByTestId("status-filter-select") as HTMLSelectElement).value).toBe("submitted");
  });

  it("sends limit=5 on every load: mount, filter change and filter reset (G-S9.10)", async () => {
    mockedGet.mockResolvedValue({ items: [] });

    render(<MyOrders />);
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "submitted" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(3));

    const calls = mockedGet.mock.calls.map(([url]) => new URL(url as string, "http://x"));
    for (const url of calls) {
      expect(url.pathname).toBe("/customers/WS-1234567890/order-requests");
      expect(url.searchParams.getAll("limit")).toEqual(["5"]);
    }
    expect(calls.map((url) => url.searchParams.get("status"))).toEqual([null, "submitted", null]);
    expect((screen.getByTestId("status-filter-select") as HTMLSelectElement).value).toBe("");
  });

  it("shows error on failure", async () => {
    mockedGet.mockRejectedValueOnce(new Error("load_failed"));

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-error")).toBeInTheDocument();
    });
  });

  // G-S9.11 (CLM-0638): CMS §3.6 L87 — click a request → «تفاصيل الحالة والمسار».
  it("opens the detail view with status and route when an order is clicked", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockResolvedValueOnce({
      id: "req-1",
      wasla_public_id: "WS-1234567890",
      status: "submitted",
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "fixed",
      offered_price: { amount: 25.5, currency: "SAR" },
      created_at: "2026-09-22T00:00:00Z",
      stops: [
        { kind: "pickup", sequence: 1, zone_id: "zone-a", zone_path: "المدينة المنورة / العزيزية", label: "المنزل" },
        { kind: "dropoff", sequence: 2, zone_id: "zone-b", zone_path: "المدينة المنورة / الحرم", label: null },
      ],
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/order-requests/req-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-detail")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-detail-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-status").textContent).toContain(
      "مُرسل",
    );
    expect(screen.getByTestId("order-detail-price").textContent).toContain("25.5");
    expect(screen.getByTestId("order-detail-stops")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-stop-1").textContent).toContain("الالتقاط");
    expect(screen.getByTestId("order-detail-stop-2").textContent).toContain("التسليم");
  });

  it("returns to the list from the detail view", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockResolvedValueOnce({
      id: "req-1",
      wasla_public_id: "WS-1234567890",
      status: "submitted",
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "fixed",
      offered_price: null,
      created_at: "2026-09-22T00:00:00Z",
      stops: [
        { kind: "pickup", sequence: 1, zone_id: "zone-a", zone_path: null, label: null },
        { kind: "dropoff", sequence: 2, zone_id: "zone-b", zone_path: null, label: null },
      ],
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("order-detail-back"));

    await waitFor(() => {
      expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("order-detail")).toBeNull();
  });

  it("shows the not-found message when the detail request returns 404", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockRejectedValueOnce(new ApiError(404, "طلب العميل غير موجود"));

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));

    await waitFor(() => {
      expect(screen.getByTestId("order-detail-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-detail-error").textContent).toContain(
      "الطلب غير موجود",
    );
  });
});
