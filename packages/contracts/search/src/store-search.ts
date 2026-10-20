/**
 * @wasla/contracts-search — store-name search contract constants
 * (G-S9.7 · CLM-0649 · ADR-025 §6.4). Mirrors `GET /search/stores` in
 * services/search/contracts/api.openapi.yml; `__tests__/contracts.test.ts`
 * fails if the two drift. The service imports these — one source for bounds.
 */

export const STORE_SEARCH_LOCALES = ["ar", "en", "ur"] as const;
export type StoreSearchLocale = (typeof STORE_SEARCH_LOCALES)[number];

export const STORE_SEARCH_LIMITS = Object.freeze({
  qMinLength: 2,
  qMaxLength: 64,
  pageMax: 50,
  pageSizeMax: 20,
  pageSizeDefault: 10,
});

/** The only query keys `GET /search/stores` accepts; anything else is 400. */
export const STORE_SEARCH_QUERY_KEYS = ["q", "locale", "page", "page_size"] as const;

/** The public projection — exactly these fields per item, nothing internal. */
export const STORE_SEARCH_RESULT_FIELDS = ["store_slug", "title", "category_slug"] as const;
