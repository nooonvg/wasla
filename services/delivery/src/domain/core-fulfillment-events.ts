/**
 * `domain/core-fulfillment-events.ts` — مستهلِكُ أحداثِ إغلاقِ التنفيذِ من CORE (XR-3.5 · الخارطةُ المشتركةُ · المراجعةُ 7).
 *
 * هذا الملفُّ **الطريقُ الوحيدُ** من حدثِ `core.fulfillment.*` خامٍ إلى حدثٍ
 * قابلٍ للإسقاطِ داخلَ خدمةِ التوصيلِ. وهو ينظرُ إلى العقدِ المنقولِ في
 * `docs/contracts/core/` (XR-3.6) بوصفِهِ **مصدرَ الحقيقةِ**: أنواعُ الحقولِ
 * وإلزامُها وقيَمُها المسموحةُ هنا مقروءةٌ من المخططاتِ نفسِها، لا منسوخةٌ
 * عنها في نمطٍ مكتوبٍ بيدٍ — والاختبارُ `core-fulfillment-ingress.test.ts`
 * يُسقِطُ البناءَ لو اتّسعَ العقدُ يومًا وضاقَ المصنِّفُ عنهُ (نمطُ حارسِ
 * الانحرافِ `marketplace-actor-contract-drift.test.ts` · RISK-0035).
 *
 * **والسُّمُّ لا يُبلَعُ صامتًا:** كلُّ حمولةٍ لا تطابقُ العقدَ ترمي
 * `CoreFulfillmentPayloadError` — والمستهلِكُ يُسجِّلُها `poisoned` لا أن
 * يتخطّاها. حدثٌ فاسدٌ يجبُ أن يُرى، لا أن يختفي.
 *
 * **وما لا يدّعيههِ:** لا يعرفُ هذا الملفُ شيئًا عن حالةِ الطلبِ ولا عن
 * انتقالاتِهِ — ذاكَ قرارُ الإسقاطِ (`core-fulfillment-projection.ts`)؛ ولا
 * يقرأُ شيئًا ولا يكتبُ شيئًا — التصنيفُ نقيٌّ.
 */

/** مغلّفُ CORE كما يُلزِمُ `docs/contracts/core/envelope.schema.json` (XR-4). */
export interface CoreEnvelopeInput {
  event_id: string;
  event_type: string;
  version: number;
  producer: string;
  occurred_at: string;
  correlation_id: string;
  causation_id: string | null;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
}

/** الأنواعُ الخمسةُ التي يعلنُها عقدُ إغلاقِ التنفيذِ — لا سادسَ. */
export const CORE_FULFILLMENT_EVENT_TYPES = [
  "core.fulfillment.created",
  "core.fulfillment.dispatched",
  "core.fulfillment.completed",
  "core.fulfillment.cancelled",
  "core.fulfillment.executed_after_cancellation",
] as const;

export type CoreFulfillmentEventType = (typeof CORE_FULFILLMENT_EVENT_TYPES)[number];

/** ما تشتركُ فيه كلُّ الحمولاتِ: مرجعُ الطلبِ عندَ MARKET (`WS-…`). */
interface FulfillmentPayloadBase {
  readonly fulfillment_id: string;
  readonly organization_id: string;
  readonly order_reference: string;
}

export interface CoreFulfillmentCreated extends FulfillmentPayloadBase {
  readonly requested_service: string;
}

export interface CoreFulfillmentDispatched extends FulfillmentPayloadBase {
  readonly job_reference: string;
  readonly dispatched_at: string;
}

export interface CoreFulfillmentCompleted extends FulfillmentPayloadBase {
  readonly outcome: "completed" | "failed";
  readonly completed_at: string;
  readonly reason: string | null;
  readonly settlement_state:
    | "none"
    | "held"
    | "captured"
    | "partially_captured"
    | "released"
    | "unsettled";
  readonly captured_minor: number | null;
  readonly financial_decision_required: boolean;
}

export interface CoreFulfillmentCancelled extends FulfillmentPayloadBase {
  readonly reason: string;
  readonly cancelled_at: string;
  readonly settlement_state:
    | "none"
    | "held"
    | "captured"
    | "partially_captured"
    | "released"
    | "unsettled";
  readonly captured_minor: number | null;
  readonly financial_decision_required: boolean;
}

