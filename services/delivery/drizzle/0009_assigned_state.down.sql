-- رفيقُ الترجعِ لـ`0009_assigned_state.sql` — مُراجَعٌ يدويّاً (نمطُ ADR-024 §2.2).
--
-- يُعيدُ القيدَ بأحدَ عشرةَ حالةً، **ويرفضُ صراحةً** إن وُجِدَ صفٌّ واحدٌ على الأقلِّ
-- بحالةِ `assigned`: الترجعُ طريقُ خروجٍ لا مِحرقةَ بيانات، فلا يُعادُ تصنيفُ صفٍّ
-- قائمٍ ليَمرَّ القيد. المُشغِّلُ يرى الصفوفَ المانعةَ في رسالةِ الخطأِ ويقرِّر.
-- @wasla-upgrade-proof: all-non-baseline

DO $$
DECLARE
  assigned_rows integer;
BEGIN
  SELECT count(*) INTO assigned_rows FROM "store_orders" WHERE "store_orders"."fulfillment_state" = 'assigned';
  IF assigned_rows > 0 THEN
    RAISE EXCEPTION 'CLM-0689 rollback refused: % store_orders row(s) are in the assigned state; restoring the 11-state CHECK would require reclassifying live rows', assigned_rows
      USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "store_orders" DROP CONSTRAINT IF EXISTS "store_orders_fulfillment_state_check";--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_fulfillment_state_check" CHECK ("store_orders"."fulfillment_state" IN ('draft','placed','confirmed','picking','picked','ready_for_delivery','handed_to_courier','delivered','cancelled','rejected','failed'));
