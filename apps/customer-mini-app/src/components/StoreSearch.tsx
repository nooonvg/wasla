import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

// G-S9.7 (CLM-0649): store-name search (CMS §3.4 — Marketplace browse).
// Contract: GET /search/stores?q=&locale=&page=&page_size= (search service,
// ADR-025 §6) — only approved stores with at least one visible product, as a
// three-field public projection (store_slug · title · category_slug). The app
// never sends a state/owner filter: eligibility is the service's rule, and the
// service rejects undeclared parameters.
//
// Lesson of G-S9.18 (CLM-0643): a response only reaches the UI if it answers
// the latest search — an older, slower response never replaces a newer one.

export const STORE_SEARCH_MIN_LENGTH = 2;
export const STORE_SEARCH_PAGE_SIZE = 20;

export interface StoreSearchResult {
  store_slug: string;
  title: string;
  category_slug: string;
}

interface StoreSearchPage {
  items: StoreSearchResult[];
  page: number;
  page_size: number;
  total: number;
}

interface StoreSearchProps {
  testId: string;
  onSelect: (store: StoreSearchResult) => void;
}

type Status = "idle" | "too_short" | "loading" | "success" | "error";

export function StoreSearch({ testId, onSelect }: StoreSearchProps) {
  const { t, i18n } = useTranslation();
  const { token } = useSessionStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StoreSearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSearch = useCallback(async () => {
    if (!token) return;
    const q = query.trim();
    seqRef.current += 1;
    const seq = seqRef.current;
    if ([...q].length < STORE_SEARCH_MIN_LENGTH) {
      setResults([]);
      setStatus("too_short");
      return;
    }
    setStatus("loading");
    const locale = ["ar", "en", "ur"].includes(i18n.language) ? i18n.language : "ar";
    try {
      const page = await apiClient.get<StoreSearchPage>(
        `/search/stores?q=${encodeURIComponent(q)}&locale=${locale}&page=1&page_size=${STORE_SEARCH_PAGE_SIZE}`
      );
      if (!mountedRef.current || seq !== seqRef.current) return; // stale
      setResults(page.items);
      setStatus("success");
    } catch {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setResults([]);
      setStatus("error");
    }
  }, [token, query, i18n.language]);

  const handleSelect = useCallback(
    (store: StoreSearchResult) => {
      seqRef.current += 1; // any in-flight search no longer applies
      onSelect(store);
      setResults([]);
      setStatus("idle");
      setQuery("");
    },
    [onSelect]
  );

  return (
    <div className="form-group store-search" data-testid={testId}>
      <label htmlFor={`${testId}-input`}>{t("marketplace.store_search_label")}</label>
      <div className="store-search-row">
        <input
          id={`${testId}-input`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder={t("marketplace.store_search_placeholder")}
          aria-label={t("marketplace.store_search_label")}
          data-testid={`${testId}-input`}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={status === "loading"}
          data-testid={`${testId}-button`}
        >
          {t("marketplace.store_search_button")}
        </button>
      </div>
      {status === "loading" && (
        <p className="store-search-status" data-testid={`${testId}-loading`}>
          {t("marketplace.store_search_loading")}
        </p>
      )}
      {status === "too_short" && (
        <p className="store-search-status" role="alert" data-testid={`${testId}-too-short`}>
          {t("marketplace.store_search_too_short")}
        </p>
      )}
      {status === "error" && (
        <p className="store-search-status error" role="alert" data-testid={`${testId}-error`}>
          {t("marketplace.store_search_error")}
        </p>
      )}
      {status === "success" && results.length === 0 && (
        <p className="store-search-status" data-testid={`${testId}-empty`}>
          {t("marketplace.store_search_empty")}
        </p>
      )}
      {status === "success" && results.length > 0 && (
        <ul className="store-search-results" data-testid={`${testId}-results`}>
          {results.map((store) => (
            <li key={store.store_slug}>
              <button
                type="button"
                onClick={() => handleSelect(store)}
                data-testid={`${testId}-result-${store.store_slug}`}
              >
                {store.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
