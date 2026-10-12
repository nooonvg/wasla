/**
 * The HTTP adapter for `DispatchJobPort` (D-03 · M5-13D).
 *
 * It calls the dispatch service's `POST /dispatch/jobs` (port 8086) and returns
 * the created (or idempotently replayed) job. It mirrors `http-order-intake.ts`
 * on purpose: both are cross-service handovers with the same fail-closed
 * contract, and a reviewer of one must recognize the other.
 *
 * The dispatch contract is `additionalProperties: false` on the request body,
 * so this file must send exactly `order_id`, `order_public_id`, `zone_id`,
 * `order_type` and `vehicle_class`, and nothing else. `Idempotency-Key` is a
 * header, not a body field, and is required (§43).
 *
 * A `200` is a replay: the key and payload matched, the job already existed. It
 * is success, not a conflict, and the caller treats it identically to `201`.
 */

import { DispatchJobFailure } from "../domain/errors.js";
import type {
  CreateDispatchJobInput,
  DispatchJobPort,
  DispatchJobResultOutput,
} from "../ports.js";
import type { ServiceRequestSigner } from "@wasla/service-auth";

export const DISPATCH_JOBS_PATH = "/dispatch/jobs";

/** الصلاحيّاتُ التي يحتاجُها هذا المُنادي على حدّ المهامّ، لا أكثر. */
export const CUSTOMERS_DISPATCH_SCOPES: readonly string[] = ["dispatch:job:write"];

interface DispatchJobResponseBody {
  id?: unknown;
  order_id?: unknown;
  order_public_id?: unknown;
  zone_id?: unknown;
  order_type?: unknown;
  vehicle_class?: unknown;
  status?: unknown;
  code?: unknown;
}

export interface HttpDispatchJobOptions {
  /** Base URL of the dispatch service, e.g. http://dispatch:8086 */
  readonly baseUrl: string;
  /**
   * موقّعُ النداءِ الصادر. **إلزاميّ بلا قيمةٍ افتراضيةٍ بقصدٍ** (M1-04): القيمةُ
   * الافتراضيّةُ «بلا توقيعٍ» كانت ستَجعلُ نداءً يُنسى توقيعُهُ يَنجَحُ في كلّ
   * اختبارٍ ويُرَدُّ 401 في الإنتاجِ وحدَهُ، وهوَ أسوأُ موضعٍ لاكتشافِ نسيانٍ.
   */
  readonly signRequest: ServiceRequestSigner;
  readonly timeoutMs?: number;
}

export class HttpDispatchJobPort implements DispatchJobPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpDispatchJobOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async createDispatchJob(
    input: CreateDispatchJobInput,
    context: { readonly traceId?: string } = {},
  ): Promise<DispatchJobResultOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${DISPATCH_JOBS_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // §43: required on every write, and a retry is a network fact.
          "idempotency-key": input.idempotencyKey,
          // الرمز مربوط بهذه الطريقة وهذا المسار ويُحرق عند أول استعمال.
          ...this.signRequest("POST", DISPATCH_JOBS_PATH, input.orderPublicId),
          ...(context.traceId === undefined
            ? {}
            : { "x-request-id": context.traceId }),
        },
        body: JSON.stringify({
          order_id: input.orderId,
          order_public_id: input.orderPublicId,
          zone_id: input.zoneId,
          order_type: input.orderType,
          vehicle_class: input.vehicleClass,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new DispatchJobFailure(
        "CUSTOMER_DISPATCH_JOB_UNAVAILABLE",
        `تعذّر الوصول إلى خدمة التوزيع: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 200 || response.status === 201) {
      return await readDispatchJob(response);
    }

    if (response.status === 409) {
      // The key was used with a different payload — a bug, not a retry.
      throw new DispatchJobFailure(
        "CUSTOMER_DISPATCH_JOB_KEY_REUSED",
        "مفتاح مهمة التوزيع مُستخدم بحمولة مختلفة",
      );
    }

    if (response.status === 422) {
      throw new DispatchJobFailure(
        "CUSTOMER_DISPATCH_JOB_REJECTED",
        "رفضت خدمة التوزيع فتح المهمة",
      );
    }

    if (response.status === 503) {
      throw new DispatchJobFailure(
        "CUSTOMER_DISPATCH_JOB_UNAVAILABLE",
        "خدمة التوزيع أو منفذها غير متاح",
      );
    }

    throw new DispatchJobFailure(
      "CUSTOMER_DISPATCH_JOB_UNAVAILABLE",
      `فشل فتح مهمة التوزيع بحالة HTTP ${response.status}`,
    );
  }
}

const DISPATCH_JOB_STATUS_VALUES: readonly string[] = [
  "pending",
  "dispatching",
  "escalated_community",
  "assigned",
  "exhausted",
  "cancelled",
];

/** Reads and validates a `DispatchJob` body, rejecting anything that breaks the contract. */
async function readDispatchJob(response: Response): Promise<DispatchJobResultOutput> {
  const body = (await response.json()) as DispatchJobResponseBody | null;
  if (!body) {
    throw new DispatchJobFailure(
      "CUSTOMER_DISPATCH_JOB_REJECTED",
      "جواب خدمة التوزيع فارغ أو غير قابل للقراءة",
    );
  }
  const jobId = body.id;
  const orderPublicId = body.order_public_id;
  const status = body.status;

  if (
    typeof jobId !== "string" ||
    typeof orderPublicId !== "string" ||
    typeof status !== "string" ||
    !DISPATCH_JOB_STATUS_VALUES.includes(status)
  ) {
    throw new DispatchJobFailure(
      "CUSTOMER_DISPATCH_JOB_REJECTED",
      "جواب خدمة التوزيع لا يطابق عقدها",
    );
  }

  return {
    jobId,
    status: status as DispatchJobResultOutput["status"],
    orderPublicId,
  };
}
