/**
 * HTTP adapter for `IdentityDeletionPort` (CLM-0701 · استثناءُ ADR-076).
 *
 * نداءانِ فقط على حدِّ الهويّةِ، بالصلاحياتِ الدنيا التي يحتاجُها كلٌّ منهما:
 *
 *   `GET /identity/core-bindings/{coreIdentityId}` (identity:core-binding:read)
 *     200 → جيلٌّ مربوطٌ بهويّةِ MARKET (نقرأُ `wasla_public_id`)
 *     404 → غيرُ مربوطٍ (null — قابلٌ للإعادةِ عندَ المستهلِكِ)
 *
 *   `POST /identity/core-deletion` (identity:core-deletion:write)
 *     200 → جوابُ التطبيقِ كما هو
 *
 * خارجُ ذلك (شبكةٌ/مهلةٌ/تدهورٌ) يُرمى `CUSTOMER_INTERNAL_ERROR` — فانقطاعُ
 * الهويّةِ لا يُقرأُ «جيلٌ غيرُ مربوطٍ» لأنّ ذلكَ كانَ سيُفقِدُ الحدثَ إلى الأبدِ.
 * يستعملُ `fetch` العامَّ (Node 20+) — لا تبعيّةَ HTTPَ جديدة.
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { CustomerError } from "../domain/errors.js";
import type {
  ApplyCoreDeletionOutcome,
  CoreIdentityBindingSummary,
  IdentityDeletionPort,
} from "../ports.js";

/** المسار المنشور — المُعرّف جزءٌ من المسارِ لا من سلسلة الاستفسار. */
export const IDENTITY_CORE_BINDING_PATH_PREFIX = "/identity/core-bindings/";

/** الصلاحيتانِ اللتانِ يحتاجُهما هذا العميلُ على حدِّ الهويّةِ — ولا ثالثَ. */
export const CUSTOMERS_IDENTITY_DELETION_SCOPES: readonly string[] = [
  "identity:core-binding:read",
  "identity:core-deletion:write",
];

export interface HttpIdentityDeletionOptions {
  /** Base URL of the identity service, e.g. http://identity:8080 */
  baseUrl: string;
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
  /** موقّعُ النداءِ الصادر — إلزاميٌّ بلا قيمةٍ افتراضيّةٍ (M1-04). */
  readonly signRequest: ServiceRequestSigner;
}

export class HttpIdentityDeletionPort implements IdentityDeletionPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly signRequest: ServiceRequestSigner;

  constructor(options: HttpIdentityDeletionOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.signRequest = options.signRequest;
  }

  async findCoreBinding(
    coreIdentityId: string,
  ): Promise<CoreIdentityBindingSummary | null> {
    const path = `${IDENTITY_CORE_BINDING_PATH_PREFIX}${encodeURIComponent(coreIdentityId)}`;
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...this.signRequest("GET", path) },
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (response.status !== 200) {
        throw new CustomerError(
          "CUSTOMER_INTERNAL_ERROR",
          `فشل قراءة ربط جيل النواة بحالة ${response.status}`,
        );
      }
      const body = (await response.json()) as { wasla_public_id?: unknown };
      if (typeof body?.wasla_public_id !== "string") {
        throw new CustomerError(
          "CUSTOMER_INTERNAL_ERROR",
          "ردُّ ربطِ الجيلِ بلا wasla_public_id",
        );
      }
      return { waslaPublicId: body.wasla_public_id };
    } catch (error) {
      if (error instanceof CustomerError) throw error;
      throw new CustomerError(
        "CUSTOMER_INTERNAL_ERROR",
        `خدمة الهوية غير متاحة: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async applyCoreDeletion(input: {
    readonly coreIdentityId: string;
    readonly deletedAt?: string;
  }): Promise<ApplyCoreDeletionOutcome> {
    const path = "/identity/core-deletion";
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...this.signRequest("POST", path),
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          core_identity_id: input.coreIdentityId,
          ...(input.deletedAt === undefined
            ? {}
            : { deleted_at: input.deletedAt }),
        }),
      });
      if (response.status !== 200) {
        throw new CustomerError(
          "CUSTOMER_INTERNAL_ERROR",
          `فشل تطبيق حذف جيل النواة بحالة ${response.status}`,
        );
      }
      const body = (await response.json()) as {
        applied?: unknown;
        wasla_public_id?: unknown;
        reason?: unknown;
      };
      return {
        applied: body?.applied === true,
        waslaPublicId: typeof body?.wasla_public_id === "string" ? body.wasla_public_id : "",
        ...(typeof body?.reason === "string" ? { reason: body.reason } : {}),
      };
    } catch (error) {
      if (error instanceof CustomerError) throw error;
      throw new CustomerError(
        "CUSTOMER_INTERNAL_ERROR",
        `خدمة الهوية غير متاحة: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
