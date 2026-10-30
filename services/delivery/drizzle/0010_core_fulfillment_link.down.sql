-- رفيقُ الترجعِ لـ`0010_core_fulfillment_link.sql` — مُراجَعٌ يدويّاً (نمطُ ADR-024 §2.2).
-- يحذفُ ما أضافَهُ 0010 وحدَهُ: صفوفُ الصادرِ تبقى (أعمدةُ التراجعِ والرفضِ فقط تُحذَف).
DROP INDEX IF EXISTS ix_core_fulfillment_link_cancel_pending;
DROP TABLE IF EXISTS core_fulfillment_link;
ALTER TABLE core_egress_outbox DROP COLUMN IF EXISTS refused_at;
ALTER TABLE core_egress_outbox DROP COLUMN IF EXISTS last_attempt_at;
