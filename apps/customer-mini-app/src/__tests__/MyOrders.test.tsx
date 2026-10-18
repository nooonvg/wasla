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

import { apiClient } from "../api/client";

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
        { order_request_id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        { order_request_id: "req-2", order_type: "delivery", status: "completed", vehicle_class: "van", created_at: "2026-09-21T00:00:00Z" },
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
});
