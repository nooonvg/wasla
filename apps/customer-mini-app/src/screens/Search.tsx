import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";
import { formatMoney, localizedTitle, type LocalizedTitle } from "../i18n/format";

/** services/search `SearchResult` field names (domain/model.ts). */
interface SearchResult extends LocalizedTitle {
  product_id: string;
  store_slug: string;
  price_minor_units: number;
  currency_code: string;
}

export function Search() {
  const { t, i18n } = useTranslation();
  const { token } = useSessionStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!token || !query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        locale: "ar",
        page: "1",
        page_size: "20",
        sort: "relevance",
      });
      const result = await apiClient.get<{ items: SearchResult[]; total: number }>(
        `/search/products?${params.toString()}`
      );
      setResults(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "search_failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [token, query]);

  return (
    <div className="screen search-screen">
      <h1>{t("search.title")}</h1>

      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          data-testid="search-input"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading || !query.trim() || !token}
          data-testid="search-button"
        >
          {loading ? t("common.loading") : t("search.button")}
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert" data-testid="search-error">
          {t(`errors.${error}`)}
        </div>
      )}

      {searched && !loading && !error && results.length === 0 && (
        <div className="empty-state" data-testid="search-empty">
          <p className="empty-state-title">{t("search.no_results")}</p>
          <p className="empty-state-hint">{t("search.no_results_hint")}</p>
          <a className="empty-state-action" href="#/marketplace" data-testid="search-empty-browse">
            {t("search.browse_stores")}
          </a>
        </div>
      )}

      {searched && !loading && !error && results.length > 0 && (
        <ul className="search-results-list" data-testid="search-results-list">
          {results.map((item) => (
            <li key={item.product_id} className="search-result-item" data-testid={`result-${item.product_id}`}>
              <span className="result-name">{localizedTitle(item, i18n.language)}</span>
              <span className="result-price">
                <bdi>{formatMoney({ amount_minor: item.price_minor_units, currency: item.currency_code }, i18n.language)}</bdi>
              </span>
              <span className="result-store">{item.store_slug}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
