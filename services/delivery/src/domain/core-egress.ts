/**
 * `domain/core-egress.ts` — محوّلُ الخروجِ إلى مغلّفِ CORE (XR-3.4 · الخارطةُ المشتركةُ).
 *
 * هذا الملفُّ **محوّلٌ نقيٌّ لا يُقرأُ شيئًا ولا يكتبُ شيئًا**: يأخذُ حدثَ
 * `store_order.created` المحليَّ (المغلّفُ المحليُّ: `event_version`/`aggregate` —
 * الحقيقةُ F-10) ويُخرِجُ الحدثَ نفسَهُ بمغلّفِ CORE (`version`/`correlation_id`/
 * `causation_id`/`entity_type`/`entity_id` — `envelope.schema.json`) وحمولةِ
 * `market.order.created.v1` كما يستهلكُها CORE. وهو مصدرُ الحقيقةِ الوحيدُ لهذا
 * التحويلِ في المستودعِ: لا يُكتبُ مغلّفُ CORE في أيِّ مكانٍ آخرَ بيدٍ.
 *
 * **ما لا يدّعيههِ:** التفعيلُ (إلحاقُ الحدثِ بالـoutbox عندَ الوضعِ) ما زال
 * خلفَ ربطِ `organization_id` — فالمتجرُ في MARKET اليومَ له `owner_public_id`
 * ولا يملكُ MARKETُ إسقاطَ «متجرٌ ← منظمةُ CORE» بعدُ (الحقيقةُ F-38 في
 * المراجعةِ 7). المحوّلُ جاهزٌ ومختبرٌ، والتفعيلُ خطوةٌ واحدةٌ بعدَ توافرِ
 * الإسقاطِ (بندُ XR-6.1). ولذلك لا يستدعي هذا الملفَّ شيءٌ في شيفرةِ الإنتاجِ
 * بعدُ — استدعاؤهُ الوحيدُ الاختباراتُ، حتى لا تُبنى حولَهُ واجهةٌ قبلَ أوانِها.
 *
 * قراراتُ التحويلِ (موثّقةٌ ليُحاسَبَ عليها المُحوِّلُ لا لتبقى في الرؤوسِ):
 * - `event_id` = معرّفُ الحدثِ المحليِّ نفسُهُ (uuid): حدثٌ واحدٌ لا حدثانِ،
 *   فالتحويلُ تغليفٌ لا توليدُ حادثةٍ.
 * - `version` = 1 من `event_version` المحليِّ «v1».
 * - `producer` = `wasla-market` ثابتةً.
 * - `correlation_id` = `trace_id` المحليِّ (في مغلّفِ الحدثِ نفسِهِ) إن
 *   وُجِدَ، وإلا `event_id` نفسُهُ (المخططُ يرفضُ الفارغَ) — لا تفقدَ سلسلةُ
 *   التتبّعِ جرّاءَ التحويلِ.
 * - `causation_id` = null: الوضعُ فعلٌ منشئٌ لا نتيجةُ حدثٍ سابقٍ؛ فليسَ
 *   ما يُسبِّبُهُ. إن استُهلكَ الحدثُ المحليُّ داخلَ سلسلةٍ لاحقًا فسيُمرَّرُ.
 * - `entity_type` = `store_order` (اسمُ الكيانِ عندَ مالكِهِ MARKET).
 * - `entity_id` = معرّفُ الكيانِ (uuid) لا معرّفُ النشرِ العموميُّ: العقدُ
 *   يُعني بالكيانِ لا بمرجعِهِ المتنشرِ.
 * - `payload.order_id` = المعرّفُ العموميُّ `WS-…` المُعلَنُ للمستهلكينَ (لا
 *   uuidَ داخليًّا): هذا ما يفهمُهُ CORE وما يُعادُ بهِ الاستعلامُ.
 */

import type { StoreOrderCreatedV1, WaslaPublicId } from "@wasla/contracts-delivery";

/** مغلّفُ حدثِ CORE كما يُلزِمُ `envelope.schema.json` (XR-4). */
export interface CoreEventEnvelope {
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

/** ما يحتاجهُ المحوّلُ فوقَ الحدثِ المحليِّ — وكلُّهُ صريحٌ لا مُستنتَجٌ. */
export interface MarketOrderCreatedEgressContext {
  /** منظمةُ CORE صاحبةُ المتجرِ (uuid) — إسقاطٌ لا يملكُهُ MARKET بعدُ (F-38). */
  organizationId: string;
  /** الخدمةُ المطلوبةُ من fulfillment — `«delivery»` في رحلةِ XR-4. */
  requestedService: string;
  /** حجزُ المالِ في CORE إن وُجِدَ، أو null (الساقُ الماليةُ معطّلةٌ حتى D-XR-21). */
  paymentAuthorizationId: string | null;
}

/** الحدثُ الخارجُ: `market.order.created` بمغلّفِ CORE. */
export interface MarketOrderCreatedCoreEvent extends CoreEventEnvelope {
  event_type: "market.order.created";
  version: 1;
  producer: "wasla-market";
  entity_type: "store_order";
  entity_id: string;
  payload: {
    order_id: WaslaPublicId;
    organization_id: string;
    requested_service: string;
    payment_authorization_id: string | null;
  };
}

/** يحوّلُ حدثَ وضعِ طلبِ المتجرِ المحليَّ إلى حدثِ CORE الخارجِ. */
export function marketOrderCreatedForCore(
  local: StoreOrderCreatedV1,
  context: MarketOrderCreatedEgressContext,
): MarketOrderCreatedCoreEvent {
  const organizationId = context.organizationId.trim();
  if (organizationId === "") {
    throw new Error("core_egress: organization_id مطلوبٌ ولا يقبلُ الفراغَ");
  }
  const requestedService = context.requestedService.trim();
  if (requestedService === "") {
    throw new Error("core_egress: requested_service مطلوبٌ ولا يقبلُ الفراغَ");
  }
  const orderId = local.aggregate.id.trim();
  if (orderId === "") {
    throw new Error("core_egress: entity_id مطلوبٌ ولا يقبلُ الفراغَ");
  }
  const publicId = local.payload.public_id.trim() as WaslaPublicId;
  if (publicId === "") {
    throw new Error("core_egress: order_id مطلوبٌ ولا يقبلُ الفراغَ");
  }
  const traceId = local.trace_id;
  const correlationId = (traceId ?? local.event_id).trim();
  return {
    event_id: local.event_id,
    event_type: "market.order.created",
    version: 1,
    producer: "wasla-market",
    occurred_at: local.occurred_at,
    correlation_id: correlationId,
    causation_id: null,
    entity_type: "store_order",
    entity_id: orderId,
    payload: {
      order_id: publicId,
      organization_id: organizationId,
      requested_service: requestedService,
      payment_authorization_id: context.paymentAuthorizationId,
    },
  };
}
