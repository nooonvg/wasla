# CLM-0555 — RISK-0067: مخزنُ آثارِ الرموزِ يستعيرُ مجمعَ المضيف (ADR-070)

- **الحجز:** CLM-0555 · البند M6-18B · الفرع `fix/clm-0555-replay-store-shares-host-pool`.
- **الأصل:** اكتشافُ CLM-0554 (PR #708) — الحدُّ النظريُّ لأسطولِ Render = 104 بسببِ مجمعِ `service-auth-replay` الخاصِّ بـ`max: 4` في كلِّ عملية.
- **القرار:** [ADR-070](../../../15-decisions/ADR-070-replay-store-borrows-host-pool.md).
- **الحالةُ لا تتغيّر:** RISK-0067 `mitigating` · M6-18B `Blocked` · NO-GO.

## التغيير

| الملف | التغيير |
|---|---|
| `packages/resilience/src/pg-guard.ts` · `index.ts` | `guardedPoolFor(connectionString)`: المجمعُ المحروسُ الأوّلُ على الوصلةِ نفسِها حرفًا (الوصلةُ في الذاكرةِ فقط، لا تُسجَّل). |
| `packages/service-auth/src/replay-store.ts` | المُنفِّذُ الإنتاجيُّ يستعيرُ مجمعَ المضيف؛ وإلّا مجمعٌ خاصٌّ بلا `max` من المستدعي (يحكمُه `WASLA_PG_POOL_MAX`). |
| `scripts/checks/validate-replay-store.sh` | البابُ 5 (5أ الاستعارة · 5ب لا `max` في المِغلاف). |
| `scripts/checks/lib/gov-cases-replay-store.sh` | حالتا طفرةٍ تُثبتانِ أنّ البابَ 5 يعضّ. |
| `packages/service-auth/src/__tests__/replay-store.test.ts` | المخطَّطُ والـ`INSERT` على مجمعِ المضيف، والإغلاقُ لا يُنهيه. |
| `packages/resilience/src/__tests__/pg-guard.test.ts` | قواعدُ الإعارة + حسابُ الأسطولِ المقيس (36 بعدَ القرار، 104 قبله). الاختبارُ القديمُ `17 × 2 = 34 ≤ 40` باقٍ كما هو. |

## الحدُّ النظريُّ (من جردِ CLM-0554، `numInstances = 1`)

| | قبل | بعد |
|---|---:|---:|
| 14 خدمةَ مجال | 14 × 6 = 84 | 14 × 2 = 28 |
| customer-bot | 8 | 4 |
| driver-bot | 6 | 2 |
| partner-bot | 6 | 2 |
| **المجموع** | **104** | **36** |

36 ≤ 40 (آخرُ `pool_size` مسجَّل، 2026-10-08 — غيرُ مقيسٍ اليوم) بهامشِ 4 خانات. **حسابٌ نظريٌّ لا قياسٌ حيّ.**

## الفحوصُ المحلية (استشارية — CI هو الحكم)

- `packages/service-auth` vitest: 219/219 · `packages/resilience`: 74/74 · `packages/bot-runtime`: 208/208 · `services/audit`: 18/18.
- `tsc --noEmit`: service-auth · resilience = 0.
- `validate-replay-store.sh`: يمرّ؛ وبطفرةِ `max: 4` يدويًّا يُسقِطُ (rc=1) ثمّ يمرُّ بعدَ الاستعادة.

## حكمُ CI وما بعد الدمج

يُسجَّلُ في TASK_LOG بعدَ قراءةِ الحكمِ الفعليّ. النشرُ إلى Render يجري بوظيفةِ النشرِ المُثبَّتة على الالتزامِ المدموج؛ صحّةُ الخدماتِ بعدَه تُقرأُ من Render API ولا تُفترض.

## ما لا يُثبتُه

سلوكَ Supavisor تحتَ حِمل، ولا `pool_size` الحاليّ، ولا إغلاقَ RISK-0067.
