/**
 * Locale-aware formatting for money, dates and server-supplied enum labels.
 *
 * Money crosses the wire as `{ amount_minor, currency }` (packages/contracts/
 * customer `Money`; services/customers `normalizeMoney` rejects anything else).
 * Before CLM-0707 the app sent `{ amount: 25.5 }` and rendered
 * `offered_price.amount`, so every customer-priced order was refused with
 * «المبلغ غير صالح» and a stored price rendered as "undefined SAR".
 */
import i18n from "i18next";

const LOCALES: Record<string, string> = { ar: "ar-SA", en: "en-GB", ur: "ur-PK" };

export function activeLocale(language: string = i18n.language ?? "ar"): string {
  const base = (language || "ar").split("-")[0] ?? "ar";
  return LOCALES[base] ?? "ar-SA";
}

/** Minor-unit exponent of a currency as Intl knows it (SAR → 2, JPY → 0, KWD → 3). */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Parses what a person types into a price field. Arabic-Indic (٠-٩) and
 * Persian/Urdu (۰-۹) digits, the Arabic decimal separator «٫» and a comma
 * decimal are accepted, because a phone keyboard in Arabic or Urdu produces
 * them. Returns an integer in minor units, or null when the text is not a
 * positive amount with at most the currency's minor digits.
 */
export function parseAmountToMinor(text: string, currency = "SAR"): number | null {
  const ascii = text
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066B,]/g, ".")
    .replace(/[\u066C\s]/g, "");
  const exponent = currencyExponent(currency);
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(ascii)) return null;
  const [whole = "0", fraction = ""] = ascii.split(".");
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export interface Money {
  amount_minor: number;
  currency: string;
}

export function formatMoney(money: Money | null | undefined, language?: string): string {
  if (!money || typeof money.amount_minor !== "number") return "—";
  const exponent = currencyExponent(money.currency);
  try {
    return new Intl.NumberFormat(activeLocale(language), {
      style: "currency",
      currency: money.currency,
    }).format(money.amount_minor / 10 ** exponent);
  } catch {
    return `${money.amount_minor / 10 ** exponent} ${money.currency}`;
  }
}

/** A date in the active language; an unparseable value renders as a dash, never "Invalid Date". */
export function formatDate(iso: string | null | undefined, language?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(activeLocale(language), { dateStyle: "medium" }).format(date);
}

/**
 * The label of a server-supplied enum value (`orders.status_<value>`). A value
 * the catalog does not know yet renders as the generic «unknown» label instead
 * of the raw translation key.
 */
export function enumLabel(
  t: (key: string, options?: { defaultValue?: string }) => string,
  prefix: string,
  value: string | null | undefined,
): string {
  const unknown = t("common.unknown_value");
  if (!value) return unknown;
  return t(`${prefix}${value}`, { defaultValue: unknown });
}

/** Catalog titles arrive per language (`title_ar` always, `title_en`/`title_ur` optional). */
export interface LocalizedTitle {
  title_ar: string;
  title_en?: string | null;
  title_ur?: string | null;
}

export function localizedTitle(item: LocalizedTitle, language: string = i18n.language ?? "ar"): string {
  const base = (language || "ar").split("-")[0];
  if (base === "en" && item.title_en) return item.title_en;
  if (base === "ur" && item.title_ur) return item.title_ur;
  return item.title_ar;
}
