/**
 * Store-name search — domain rules (G-S9.7 · CLM-0649 · ADR-025 §6).
 *
 * Pure functions only: normalization (the SAME function for indexed names and
 * for the query, so both sides fold identically), LIKE escaping, title
 * localisation, and request parsing against the shared contract bounds in
 * `@wasla/contracts-search`. Eligibility (store approved ∧ ≥1 visible product)
 * is NOT decided here — it is derived at read time in SQL from consumed state
 * (ADR-025 §6.3); no stored flag exists to decide it from.
 */

import {
  STORE_SEARCH_LIMITS,
  STORE_SEARCH_LOCALES,
  STORE_SEARCH_QUERY_KEYS,
  type StoreSearchLocale,
} from "@wasla/contracts-search";
import { normalizeQuery } from "./query.js";

/**
 * Declared Arabic/Urdu folding for MATCHING (ADR-025 §6.4), applied after
 * `normalizeQuery` (tashkeel + tatweel stripped, whitespace collapsed,
 * lower-cased). No stemming. Each line is one documented rule:
 *   أ إ آ ٱ → ا        (hamza/madda/wasla alef forms)
 *   ى ي ی ئ → ي        (alef maqsura, Urdu farsi yeh, yeh-hamza)
 *   ؤ → و
 *   ة ه ہ ۃ → ه        (teh marbuta, Urdu heh goal and its teh form)
 *   ك ک → ك            (Urdu keheh)
 */
const FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u0623\u0625\u0622\u0671]/g, "\u0627"],
  [/[\u0649\u064A\u06CC\u0626]/g, "\u064A"],
  [/\u0624/g, "\u0648"],
  [/[\u0629\u0647\u06C1\u06C3]/g, "\u0647"],
  [/[\u0643\u06A9]/g, "\u0643"],
];

export function normalizeStoreName(raw: string): string {
  let s = normalizeQuery(raw).normalized;
  for (const [re, to] of FOLDS) s = s.replace(re, to);
  return s;
}

/** Escape LIKE metacharacters so `%`, `_` and `\` match literally (ESCAPE '\'). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface StoreNames {
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly title_ur: string | null;
}

/** The title in the requested locale, falling back to Arabic when absent/blank. */
export function localizedTitle(names: StoreNames, locale: StoreSearchLocale): string {
  const pick = locale === "en" ? names.title_en : locale === "ur" ? names.title_ur : names.title_ar;
  return pick !== null && pick.trim().length > 0 ? pick : names.title_ar;
}

export interface ParsedStoreSearch {
  /** Normalized + folded query — compared against `name_norm_*`. */
  readonly q: string;
  readonly locale: StoreSearchLocale;
  readonly page: number;
  readonly pageSize: number;
}

export class StoreSearchValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreSearchValidationError";
  }
}

function single(value: unknown, code: string, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new StoreSearchValidationError(code, `${name}: قيمةٌ واحدةٌ نصّيّةٌ مطلوبة`);
  return value;
}

function boundedInt(value: unknown, code: string, name: string, min: number, max: number, dflt: number): number {
  const raw = single(value, code, name);
  if (raw === undefined) return dflt;
  if (!/^\d+$/.test(raw)) throw new StoreSearchValidationError(code, `${name} يجب أن يكون عددًا صحيحًا بين ${min} و${max}`);
  const n = Number(raw);
  if (n < min || n > max) throw new StoreSearchValidationError(code, `${name} خارج النطاق ${min}..${max}`);
  return n;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set(STORE_SEARCH_QUERY_KEYS);
const LOCALES: ReadonlySet<string> = new Set(STORE_SEARCH_LOCALES);

/**
 * Parse `GET /search/stores` query. Rejects — never ignores — undeclared keys:
 * a silently dropped `state=` or `owner_public_id=` would let a caller believe
 * it filtered something it did not (ADR-025 §6.5 · E-20).
 */
export function parseStoreSearchRequest(query: Record<string, unknown>): ParsedStoreSearch {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new StoreSearchValidationError("SEARCH_UNKNOWN_PARAMETER", `معاملٌ غيرُ معلَنٍ: ${key}`);
    }
  }
  const qRaw = single(query.q, "SEARCH_QUERY_EMPTY", "q");
  const trimmed = (qRaw ?? "").trim();
  if (trimmed.length === 0) throw new StoreSearchValidationError("SEARCH_QUERY_EMPTY", "نصُّ البحثِ مفقودٌ أو فارغٌ");
  const len = [...trimmed].length;
  if (len < STORE_SEARCH_LIMITS.qMinLength) {
    throw new StoreSearchValidationError("SEARCH_QUERY_TOO_SHORT", `نصُّ البحثِ أقصرُ من ${STORE_SEARCH_LIMITS.qMinLength} محرفين`);
  }
  if (len > STORE_SEARCH_LIMITS.qMaxLength) {
    throw new StoreSearchValidationError("SEARCH_QUERY_TOO_LONG", `نصُّ البحثِ يتجاوزُ ${STORE_SEARCH_LIMITS.qMaxLength} محرفًا`);
  }
  const q = normalizeStoreName(trimmed);
  if (q.length === 0) throw new StoreSearchValidationError("SEARCH_QUERY_EMPTY", "نصُّ البحثِ فارغٌ بعدَ التطبيعِ");

  const localeRaw = single(query.locale, "SEARCH_UNSUPPORTED_LOCALE", "locale") ?? "ar";
  if (!LOCALES.has(localeRaw)) throw new StoreSearchValidationError("SEARCH_UNSUPPORTED_LOCALE", `locale غيرُ مدعومٍ: ${localeRaw}`);

  const page = boundedInt(query.page, "SEARCH_PAGE_OUT_OF_RANGE", "page", 1, STORE_SEARCH_LIMITS.pageMax, 1);
  const pageSize = boundedInt(
    query.page_size,
    "SEARCH_PAGE_SIZE_INVALID",
    "page_size",
    1,
    STORE_SEARCH_LIMITS.pageSizeMax,
    STORE_SEARCH_LIMITS.pageSizeDefault,
  );
  return { q, locale: localeRaw as StoreSearchLocale, page, pageSize };
}
