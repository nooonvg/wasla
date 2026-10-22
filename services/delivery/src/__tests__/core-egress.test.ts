/**
 * اختباراتُ محوّلِ الخروجِ إلى مغلّفِ CORE (XR-3.4 · الخارطةُ المشتركةُ · المراجعةُ 7).
 *
 * المرجعُ الحاكمُ هنا **العقدُ المنقولُ نفسُه** (`docs/contracts/core/`)، لا نمطٌ
 * مكتوبٌ بيدٍ في الاختبارِ: يُقرأُ `envelope.schema.json` و`market.order.created.v1.
 * schema.json` ويُطابَقُ ناتجُ المحوّلِ مع ما يُجيزانِه حرفًا (الحقولُ المطلوبةُ،
 * الأنواعُ، `additionalProperties: false`، `minLength`، `pattern`). فإن اتّسعَ
 * العقدُ يومًا فلن يُكسِرَ الاختبارَ — وإن ضاقَ عن ناتجِ المحوّلِ فقدَ الحارسُ.
 *
 * وما لا يُختبرُ هنا: التطابقُ البايتيُّ معَ `wasla-core@main` — ذاكَ فحصُ
 * `scripts/checks/check-core-contract-parity.mjs` في CI (`.github/workflows/
 * core-contract-parity.yml`)، لا اختبارُ وحدةٍ يحتاجُ شبكةً.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  marketOrderCreatedForCore,
  type MarketOrderCreatedCoreEvent,
} from "../domain/core-egress.js";
import { storeOrderCreatedEvent, type EventContext } from "../domain/events.js";
import { fixedOrder } from "./store-order-fakes.js";

const ACTOR = { actor_type: "customer", actor_ref: "WS-0000000009" } as const;
const EVENT_CONTEXT: EventContext = {
  eventId: "11111111-2222-4333-8444-555555555555",
  occurredAt: "2026-10-22T01:02:03.000Z",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreContractsDir = resolve(__dirname, "../../../..", "docs", "contracts", "core");
const envelopeSchema = JSON.parse(
  readFileSync(resolve(coreContractsDir, "envelope.schema.json"), "utf8"),
) as {
  required: string[];
  properties: Record<string, { type?: string; minLength?: number; pattern?: string }>;
  additionalProperties: boolean;
};
const orderCreatedSchema = JSON.parse(
  readFileSync(resolve(coreContractsDir, "market.order.created.v1.schema.json"), "utf8"),
) as {
  required: string[];
  properties: Record<string, { type: string | string[]; minLength?: number; format?: string }>;
  additionalProperties: boolean;
};
const provenance = readFileSync(resolve(coreContractsDir, "PROVENANCE.md"), "utf8");

const ORGANIZATION_ID = "e83f50cc-5808-4873-b58a-722cc3f58070"; // مثال العقد نفسه.

function convertedEvent(traceId?: string): MarketOrderCreatedCoreEvent {
  const order = fixedOrder();
  const context: EventContext = traceId ? { ...EVENT_CONTEXT, traceId } : EVENT_CONTEXT;
  const local = storeOrderCreatedEvent(order, context, ACTOR);
  return marketOrderCreatedForCore(local, {
    organizationId: ORGANIZATION_ID,
    requestedService: "delivery",
    paymentAuthorizationId: null,
  });
}

describe("marketOrderCreatedForCore — مطابقةُ مغلّفِ CORE", () => {
  it("يحملُ كلَّ الحقولِ المطلوبةِ في مخططِ المغلّفِ", () => {
    const event = convertedEvent();
    for (const field of envelopeSchema.required) {
      expect(event, `missing required envelope field: ${field}`).toHaveProperty(field);
    }
  });

  it("لا يُضيفُ خاصيةً خارجَ المخططِ (additionalProperties: false)", () => {
    const event = convertedEvent();
    const allowed = new Set(Object.keys(envelopeSchema.properties));
    for (const key of Object.keys(event)) {
      expect(allowed.has(key), `unexpected envelope property: ${key}`).toBe(true);
    }
  });

  it("event_type يطابقُ نمطَ المخططِ ويُسمّي الحدثَ صحيحًا", () => {
    const event = convertedEvent();
    expect(event.event_type).toBe("market.order.created");
    expect(envelopeSchema.properties.event_type.pattern).toBeDefined();
    const pattern = new RegExp(String(envelopeSchema.properties.event_type.pattern));
    expect(pattern.test(event.event_type)).toBe(true);
  });

  it("version عددٌ وoccurred_at نصٌّ وproducer ثابتةُ MARKET", () => {
    const event = convertedEvent();
    expect(event.version).toBe(1);
    expect(typeof event.occurred_at).toBe("string");
    expect(event.occurred_at.length).toBeGreaterThanOrEqual(
      envelopeSchema.properties.occurred_at.minLength ?? 1,
    );
    expect(event.producer).toBe("wasla-market");
  });

  it("correlation_id من trace_id المحليِّ إن وُجدَ وإلا من event_id، ولا يكونُ فارغًا أبدًا", () => {
    const withTrace = convertedEvent("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(withTrace.correlation_id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const withoutTrace = convertedEvent();
    expect(withoutTrace.correlation_id).not.toBe("");
    expect(withoutTrace.correlation_id).toBe(withoutTrace.event_id);
  });

  it("causation_id فارغٌ (null): الوضعُ فعلٌ منشئٌ لا نتيجةُ حدثٍ سابقٍ", () => {
    expect(convertedEvent().causation_id).toBeNull();
  });

  it("event_id هو معرّفُ الحدثِ المحليِّ نفسُهُ — تحويلٌ لا توليدُ حادثةٍ", () => {
    const local = storeOrderCreatedEvent(fixedOrder(), EVENT_CONTEXT, ACTOR);
    const converted = marketOrderCreatedForCore(local, {
      organizationId: ORGANIZATION_ID,
      requestedService: "delivery",
      paymentAuthorizationId: null,
    });
    expect(converted.event_id).toBe(local.event_id);
  });

  it("entity_type/entity_id يشيرانِ إلى store_order ومعرّفِهِ (uuid)", () => {
    const order = fixedOrder();
    const converted = convertedEvent();
    expect(converted.entity_type).toBe("store_order");
    expect(converted.entity_id).toBe(order.orderId);
  });
});

describe("marketOrderCreatedForCore — مطابقةُ حمولةِ market.order.created", () => {
  it("الحمولةُ تحملُ الحقولَ المطلوبةَ كلَّها ولا تُضيفُ خارجَ المخططِ", () => {
    const converted = convertedEvent();
    for (const field of orderCreatedSchema.required) {
      expect(converted.payload, `missing required payload field: ${field}`).toHaveProperty(field);
    }
    const allowed = new Set(Object.keys(orderCreatedSchema.properties));
    for (const key of Object.keys(converted.payload)) {
      expect(allowed.has(key), `unexpected payload property: ${key}`).toBe(true);
    }
  });

  it("organization_id بصيغةِ uuid وrequested_service نصٌّ غيرُ فارغٍ", () => {
    const converted = convertedEvent();
    expect(converted.payload.organization_id).toBe(ORGANIZATION_ID);
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(converted.payload.organization_id),
      ),
    ).toBe(true);
    expect(converted.payload.requested_service).toBe("delivery");
  });

  it("order_id هو المعرّفُ العموميُّ WS-… المُعلَنُ", () => {
    const order = fixedOrder();
    const converted = convertedEvent();
    expect(converted.payload.order_id).toBe(order.publicId);
  });

  it("payment_authorization_id يقبلُ null (الساقُ الماليةُ معطّلةٌ) وقيمةً إن وُجدَت", () => {
    expect(convertedEvent().payload.payment_authorization_id).toBeNull();
    const local = storeOrderCreatedEvent(fixedOrder(), EVENT_CONTEXT, ACTOR);
    const withHold = marketOrderCreatedForCore(local, {
      organizationId: ORGANIZATION_ID,
      requestedService: "delivery",
      paymentAuthorizationId: randomUUID(),
    });
    expect(typeof withHold.payload.payment_authorization_id).toBe("string");
  });
});

describe("marketOrderCreatedForCore — رفضُ المدخلاتِ الفارغةِ", () => {
  it("يرفضُ organization_id فارغًا", () => {
    const local = storeOrderCreatedEvent(fixedOrder(), EVENT_CONTEXT, ACTOR);
    expect(() =>
      marketOrderCreatedForCore(local, {
        organizationId: "   ",
        requestedService: "delivery",
        paymentAuthorizationId: null,
      }),
    ).toThrow("organization_id");
  });

  it("يرفضُ requested_service فارغًا", () => {
    const local = storeOrderCreatedEvent(fixedOrder(), EVENT_CONTEXT, ACTOR);
    expect(() =>
      marketOrderCreatedForCore(local, {
        organizationId: ORGANIZATION_ID,
        requestedService: "",
        paymentAuthorizationId: null,
      }),
    ).toThrow("requested_service");
  });
});

describe("عقودُ CORE المنقولةُ (XR-3.6) — فحصٌ بنيويٌّ", () => {
  it("PROVENANCE يسجّلُ المستودعَ والمسارَ والملفاتِ السبعةَ", () => {
    expect(provenance).toContain("nooonvg/wasla-core");
    expect(provenance).toContain("contracts/events");
    for (const name of [
      "envelope.schema.json",
      "market.order.created.v1.schema.json",
      "core.fulfillment.created.v1.schema.json",
      "core.fulfillment.dispatched.v1.schema.json",
      "core.fulfillment.completed.v1.schema.json",
      "core.fulfillment.cancelled.v1.schema.json",
      "core.fulfillment.executed_after_cancellation.v1.schema.json",
    ]) {
      expect(provenance).toContain(name);
    }
  });

  it("المخططاتُ المنقولةُ تُلزِمُ additionalProperties: false — لا توسيعًا صامتًا", () => {
    expect(envelopeSchema.additionalProperties).toBe(false);
    expect(orderCreatedSchema.additionalProperties).toBe(false);
  });
});
