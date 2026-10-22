# مصدرُ عقودِ CORE المنقولةِ إلى MARKET — ولماذا تُنسَخُ ولا تُؤلَّفُ

هذه الملفّاتُ **منقولةٌ حرفًا** من مستودعِ CORE، ولا تُحرَّرُ في هذا المستودعِ
ألبتةً. مِلكيّةُ عقدِ الأحداثِ ومغلّفِها لـCORE (XR-3.6 · الخارطةُ المشتركةُ)،
وMARKET **منتجٌ ومستهلكٌ تابعٌ** لا شريكٌ في الصياغةِ. أيَّ تعديلٍ يُريدهُ
MARKET يُطلَبُ في `wasla-core/contracts/events/` ثم يُنقَلُ إلى هنا بنسخةٍ
جديدةٍ ودورةِ نقلٍ مسجَّلةٍ أدناه.

| الحقل | القيمة |
|---|---|
| المستودعُ المصدرُ | [`nooonvg/wasla-core`](https://github.com/nooonvg/wasla-core) (WASLA CORE) |
| الالتزامُ المصدرُ | `d685364bef46e09c4c2cf9cf41e3485f6a623c3a` |
| مسارُ المصدرِ | `contracts/events/` |
| تاريخُ النقلِ | 2026-10-22 |
| البندُ | XR-3.6 (الخارطةُ المشتركةُ · المراجعةُ 7) |
| الملفّاتُ المنقولةُ | `envelope.schema.json` · `market.order.created.v1.schema.json` · `core.fulfillment.created.v1.schema.json` · `core.fulfillment.dispatched.v1.schema.json` · `core.fulfillment.completed.v1.schema.json` · `core.fulfillment.cancelled.v1.schema.json` · `core.fulfillment.executed_after_cancellation.v1.schema.json` |

## لماذا هذه المجموعةُ تحديدًا

- `envelope.schema.json`: المغلّفُ الذي يُلزَمُ بهِ **كلُّ** حدثٍ يعبرُ حدودَ
  المستودعاتِ (XR-4). لا حدثَ `market.*` ولا `core.fulfillment.*` بلاه.
- `market.order.created.v1`: ما يُنتِجُهُ MARKET (XR-3.4) عندَ وضعِ طلبِ متجرٍ —
  منتجُ MARKET، ومستهلكُهُ CORE.
- `core.fulfillment.*` (الخمسةُ): ما يستهلكُهُ MARKET (XR-3.5) ليحرّكَ
  `store_order` في رحلةِ التكاملِ (XR-4) — منتجُها CORE.

## حاجزُ التطابقِ

`scripts/checks/check-core-contract-parity.mjs` يقارنُ هذه النسخَ بالأصلِ في
`wasla-core@main` (تطابقًا بايتًا بصمةً SHA-256)، ويرفضُ أيَّ ملفٍ يتيمٍ أو
مفقودٍ من سجلِ النقلِ. وهو يعملُ في CI (`.github/workflows/core-contract-parity.yml`)
على كلِّ دفعةٍ تمسُّ `docs/contracts/core/` وعلى جدولٍ يوميٍّ، فلا ينكسرَ
 التطابقُ صامتًا.

## سجلُ دوراتِ النقلِ

| التاريخُ | الالتزامُ المصدرُ | ما نُقِلَ | البندُ |
|---|---|---|---|
| 2026-10-22 | `d685364` | النقلُ الأولُ: الملفّاتُ السبعةُ أعلاهُ | XR-3.6 |
