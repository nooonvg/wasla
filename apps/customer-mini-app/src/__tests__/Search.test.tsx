import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Search } from "../screens/Search";
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

describe("Search screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("renders search input and button", () => {
    render(<Search />);
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
    expect(screen.getByTestId("search-button")).toBeInTheDocument();
  });

  it("disables search button when query is empty", () => {
    render(<Search />);
    expect(screen.getByTestId("search-button")).toBeDisabled();
  });

  it("calls search API with query params", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], total: 0 });

    render(<Search />);
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "coffee" } });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith(
        expect.stringContaining("/search/products?q=coffee")
      );
    });
  });

  it("shows no results state", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], total: 0 });

    render(<Search />);
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "nothing" } });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("search-empty")).toBeInTheDocument();
    });
    // An empty result guides: a hint and a way onward, not a dead end.
    await waitFor(() => {
      expect(screen.getByTestId("search-empty-browse").getAttribute("href")).toBe("#/marketplace");
    });
  });

  it("renders search results", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { product_id: "p1", title_ar: "Coffee Beans", store_slug: "store-1", price_minor_units: 2500, currency_code: "SAR" },
        { product_id: "p2", title_ar: "Coffee Maker", store_slug: "store-2", price_minor_units: 15000, currency_code: "SAR" },
      ],
      total: 2,
    });

    render(<Search />);
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "coffee" } });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("search-results-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("result-p1")).toBeInTheDocument();
    expect(screen.getByTestId("result-p2")).toBeInTheDocument();
    // services/search SearchResult: the title and the minor-unit price are what render.
    expect(screen.getByTestId("result-p1").textContent).toContain("Coffee Beans");
    expect(screen.getByTestId("result-p1").textContent).not.toContain("undefined");
  });

  it("shows error on failure", async () => {
    mockedGet.mockRejectedValueOnce(new Error("search_failed"));

    render(<Search />);
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("search-error")).toBeInTheDocument();
    });
  });
});
