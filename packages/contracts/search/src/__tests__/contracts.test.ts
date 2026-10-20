import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/search/contracts");

const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const eventsRaw = readFileSync(resolve(base, "events.json"), "utf8");
const events = JSON.parse(eventsRaw) as unknown;

/** Strip SQL comments so prose that mentions forbidden names in negation context is ignored. */
const schemaCode = schema.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

describe("search contracts — foundational invariants (ADR-025)", () => {
  it("schema declares the derived index table", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_product_index/);
  });

  it("schema declares an outbox for index lifecycle events", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_outbox/);
  });

  it("schema enables pg_trgm for Arabic/approximate matching", () => {
    expect(schemaCode).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  });

  it("schema has NO is_visible column — visibility is derived, never stored (ADR-025 §2.2)", () => {
    // The word may appear in prose comments (already stripped above). In code it must not.
    expect(schemaCode).not.toMatch(/is_visible/);
    expect(schemaCode).not.toMatch(/is_public/);
  });

  it("index carries state columns so visibility is derived at read time (ADR-025 §2.2)", () => {
    expect(schemaCode).toMatch(/store_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/product_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/moderation_state\s+TEXT\s+NOT NULL/);
    expect(schemaCode).toMatch(/quantity_on_hand\s+INTEGER\s+NOT NULL/);
  });

  it("index uses category_slug from the catalog port, not a fabricated category_id", () => {
    expect(schemaCode).toMatch(/category_slug\s+TEXT\s+NOT NULL/);
    expect(schemaCode).not.toMatch(/category_id/);
  });

  it("index uses sku (catalog identity), not a fabricated product_slug", () => {
    expect(schemaCode).toMatch(/\bsku\s+TEXT\s+NOT NULL/);
    expect(schemaCode).not.toMatch(/product_slug/);
  });

  it("schema declares projection state tables owned by search (ADR-025 §2.3)", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_marketplace_store_state/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_marketplace_product_state/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_relay_consumed_events/);
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_relay_checkpoint/);
  });

  it("relay state columns enforce a closed status set for idempotency and dead-letter", () => {
    expect(schemaCode).toMatch(/CHECK \(status IN \('pending','applied','skipped','skipped_stale','ignored','poisoned'\)\)/);
    expect(schemaCode).toMatch(/attempt_count\s+INTEGER\s+NOT NULL DEFAULT 0/);
  });

  it("schema uses integer halalas for price, not floating point (ADR-016 decision 4)", () => {
    expect(schemaCode).toMatch(/price_minor_units\s+INTEGER/);
    expect(schemaCode).toMatch(/currency_code\s+TEXT\s+NOT NULL CHECK \(currency_code = 'SAR'\)/);
  });

  it("api declares the search endpoint and health check", () => {
    expect(api).toMatch(/\/search\/products/);
    expect(api).toMatch(/\/search\/health/);
    expect(api).toMatch(/operationId: searchProducts/);
  });

  it("api result exposes sku and category_slug (catalog port identity, not fabricated ids)", () => {
    expect(api).toMatch(/sku:/);
    expect(api).toMatch(/category_slug:/);
    expect(api).not.toMatch(/category_id:/);
    expect(api).not.toMatch(/product_slug:/);
  });

  it("api price is integer halalas (catalog datum, not a transaction)", () => {
    expect(api).toMatch(/price_minor_units:/);
    expect(api).toMatch(/currency_code:\s*\{ type: string, const: SAR \}/);
  });

  it("events contract is a valid JSON Schema with versioned envelopes", () => {
    const e = events as { $schema?: string; $defs?: Record<string, unknown> };
    expect(e.$schema).toMatch(/json-schema/);
    expect(e.$defs?.EventEnvelope).toBeDefined();
    expect(e.$defs?.SearchIndexRebuiltV1).toBeDefined();
    expect(e.$defs?.SearchIndexDegradedV1).toBeDefined();
  });

  it("events producer is search-service (not marketplace — those are consumed, not produced)", () => {
    const e = events as { $defs?: { EventEnvelope?: { properties?: { producer?: { const?: string } } } } };
    expect(e.$defs?.EventEnvelope?.properties?.producer?.const).toBe("search-service");
  });
});

