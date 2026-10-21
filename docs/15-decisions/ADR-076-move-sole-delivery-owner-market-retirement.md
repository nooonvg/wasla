# ADR-076: MOVE مالكُ تنفيذِ النقلِ والتوصيلِ الوحيد — تجميدُ نسخةِ MARKET الموازيةِ ثم حذفُها بعدَ ثبوتِ البديل

**Status:** Accepted
**Date:** 2026-10-21
**Decider:** Program Owner — تعليمةٌ مكتوبةٌ في هذه الجلسة (مقتبسةٌ في §Decision · موثَّقةٌ في TASK_LOG سطرِ CLM-0653)
**Related:** CLM-0653 · M0-54 · [الخارطةُ المشتركة `docs/ecosystem/ECOSYSTEM_ROADMAP.md`](../ecosystem/ECOSYSTEM_ROADMAP.md) (XR-0 … XR-7) · [ADR-026](ADR-026-store-orders-and-delivery-boundary.md) · `ROADMAP.md` §Ownership boundary · ceezr ADR 0292 / DEC-26 · wasla-core ADR 0001 / 0002 / 0007
**Supersedes:** لا شيءَ الآن. عندَ تنفيذِ XR-5 تصيرُ ADRاتُ مجالِ MOVE هنا «Superseded by ADR-076» (إضافةً مؤرَّخةً لا محوًا)، ومنها ADR-026 §2.4 (ساقُ `delivery_task → dispatch`) وحدَه، لا ADR-026 كلُّه.

## Context (مقيس على `main` عند `9d6925c`)

- `ROADMAP.md` §Ownership boundary و§Current state يقرّران مسبقًا أنّ `drivers` و`dispatch` و`matching` و`rides` و`delivery` ملكُ MOVE، وأنّها «stay in place until their replacement is proven».
- الحجمُ المقيسُ (أسطرُ `*.ts` المتتبَّعة، تشملُ الاختبارات): `services/delivery` ≈32.1 ألف · `negotiations` ≈16.3 ألف · `drivers` ≈15.3 ألف · `dispatch` ≈13.3 ألف · `orders` ≈11.7 ألف · `customers` ≈11.5 ألف · `matching` ≈9.5 ألف · `rides` صفر · `apps/driver-mini-app` ≈3.9 آلاف · `bots/driver-bot` ≈2.2 ألف · `bots/customer-bot` ≈2 ألف.
- ADR-026: `services/delivery` تملكُ مجموعتَين — `store_order` (تجاريّة) و`delivery_task` التي تفوّضُ المطابقةَ والإرسالَ إلى `services/dispatch`.
- اللوحة: M7-01..M7-06 «Not Started» وقرارُ الإصدار NO-GO؛ فلا مستخدمين خارجيّين ولا بياناتِ إنتاجٍ تجاريّةً في MARKET. أمّا MOVE (`nooonvg/ceezr`) فعملَ في الإنتاجِ بمستخدمين حقيقيّين وبنودٍ متحقَّقٍ منها في الإنتاج.
- `M5-13D` (ربطُ إنشاءِ مهمّةِ التوزيعِ بنشرِ طلبِ المشوار) «Ready for Gate» — أي توسيعٌ لنسخةِ MARKET من مجالِ MOVE.

## Decision

نصُّ المالكِ (2026-10-21، هذه الجلسة): «لك صلاحية كاملة في صياغة الخطة وخارطة الطريق كاملة مفصلة ودمجها في كل الثلاثة المشاريع ولكن لا تهلوس … حتى لو أردت حذف التوصيل من ماركت والاعتماد على ceezr لك كل الصلاحيات».

- **D1 — المالكُ الوحيد:** تنفيذُ النقلِ والتوصيلِ (السائقون، المركبات، التوزيع، المطابقة، التفاوض، المشاوير، مهامُّ التوصيل، التتبّع، إثباتُ التسليم) ملكُ MOVE وحدَه. لا يُبنى في هذا المستودعِ منطقٌ جديدٌ من هذا المجال.
- **D2 — مرحلتان لا حذفٌ فوريّ:** (أ) **تجميد** في XR-1: حارسُ CI يرفضُ أيَّ تغييرٍ في `services/{dispatch,drivers,matching,negotiations,orders,rides}` و`apps/driver-mini-app/` و`bots/driver-bot/` إلا لغرضِ الأمنِ أو الإزالة. (ب) **حذف** في XR-5 بعدَ أن تنجحَ رحلةُ XR-4.3 (طلبُ متجرٍ ← CORE ← مهمّةُ MOVE ← تسليمٌ ← `store_order delivered`). السبب: `delivery_task` اليومَ هو الطريقُ الوحيدُ لتسليمِ طلبِ المتجر، وحذفُه قبلَ البديلِ يتركُ `store_order` بلا مسار.
- **D3 — طلبُ المتجرِ يبقى هنا:** `store_order` وأصنافُه ومرآةُ الدفعِ تبقى في MARKET وتبقى قابلةً للتطوير. ساقُ التوصيلِ تُستبدَلُ بإنتاجِ `market.order.created` (مغلّفُ CORE) واستهلاكِ `core.fulfillment.*` (XR-3.4 / XR-3.5).
- **D4 — مجالاتُ CORE:** `identity` و`subscriptions` و`billing` و`reputation` تُجمَّدُ في XR-1 ويُستبدَلُ كلٌّ منها بعقدِ CORE في XR-6. و`geography` و`audit` و`support` و`compliance` و`referrals` و`auth` و`notifications` تبقى كما يقرّرُ `ROADMAP.md` حتى يثبتَ بديلُها، ولا تُجمَّدُ الآن.
- **D5 — بنودُ اللوحة:** `M5-13D` يُغلَقُ `Cancelled` بمرجعِ هذا القرارِ عندَ دمجِ حارسِ XR-1. و`M5-13M` (الطلبُ متعدّدُ الأصناف) يبقى لأنّه على `store_order`. ونطاقُ M7 يُعادُ تعريفُه في XR-7.1.
- **D6 — لا اتصالَ مباشرٌ بـMOVE:** كلُّ تكاملٍ عبرَ CORE.

## Consequences

- لا تغييرَ في الشيفرةِ في CLM-0653: وثائقُ وفحصُ تطابقٍ وسيرُ عملٍ واحد.
- الحارسُ (XR-1.1) يُبنى بحجزٍ مستقلّ، ويُختبَرُ بخرقٍ مزروع.
- الاستعادة: هذا القرارُ إضافةٌ؛ إلغاؤه بقرارِ مالكٍ يعيدُ الحالَ قبلَه، لأنّ لا شيءَ حُذِف.
