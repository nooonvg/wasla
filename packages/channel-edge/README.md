# `@wasla/channel-edge` — حدُّ القناةِ الواعيِ بالمصادقةِ (ADR-069 · المرحلة 2)

حزمةُ المكوّنِ الذي يحوِّلُ الدليلَ البشريَّ (`initData` من تلغرام) إلى جلسةٍ
موثَّقةٍ ثم إلى رمزِ خدمةٍ و`wua1` للمسارِ الخلفيِّ. وتُركَّبُ في `customer-bot`
و`driver-bot` القائمينِ **بلا إعادةِ كتابةٍ ولا تشغيلٍ جديدٍ** (ADR-069 §3).

## النطاقُ والحدودُ

- لا مسارٍ يُفتَحُ في الإنتاجِ بغيرِ قائمةِ السماحِ المصرَّحِ بها
  (`packages/channel-edge/allowlist/<surface>.json`) وحارسِ الفحصِ 28
  (`scripts/checks/validate-edge-allowlist.sh`).
- لا إصدارِ جلسةٍ بلا `verifyTelegramInitData` على سرِّ الروبوتِ الصاحبِ للسطحِ.
- لا `endUser` يُضبطُ بغيرِ `exchange` موقَّعٍ من identity؛ ولا رمزِ `wsvc3`
  يصكَّ بغيرِ منحِ الدورِ المُعلَنِ في `PRODUCTION_GRANTS`.
- لا تفعيلٍ حيٍّ ولا `production_open=true` بقرارِ مالكٍ مستقلٍّ — هذهِ مرحلةُ
  التركيبِ لا التفعيلِ.

## الواجهةُ

```ts
import { createChannelEdge } from "@wasla/channel-edge";
```

`createChannelEdge` يُعيدُ إضافاتِ Fastifyِ التي تُركَّبُ في `createBotApp`.
المكوّنُ **معطَّلٌ افتراضيًّا** في الإنتاجِ بلا `WASLA_EDGE_ENABLED=true`
حتى لا يُفتحَ أيُّ مسارٍ حيٍّ قبلَ قرارِ المالكِ. ولا يُفعِّلُ التركيبُ شيئًا
بقوائمِ السماحِ الحاليةِ (كلُّها `production_open=false` عمدًا).

## لماذا حزمةٌ منفصلةٌ

وحدةٌ قابلةٌ للتركيبِ لا كودٌ يُكتبُ في كلِّ روبوتٍ: مصدرُ الحقيقةِ واحدٌ
لإخفاءِ الترويساتِ ومنعِ إعادةِ `initData` وحدِّ المعدلِ. والفصلُ إلى عمليةٍ
مستقلةٍ لاحقًا لا يغيّرُ العقدَ لأنّ المكوّنَ هنا واجهةٌ لا تشغيلٌ (ADR-069 §3).

## المرجعُ

- [ADR-069](../../docs/15-decisions/ADR-069-human-authentication-edge-for-apps.md)
- [EDGE_ALLOWLIST.md](../../docs/12-testing/EDGE_ALLOWLIST.md)
- [STATE_SYNC_RULE.md](../../docs/00-rules/STATE_SYNC_RULE.md)
