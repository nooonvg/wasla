# CLM-0686 · البند 2.1 — الربطُ الموثَّقُ الأدنى متجر ↔ منظمة

**الفرع:** `stage-zero/clm-0686-item-2-1-store-org-linking` · **التاريخ:** 2026-10-23 · **المرجع:** خطة المراجعة الشاملة 2026-10-23 · البند 2.1 (المرحلة 2)

## معيارُ القبولِ في البندِ

«مسارُ إدخالٍ يضبطُ `stores.organization_id`» — وهذا ما نُنفّذُه: **مسارُ تسجيلِ المتجرِ** صارَ يقبلُ مُعرّفَ المنظمةِ فيُخزِّنُهُ في `stores.organization_id`.

## ما كانَ قبلَ هذا (الفجوة)

| القطعة | الحالة |
|---|---|
| `stores.organization_id` في المخططِ | موجودٌ (عمودٌ اختياريٌّ UUID) |
| `organization_id` في قراءةِ المتجرِ (StoreResource) | موجودٌ (يُخرَجُ في الاستجابةِ) |
| **مسارٌ يضبطُهُ** | **لا يوجدُ** — العقدُ يقولُ صراحةً «لا يقبلُهُ مسارُ الإنشاءِ» |

## ما نُفِّذَ (الربطُ الأدنى)

**سلسلةٌ واحدةٌ عبرَ كلِّ الطبقاتِ** — مُعرّفُ المنظمةِ (UUID اختياريٌّ) يُقبلُ في تسجيلِ المتجرِ ويُخزَّنُ:

```
RegisterStoreInput (organizationId?)
  → draftStore (فحصُ الشكلِ: assertUuid — لا وجودٌ)
    → insertStore (organizationId ?? null)
      → stores.organization_id
```

| الملفُّ | التغييرُ |
|---|---|
| `domain/model.ts` | `organizationId?: string` في `StoreDraft` |
| `domain/catalog.ts` | فحصُ الشكلِ في `draftStore` (اختياريٌّ · UUID · بلا قيمةٍ افتراضيّةٍ) |
| `app/stores.ts` | `organizationId` في `RegisterStoreInput` + تمريرُهُ |
| `db/resources.ts` | كتابةُ `organizationId ?? null` في `insertStore` |
| `http/requests.ts` | `organization_id` في `REGISTER_STORE_KEYS` + التحليلُ |
| `contracts/api.openapi.yml` | `organization_id` في `RegisterStoreRequest` + تحديثُ وصفِ `StoreResource` |
| `packages/contracts/marketplace/src/api-types.ts` | مطابقةُ الأنواعِ |

## قرارُ التصميمِ المُعلَن

- **السوقُ لا يتحقّقُ من وجودِ المنظمةِ** (ذلكَ عقدُ النواةِ · `wasla-core` `POST /v1/organizations`) بل من **شكلِ** المُعرّفِ (UUID) فقط — الربطُ بالمرجعِ.
- **اختياريٌّ**: بلا مُعرّفٍ يبقى `organization_id` فارغًا (`null`) — لا قيمةً افتراضيّةً ولا إلزامًا (لا يُكسِرُ أيَّ مُتَّصلٍ قائمٍ).
- **تحديثُ قرارٍ سابقٍ**: وصفُ `StoreResource` قالَ «لا يقبلُهُ مسارُ الإنشاءِ» — صارَ يقبلُهُ (البندُ 2.1 ينقلُ هذا القرارَ).

## الاختبارات

- **الوحداتُ: 409 ناجحًا** (كانَ 406 · +3 جديدةٌ في `catalog.test.ts`): شكلٌ صحيحٌ يُمرَّرُ · بلا قيمةٍ افتراضيّةٍ · رفضُ غيرِ UUID برمزٍ مُسمّىً
- **التكاملُ (2 جديدةٌ في `stores.integration.test.ts`)**: تُخزَّنُ في `stores.organization_id` عندَ الإنشاءِ · تبقى `null` بلا مُعرّفٍ — **تُشغَّل في CI** (db-integration · `PG_ENABLED`) إذ لا PostgreSQL محليًّا (165 اختبارَ تكاملٍ تُخطَّى محليًّا وتُشغَّل في CI)
- **حارسُ التباعدِ** (http-drift): العقدُ والمُحلِّلُ متطابقانِ (أُضيفَ `organization_id` للعقدِ ليَعبرَ)

## النتائجُ

- **الوحداتُ: 409 ناجحًا** · `tsc` نظيفٌ · **الحوكمةُ: كلُّ الفحوصِ نجح** (الخامُّ في الدليلِ)
