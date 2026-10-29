import { describe, expect, it } from "vitest";
import "../i18n";
import { enumLabel, formatDate, formatMoney, localizedTitle, parseAmountToMinor } from "../i18n/format";

const westernDigits = (s: string) =>
  s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\u066B/g, ".");

describe("parseAmountToMinor — what a person types into a price field", () => {
  it("reads Western, Arabic-Indic and Urdu digits alike", () => {
    expect(parseAmountToMinor("25.50")).toBe(2550);
    expect(parseAmountToMinor("٢٥٫٥٠")).toBe(2550);
    expect(parseAmountToMinor("۲۵.۵")).toBe(2550);
    expect(parseAmountToMinor("25,5")).toBe(2550);
    expect(parseAmountToMinor(" 30 ")).toBe(3000);
  });

  it("refuses zero, negatives, junk and more decimals than the currency has", () => {
    for (const bad of ["", "0", "0.00", "-5", "abc", "1e3", "25.505", "25..5"]) {
      expect(parseAmountToMinor(bad), bad).toBeNull();
    }
  });

  it("follows the currency's exponent", () => {
    expect(parseAmountToMinor("1.250", "KWD")).toBe(1250);
    expect(parseAmountToMinor("500", "JPY")).toBe(500);
    expect(parseAmountToMinor("5.5", "JPY")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("renders minor units as the currency amount, never 'undefined'", () => {
    expect(westernDigits(formatMoney({ amount_minor: 2550, currency: "SAR" }, "ar"))).toMatch(/25[.,]50/);
    expect(formatMoney({ amount_minor: 2550, currency: "SAR" }, "en")).toMatch(/SAR\s?25\.50/);
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("follows the active language and never prints Invalid Date", () => {
    expect(formatDate("2026-09-22T00:00:00Z", "en")).toMatch(/2026/);
    expect(formatDate("not-a-date", "ar")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });
});

describe("enumLabel", () => {
  const t = (key: string, options?: { defaultValue?: string }) =>
    ({ "common.unknown_value": "غير محدد", "orders.type_ride": "طلب رحلة" } as Record<string, string>)[key] ??
    options?.defaultValue ?? key;

  it("labels a known value and falls back for one the catalog does not know yet", () => {
    expect(enumLabel(t, "orders.type_", "ride")).toBe("طلب رحلة");
    expect(enumLabel(t, "orders.type_", "store_order")).toBe("غير محدد");
    expect(enumLabel(t, "orders.type_", undefined)).toBe("غير محدد");
  });
});

describe("localizedTitle", () => {
  it("prefers the active language and falls back to Arabic", () => {
    const item = { title_ar: "قهوة", title_en: "Coffee" };
    expect(localizedTitle(item, "en")).toBe("Coffee");
    expect(localizedTitle(item, "ur")).toBe("قهوة");
    expect(localizedTitle(item, "ar")).toBe("قهوة");
  });
});