// ── G-S9.7 · CLM-0649 · ADR-025 §6: GET /search/stores ────────────────────
import {
  STORE_SEARCH_LIMITS,
  STORE_SEARCH_LOCALES,
  STORE_SEARCH_QUERY_KEYS,
  STORE_SEARCH_RESULT_FIELDS,
} from "../store-search.js";

/** The OpenAPI text block of one top-level path (until the next path key). */
function pathBlock(path: string): string {
  const start = api.indexOf(`\n  ${path}:\n`);
  if (start < 0) return "";
  const rest = api.slice(start + 1);
  const next = rest.slice(1).search(/\n  \/[^\n]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function schemaBlock(name: string): string {
  const start = api.indexOf(`\n    ${name}:\n`);
  if (start < 0) return "";
  const rest = api.slice(start + 1);
  const next = rest.slice(1).search(/\n    [A-Za-z]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("search contracts — store-name search (G-S9.7 · ADR-025 §6)", () => {
  const block = pathBlock("/search/stores");

  it("api declares GET /search/stores with operationId searchStores and its own scope", () => {
    expect(block).toMatch(/operationId: searchStores/);
    expect(block).toMatch(/ServiceAuth: \['search:stores:read'\]/);
  });

  it("declares exactly the query keys the constants list — no state/owner filter", () => {
    const names = [...block.matchAll(/- name: (\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([...STORE_SEARCH_QUERY_KEYS]);
    expect(block).not.toMatch(/owner_public_id|store_state|name: state/);
  });

  it("q / page / page_size bounds match the shared constants", () => {
    expect(block).toMatch(new RegExp(`minLength: ${STORE_SEARCH_LIMITS.qMinLength}\\n\\s+maxLength: ${STORE_SEARCH_LIMITS.qMaxLength}`));
    expect(block).toMatch(new RegExp(`maximum: ${STORE_SEARCH_LIMITS.pageMax}\\n\\s+default: 1`));
    expect(block).toMatch(new RegExp(`maximum: ${STORE_SEARCH_LIMITS.pageSizeMax}\\n\\s+default: ${STORE_SEARCH_LIMITS.pageSizeDefault}`));
  });

  it("locale enum is ar/en/ur, default ar", () => {
    const loc = schemaBlock("StoreSearchLocale");
    expect(loc).toMatch(new RegExp(`enum: \\[${STORE_SEARCH_LOCALES.join(", ")}\\]`));
    expect(loc).toMatch(/default: ar/);
  });

  it("the public result is exactly store_slug/title/category_slug — closed to extra fields", () => {
    const res = schemaBlock("StoreSearchResult");
    expect(res).toMatch(/additionalProperties: false/);
    expect(res).toMatch(new RegExp(`required: \\[${STORE_SEARCH_RESULT_FIELDS.join(", ")}\\]`));
    const props = [...res.matchAll(/^ {8}(\w+): \{/gm)].map((m) => m[1]);
    expect(props).toEqual([...STORE_SEARCH_RESULT_FIELDS]);
    expect(res).not.toMatch(/^\s+owner_public_id:/m);
  });

  it("the page wrapper is closed too", () => {
    expect(schemaBlock("StoreSearchPage")).toMatch(/additionalProperties: false/);
  });

  it("schema has the derived store-name table and still no visibility flag", () => {
    expect(schemaCode).toMatch(/CREATE TABLE IF NOT EXISTS search_store_index/);
    const table = schemaCode.slice(schemaCode.indexOf("CREATE TABLE IF NOT EXISTS search_store_index"));
    const body = table.slice(0, table.indexOf(");"));
    expect(body).not.toMatch(/owner_public_id|is_visible|is_public|store_state|reviewed_at|staff/);
    expect(body).toMatch(/title_ar\s+TEXT\s+NOT NULL/);
    expect(body).toMatch(/title_en\s+TEXT/);
    expect(body).toMatch(/title_ur\s+TEXT/);
  });
});