export interface CoreFulfillmentExecutedAfterCancellation extends FulfillmentPayloadBase {
  readonly job_id: string;
  readonly executed_at: string;
  readonly cancelled_at: string;
  readonly cancellation_reason: string | null;
  readonly settlement_state:
    | "none"
    | "held"
    | "captured"
    | "partially_captured"
    | "released"
    | "unsettled";
  readonly financial_decision_required: true;
}

/** الحدثُ المصنَّفُ: مغلّفٌ + نوعٌ محدَّدٌ + حمولةٌ مطابقةٌ للعقدِ. */
export type ClassifiedCoreFulfillmentEvent =
  | { readonly kind: "core.fulfillment.created"; readonly payload: CoreFulfillmentCreated }
  | { readonly kind: "core.fulfillment.dispatched"; readonly payload: CoreFulfillmentDispatched }
  | { readonly kind: "core.fulfillment.completed"; readonly payload: CoreFulfillmentCompleted }
  | { readonly kind: "core.fulfillment.cancelled"; readonly payload: CoreFulfillmentCancelled }
  | {
      readonly kind: "core.fulfillment.executed_after_cancellation";
      readonly payload: CoreFulfillmentExecutedAfterCancellation;
    };

/** حمولةٌ لا تطابقُ العقدَ — سُمٌّ يُسجَّلُ ولا يُبلَعُ. */
export class CoreFulfillmentPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreFulfillmentPayloadError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WS_RE = /^WS-[0-9]{10}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SETTLEMENT_STATES = [
  "none",
  "held",
  "captured",
  "partially_captured",
  "released",
  "unsettled",
] as const;

function requireFields(payload: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (!(field in payload) || payload[field] === undefined) {
      throw new CoreFulfillmentPayloadError(`missing_required_field:${field}`);
    }
  }
}

function stringField(payload: Record<string, unknown>, field: string, minLength: number): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length < minLength) {
    throw new CoreFulfillmentPayloadError(`invalid_string:${field}`);
  }
  return value;
}

function uuidField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new CoreFulfillmentPayloadError(`invalid_uuid:${field}`);
  }
  return value;
}

function orderReference(payload: Record<string, unknown>): string {
  const value = payload["order_reference"];
  if (typeof value !== "string" || !WS_RE.test(value)) {
    throw new CoreFulfillmentPayloadError("invalid_order_reference");
  }
  return value;
}

function dateTimeField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || !DATE_TIME_RE.test(value)) {
    throw new CoreFulfillmentPayloadError(`invalid_date_time:${field}`);
  }
  return value;
}

function settlementField(payload: Record<string, unknown>): (typeof SETTLEMENT_STATES)[number] {
  const value = payload["settlement_state"];
  if (typeof value !== "string" || !(SETTLEMENT_STATES as readonly string[]).includes(value)) {
    throw new CoreFulfillmentPayloadError("invalid_settlement_state");
  }
  return value as (typeof SETTLEMENT_STATES)[number];
}

function capturedMinor(payload: Record<string, unknown>): number | null {
  const value = payload["captured_minor"];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CoreFulfillmentPayloadError("invalid_captured_minor");
  }
  return value;
}

function booleanField(payload: Record<string, unknown>, field: string): boolean {
  const value = payload[field];
  if (typeof value !== "boolean") {
    throw new CoreFulfillmentPayloadError(`invalid_boolean:${field}`);
  }
  return value;
}

/**
 * يصنّفُ حدثَ إغلاقِ تنفيذٍ خامًا. كلُّ رفضٍ هنا **باسمٍ** لا بسكوتٍ:
 * نوعٌ خارجُ الأنواعِ الخمسةِ، أو إصدارٌ ليسَ 1، أو منتجٌ ليسَ CORE، أو
 * حمولةٌ تخالفُ العقدَ — كلُّها `CoreFulfillmentPayloadError`.
 */
