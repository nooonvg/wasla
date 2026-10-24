-- البند 0.4 من المراجعة الشاملة 2026-10-24 (CLM-0689 · ADR-026 §4.29):
-- فصلُ الإسنادِ عنِ الاستلامِ في إسقاطِ `core.fulfillment.dispatched`.
--
-- لماذا: الحدثُ يُثبتُ أنَّ MOVE قَبِلَ مهمّةَ التنفيذِ (D-XR-31 — إسنادٌ لا
-- تسليم)، بينما كانَ إسقاطُهُ ينقلُ الطلبَ إلى `handed_to_courier` («في يدِ
-- الساعي») — اسمٌ يقولُ ما لا يُثبِتُهُ الدليل. الحلُّ حالةٌ جديدةٌ `assigned`
-- تُثبِتُ ما يُثبِتُهُ الحدثُ حرفيًّا.
--
-- الهجرةُ تُوسِّعُ قيدَ CHECK فقط: لا إعادةَ كتابةٍ للسجلاتِ التاريخيّةِ ولا
-- تصنيفًا لأيِّ صفٍّ قائمٍ — الصفوفُ الحاليةُ كلُّها تحملُ قيمًا مسموحةً في
-- القيدِ الجديد. والخصمُ النهائيُّ للمخزونِ يعمَّمُ بالوجهةِ (`→ delivered`)
-- في الشيفرةِ لا هنا.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "store_orders" DROP CONSTRAINT IF EXISTS "store_orders_fulfillment_state_check";--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_fulfillment_state_check" CHECK ("store_orders"."fulfillment_state" IN ('draft','placed','confirmed','picking','picked','ready_for_delivery','assigned','handed_to_courier','delivered','cancelled','rejected','failed'));
