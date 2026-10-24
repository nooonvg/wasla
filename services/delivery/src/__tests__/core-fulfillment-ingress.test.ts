/**
 * اختباراتُ تصنيفِ وإسقاطِ أحداثِ إغلاقِ التنفيذِ من CORE (XR-3.5 · المراجعةُ 7).
 *
 * **العقدُ هو المرجعُ لا النمطُ اليدويُّ:** الاختبارُ يقرأُ المخططاتِ
 * المنقولةَ في `docs/contracts/core/` نفسَها ويطابقُ قيَمَ المصنِّفِ والإسقاطِ
 * معها — فإن اتّسعَ العقدُ في wasla-core يومًا وضاقَ هذا المصنِّفُ عنهُ فقدَ
 * الحارسُ (نمطُ RISK-0035: المُنتِجُ مصدرُ الحقيقةِ والمستهلِكُ الأضيقُ
 * يُسقِطُ).
 *
 * الإسقاطُ يُختبرُ ضدَّ آلةِ الحالةِ القائمةِ (`state-machine.ts`) — لا حافّةَ
 * تُفتَحُ للتكاملِ، وكلُّ رفضٍ مسمّى.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  classifyCoreFulfillmentEvent,
  CoreFulfillmentPayloadError,
  CORE_FULFILLMENT_EVENT_TYPES,
  type CoreEnvelopeInput,
} from "../domain/core-fulfillment-events.js";
import {
  projectCoreFulfillmentEvent,
  proofSatisfied,
} from "../domain/core-fulfillment-projection.js";
import { FULFILLMENT_TRANSITIONS } from "../domain/state-machine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, "../../../..", "docs", "contracts", "core");

const envelopeSchema = JSON.parse(
  readFileSync(resolve(contractsDir, "envelope.schema.json"), "utf8"),
) as { properties: Record<string, { pattern?: string; minLength?: number }> };
const completedSchema = JSON.parse(
  readFileSync(resolve(contractsDir, "core.fulfillment.completed.v1.schema.json"), "utf8"),
) as { properties: Record<string, Record<string, unknown>> };

const ORGANIZATION = "e83f50cc-5808-4873-b58a-722cc3f58070";
const FULFILLMENT = "7f2c9e46-1111-4b22-8c33-0d1e2f3a4b5c";
const ORDER = "WS-0000000001";

function envelope(
  event_type: string,
  payload: Record<string, unknown>,
): CoreEnvelopeInput {
  return {
    event_id: "01234567-89ab-4cde-8f01-23456789abcd",
    event_type,
    version: 1,
    producer: "wasla-core",
    occurred_at: "2026-10-22T08:00:00.000Z",
    correlation_id: "12345678-90ab-4cde-8f01-23456789abce",
    causation_id: null,
    entity_type: "fulfillment",
    entity_id: FULFILLMENT,
    payload,
  };
}

function basePayload(): Record<string, unknown> {
  return {
    fulfillment_id: FULFILLMENT,
    organization_id: ORGANIZATION,
    order_reference: ORDER,
  };
}

describe("classifyCoreFulfillmentEvent — العقدُ هو المرجعُ", () => {
  it("الأنواعُ الخمسةُ المعلنةُ هيَ بلاً منَ عقدِ الإغلاقِ لا أكثرَ", () => {
    // مخططُ المغلّفِ يقيّدُ event_type بنمطِ `core.fulfillment.*` — والأنواعُ
    // الخمسةُ هيَ ما تُعلنُهُ مخططاتُ الحمولةِ المنقولةُ.
    const pattern = new RegExp(String(envelopeSchema.properties.event_type.pattern));
    for (const type of CORE_FULFILLMENT_EVENT_TYPES) {
      expect(pattern.test(type)).toBe(true);
    }
    expect(CORE_FULFILLMENT_EVENT_TYPES).toHaveLength(5);
  });

  it("يصنّفُ الحدثَ المكتملَ بحمولةٍ كاملةٍ مطابقةً للعقدِ", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.completed", {
        ...basePayload(),
        outcome: "completed",
        completed_at: "2026-10-22T08:30:00.000Z",
        reason: null,
        settlement_state: "captured",
        captured_minor: 1500,
        financial_decision_required: false,
      }),
    );
    expect(event.kind).toBe("core.fulfillment.completed");
    if (event.kind !== "core.fulfillment.completed") throw new Error("narrowing");
    expect(event.payload.order_reference).toBe(ORDER);
    expect(event.payload.outcome).toBe("completed");
  });

  it("outcome لا يقبلُ إلا completed/failed كما يُعلنُ العقدُ", () => {
    const outcomeSchema = completedSchema.properties["outcome"]!;
    expect(outcomeSchema).toMatchObject({ enum: ["completed", "failed"] });
    expect(() =>
      classifyCoreFulfillmentEvent(
        envelope("core.fulfillment.completed", {
          ...basePayload(),
          outcome: "half_done",
          completed_at: "2026-10-22T08:30:00.000Z",
          settlement_state: "none",
          captured_minor: null,
          financial_decision_required: false,
        }),
      ),
    ).toThrow(CoreFulfillmentPayloadError);
  });

  it("executed_after_cancellation يُلزِمُ financial_decision_required=true (العقدُ: Always true)", () => {
    const ok = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.executed_after_cancellation", {
        ...basePayload(),
        job_id: "job-9",
        executed_at: "2026-10-22T09:00:00.000Z",
        cancelled_at: "2026-10-22T07:00:00.000Z",
        cancellation_reason: "customer_changed_mind",
        settlement_state: "captured",
        financial_decision_required: true,
      }),
    );
    expect(ok.kind).toBe("core.fulfillment.executed_after_cancellation");
    expect(() =>
      classifyCoreFulfillmentEvent(
        envelope("core.fulfillment.executed_after_cancellation", {
          ...basePayload(),
          job_id: "job-9",
          executed_at: "2026-10-22T09:00:00.000Z",
          cancelled_at: "2026-10-22T07:00:00.000Z",
          settlement_state: "none",
          financial_decision_required: false,
        }),
      ),
    ).toThrow(CoreFulfillmentPayloadError);
  });

  it("يرفضُ الإصدارَ غيرَ 1 والمنتجَ الأجنبيَّ والنوعَ السادسَ — كلَّها باسمٍ", () => {
    const v2 = envelope("core.fulfillment.created", {
      ...basePayload(),
      requested_service: "delivery",
    });
    expect(() => classifyCoreFulfillmentEvent({ ...v2, version: 2 })).toThrow(
      /unsupported_version/,
    );
    expect(() => classifyCoreFulfillmentEvent({ ...v2, producer: "wasla-move" })).toThrow(
      /foreign_producer/,
    );
    expect(() =>
      classifyCoreFulfillmentEvent(
        envelope("core.fulfillment.sixth_kind", { ...basePayload() }),
      ),
    ).toThrow(/unknown_event_type/);
  });

  it("يرفضُ مرجعَ طلبٍ خارجَ نمطِ WS- والحقولَ الناقصةَ — سمٌّ مسمّى", () => {
    expect(() =>
      classifyCoreFulfillmentEvent(
        envelope("core.fulfillment.created", {
          ...basePayload(),
          order_reference: "ORDER-1",
          requested_service: "delivery",
        }),
      ),
    ).toThrow(/invalid_order_reference/);
    expect(() =>
      classifyCoreFulfillmentEvent(
        envelope("core.fulfillment.dispatched", {
          ...basePayload(),
          job_reference: "job-1",
        }),
      ),
    ).toThrow(/missing_required_field/);
  });
});

describe("المصنِّفُ يتبعُ إلزامَ العقدِ حرفًا — كلُّ حقلٍ مطلوبٍ في المخططِ حاضرٌ في المصنِّف", () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
    [
      "core.fulfillment.created",
      { ...basePayload(), requested_service: "delivery" },
    ],
    [
      "core.fulfillment.dispatched",
      {
        ...basePayload(),
        job_reference: "job-1",
        dispatched_at: "2026-10-22T08:10:00.000Z",
      },
    ],
    [
      "core.fulfillment.completed",
      {
        ...basePayload(),
        outcome: "completed",
        completed_at: "2026-10-22T08:30:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      },
    ],
    [
      "core.fulfillment.cancelled",
      {
        ...basePayload(),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T07:30:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      },
    ],
    [
      "core.fulfillment.executed_after_cancellation",
      {
        ...basePayload(),
        job_id: "job-9",
        executed_at: "2026-10-22T09:00:00.000Z",
        cancelled_at: "2026-10-22T07:00:00.000Z",
        settlement_state: "none",
        financial_decision_required: true,
      },
    ],
  ];

  it("حذفُ أيِّ حقلٍ يُعلنُهُ المخططُ required يُسقِطُ المصنِّفَ — المخططُ يقودُ لا اليدُ", () => {
    for (const [type, payload] of cases) {
      const schema = JSON.parse(
        readFileSync(resolve(contractsDir, `${type}.v1.schema.json`), "utf8"),
      ) as { required: string[] };
      for (const field of schema.required) {
        const gutted = { ...payload };
        delete gutted[field];
        expect(() => classifyCoreFulfillmentEvent(envelope(type, gutted))).toThrow(
          CoreFulfillmentPayloadError,
        );
      }
      // والحمولةُ الكاملةُ تمرُّ — الحارسَ لا يُبالِغُ في الرفضِ.
      expect(() => classifyCoreFulfillmentEvent(envelope(type, payload))).not.toThrow();
    }
  });
});

describe("projectCoreFulfillmentEvent — الخريطةُ خاضعةٌ لآلةِ الحالةِ", () => {
  it("created ملاحظةٌ لا انتقالَ", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.created", {
        ...basePayload(),
        requested_service: "delivery",
      }),
    );
    expect(projectCoreFulfillmentEvent(event, "placed")).toEqual({
      kind: "observed",
      note: "core_accepted_fulfillment",
    });
  });

  it("dispatched يُثبِتُ الإسنادَ لا الاستلامَ: ينتقلُ إلى assigned من ready_for_delivery فقط (D-XR-31 · §4.29)", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.dispatched", {
        ...basePayload(),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T08:10:00.000Z",
      }),
    );
    expect(projectCoreFulfillmentEvent(event, "ready_for_delivery")).toEqual({
      kind: "transition",
      to: "assigned",
      requiresProof: false,
    });
    // الحافةُ موجودةٌ فعلًا في آلةِ الحالةِ — لا حافّةَ جديدةً للتكاملِ.
    expect(
      FULFILLMENT_TRANSITIONS.some(
        (t) =>
          t.from === "ready_for_delivery" &&
          t.to === "assigned",
      ),
    ).toBe(true);
    expect(projectCoreFulfillmentEvent(event, "placed").kind).toBe("out_of_order");
  });

  it("الإسنادُ لا يُنتجُ handed_to_courier أبدًا: dispatched على طلبٍ في handed_to_courier = out_of_order لا تراجعَ ولا تقدّمَ (§4.29)", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.dispatched", {
        ...basePayload(),
        job_reference: "move-job-1",
        dispatched_at: "2026-10-22T08:10:00.000Z",
      }),
    );
    // طلبٌ في handed_to_courier (المسارُ المحليُّ القديمُ أو بياناتٌ سابقةٌ
    // للرقعةِ): الحدثُ لا يُنقلُهُ ولا يُتراجِعُ بهِ — مسمّىً لا صامتًا.
    expect(projectCoreFulfillmentEvent(event, "handed_to_courier")).toMatchObject({
      kind: "out_of_order",
      to: "assigned",
    });
  });

  it("completed بالتسليمِ ينتقلُ إلى delivered من assigned أو handed_to_courier، وبإثباتٍ", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.completed", {
        ...basePayload(),
        outcome: "completed",
        completed_at: "2026-10-22T08:30:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(projectCoreFulfillmentEvent(event, "handed_to_courier")).toEqual({
      kind: "transition",
      to: "delivered",
      requiresProof: true,
    });
    expect(projectCoreFulfillmentEvent(event, "assigned")).toEqual({
      kind: "transition",
      to: "delivered",
      requiresProof: true,
    });
    expect(projectCoreFulfillmentEvent(event, "ready_for_delivery").kind).toBe("out_of_order");
  });

  it("completed بالفشلِ ينتقلُ إلى failed من assigned أو handed_to_courier", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.completed", {
        ...basePayload(),
        outcome: "failed",
        completed_at: "2026-10-22T08:30:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    expect(projectCoreFulfillmentEvent(event, "handed_to_courier")).toEqual({
      kind: "transition",
      to: "failed",
      requiresProof: false,
    });
    expect(projectCoreFulfillmentEvent(event, "assigned")).toEqual({
      kind: "transition",
      to: "failed",
      requiresProof: false,
    });
    expect(projectCoreFulfillmentEvent(event, "placed").kind).toBe("out_of_order");
  });

  it("cancelled ينتقلُ إلى cancelled من حالاتِ العميلِ القابلةِ للإلغاءِ وحدَها", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.cancelled", {
        ...basePayload(),
        reason: "customer_changed_mind",
        cancelled_at: "2026-10-22T07:30:00.000Z",
        settlement_state: "none",
        captured_minor: null,
        financial_decision_required: false,
      }),
    );
    for (const from of ["placed", "confirmed", "ready_for_delivery", "assigned"] as const) {
      expect(projectCoreFulfillmentEvent(event, from)).toEqual({
        kind: "transition",
        to: "cancelled",
        requiresProof: false,
      });
    }
    // «آخرُ نقطةٍ يملكُ فيها العميلُ قرارَهُ» — فما بعدَها خارجُ الترتيبِ مسمّى.
    // `assigned` مضافةٌ (§4.29): CORE يُغلقُ بالإلغاءِ من كافّةِ الحالاتِ المفتوحةِ
    // (dispatched منها) — استقبالُ قرارِهِ ليسَ منحًا للعميلِ صلاحيّةَ الإلغاءِ.
    for (const from of ["picking", "picked", "handed_to_courier"] as const) {
      expect(projectCoreFulfillmentEvent(event, from).kind).toBe("out_of_order");
    }
  });

  it("executed_after_cancellation لا يحرِّكُ الحالةَ — رايةٌ ماليّةٌ لا حُكمٌ هنا (XR-4.4)", () => {
    const event = classifyCoreFulfillmentEvent(
      envelope("core.fulfillment.executed_after_cancellation", {
        ...basePayload(),
        job_id: "job-9",
        executed_at: "2026-10-22T09:00:00.000Z",
        cancelled_at: "2026-10-22T07:00:00.000Z",
        cancellation_reason: null,
        settlement_state: "captured",
        financial_decision_required: true,
      }),
    );
    expect(projectCoreFulfillmentEvent(event, "cancelled")).toEqual({
      kind: "observed",
      note: "executed_after_cancellation_financial_decision_required",
    });
  });
});

describe("بوّابةُ الإثباتِ", () => {
  it("delivered بلا إثباتٍ غيرُ مُرضىٍ — وغيرُهُ مُرضىٍ بلا إثباتٍ", () => {
    const delivered = { kind: "transition", to: "delivered", requiresProof: true } as const;
    const assigned = { kind: "transition", to: "assigned", requiresProof: false } as const;
    expect(proofSatisfied(delivered, false)).toBe(false);
    expect(proofSatisfied(delivered, true)).toBe(true);
    expect(proofSatisfied(assigned, false)).toBe(true);
  });
});