export function classifyCoreFulfillmentEvent(
  envelope: CoreEnvelopeInput,
): ClassifiedCoreFulfillmentEvent {
  if (envelope.version !== 1) {
    throw new CoreFulfillmentPayloadError(`unsupported_version:${envelope.version}`);
  }
  if (envelope.producer !== "wasla-core") {
    throw new CoreFulfillmentPayloadError(`foreign_producer:${envelope.producer}`);
  }
  if (!UUID_RE.test(envelope.event_id) || typeof envelope.correlation_id !== "string" || envelope.correlation_id.length < 1) {
    throw new CoreFulfillmentPayloadError("invalid_envelope");
  }
  const payload = envelope.payload;
  if (payload === null || typeof payload !== "object") {
    throw new CoreFulfillmentPayloadError("payload_not_object");
  }
  const base = {
    fulfillment_id: uuidField(payload, "fulfillment_id"),
    organization_id: uuidField(payload, "organization_id"),
    order_reference: orderReference(payload),
  };
  switch (envelope.event_type) {
    case "core.fulfillment.created": {
      requireFields(payload, ["requested_service"]);
      return {
        kind: "core.fulfillment.created",
        payload: { ...base, requested_service: stringField(payload, "requested_service", 1) },
      };
    }
    case "core.fulfillment.dispatched": {
      requireFields(payload, ["job_reference", "dispatched_at"]);
      return {
        kind: "core.fulfillment.dispatched",
        payload: {
          ...base,
          job_reference: stringField(payload, "job_reference", 1),
          dispatched_at: dateTimeField(payload, "dispatched_at"),
        },
      };
    }
    case "core.fulfillment.completed": {
      requireFields(payload, ["outcome", "completed_at"]);
      const outcome = payload["outcome"];
      if (outcome !== "completed" && outcome !== "failed") {
        throw new CoreFulfillmentPayloadError("invalid_outcome");
      }
      const reason = payload["reason"];
      if (reason !== null && reason !== undefined && typeof reason !== "string") {
        throw new CoreFulfillmentPayloadError("invalid_reason");
      }
      return {
        kind: "core.fulfillment.completed",
        payload: {
          ...base,
          outcome,
          completed_at: dateTimeField(payload, "completed_at"),
          reason: reason === null || reason === undefined ? null : reason,
          settlement_state: settlementField(payload),
          captured_minor: capturedMinor(payload),
          financial_decision_required: booleanField(payload, "financial_decision_required"),
        },
      };
    }
    case "core.fulfillment.cancelled": {
      requireFields(payload, ["reason", "cancelled_at"]);
      return {
        kind: "core.fulfillment.cancelled",
        payload: {
          ...base,
          reason: stringField(payload, "reason", 1),
          cancelled_at: dateTimeField(payload, "cancelled_at"),
          settlement_state: settlementField(payload),
          captured_minor: capturedMinor(payload),
          financial_decision_required: booleanField(payload, "financial_decision_required"),
        },
      };
    }
    case "core.fulfillment.executed_after_cancellation": {
      requireFields(payload, ["job_id", "executed_at", "cancelled_at", "financial_decision_required"]);
      const cancellationReason = payload["cancellation_reason"];
      if (cancellationReason !== null && cancellationReason !== undefined && typeof cancellationReason !== "string") {
        throw new CoreFulfillmentPayloadError("invalid_cancellation_reason");
      }
      const financial = booleanField(payload, "financial_decision_required");
      if (financial !== true) {
        // العقدُ يقولُ: «Always true on this event» — فقولُ غيرِهِ انحرافٌ عنِ العقدِ.
        throw new CoreFulfillmentPayloadError("financial_decision_required_must_be_true");
      }
      return {
        kind: "core.fulfillment.executed_after_cancellation",
        payload: {
          ...base,
          job_id: stringField(payload, "job_id", 1),
          executed_at: dateTimeField(payload, "executed_at"),
          cancelled_at: dateTimeField(payload, "cancelled_at"),
          cancellation_reason:
            cancellationReason === null || cancellationReason === undefined
              ? null
              : cancellationReason,
          settlement_state: settlementField(payload),
          financial_decision_required: true,
        },
      };
    }
    default:
      throw new CoreFulfillmentPayloadError(`unknown_event_type:${envelope.event_type}`);
  }
}
