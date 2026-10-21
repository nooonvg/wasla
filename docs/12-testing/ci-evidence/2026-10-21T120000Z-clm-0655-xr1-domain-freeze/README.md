# CLM-0655 — XR-1: الفحصُ 29 (xr-domain-freeze) وحكمُ ما بعدَ دمجِ XR-0

**التاريخ:** 2026-10-21 · **البندُ:** M0-54 (XR-1.1 · XR-1.2 · XR-1.3) · M5-13D → Cancelled · **الفرعُ:** `stage-zero/clm-0655-xr1-domain-freeze` · **القرارُ:** [ADR-076](../../../15-decisions/ADR-076-move-sole-delivery-owner-market-retirement.md) · **الخارطةُ:** [ECOSYSTEM_ROADMAP.md §4 XR-1](../../../ecosystem/ECOSYSTEM_ROADMAP.md)

## 0. حكمُ XR-0 بعدَ الدمج

| المستودع | PR ← الالتزام | Ecosystem sync على main | CI على main |
|---|---|---|---|
| `nooonvg/wasla` | #2 ← `a5707dc` | ناجح (39572061716) | قيدَ التشغيلِ عندَ القياس (39572061639) |
| `nooonvg/wasla-core` | #1 ← `a546b14` | ناجح (39572040002) | ناجح (39572039891) |
| `nooonvg/ceezr` | #1 ← `1f7fae0` | ناجح (39572050571) | قيدَ التشغيلِ عندَ القياس (39572050545) |

الخامُ: `raw/xr0-post-merge-main-runs.tsv`. فحصُ التطابقِ في وضعِه الصارمِ على `main` أخضرُ في الثلاثة: الملفّاتُ الثلاثةُ متطابقةٌ بايتًا.

## 1. ما بُني

- `scripts/checks/validate-xr-domain-freeze.sh` — الفحصُ 29: كلُّ إيداعٍ في النطاقِ (`git rev-list --no-merges`) يُقاسُ وحدَه بـ`git diff-tree -M`. تغييرٌ في مسارٍ مجمَّدٍ يُرفَضُ إلا (أ) حذفًا، أو (ب) في إيداعٍ تحملُ رسالتُه `XR-RETIRE` أو `SECURITY` كلمةً مستقلّةً. والمرجعُ الذي لا يُحَلُّ إخفاق.
- `scripts/checks/lib/xr-frozen-paths.sh` — المصدرُ الواحدُ: 12 بادئةً (`services/{dispatch,drivers,matching,negotiations,orders,rides,identity,subscriptions,billing,reputation}/` · `apps/driver-mini-app/` · `bots/driver-bot/`) و4 ملفّاتٍ لساقِ `delivery_task → dispatch` في `services/delivery`.
- `scripts/checks/lib/gov-cases-xr-domain-freeze.sh` — 8 حالاتٍ في حزمةِ الحوكمةِ على مستودعاتِ git صناعيّة.

## 2. الأدلة

| الملف | ما يُثبِت |
|---|---|
| `raw/self-test.txt` | الاختبارُ الذاتيُّ 11/11 |
| `raw/planted-breach.txt` | خرقٌ مزروعٌ على المستودعِ الحقيقيِّ: التعديلُ بلا وسمٍ يُرفَض · XR-RETIRE يمرّ · الحذفُ يمرّ · وسمُ SECURITY لا يُعفي إيداعًا آخرَ · `store_order` مفتوح |
| `raw/verify-log-d6613a5.txt` | `scripts/verify.sh` كاملًا على `d6613a5`: الأنواعُ والاختباراتُ ناجحةٌ (6256 اختبارًا · 441 ملفًّا)؛ الفحصُ 29 ناجحٌ؛ حزمةُ الحوكمةِ 696 ناجحًا و1 فاشلًا هو انعكاسُ الفحصِ 11 قبلَ إعادةِ توليدِ الأساسِ (BASELINE_FORMAT §6.5) |

## 3. إعادةُ توليدِ BASELINE (قرارٌ مكتوب)

`governance_checks` 28 → 29 (الفحصُ الجديد) و`governance_suite_cases` 688 → 696 (+8 حالاتٍ)؛ وبقيّةُ العدَّاداتِ وبصمةُ القفلِ كما هي.
