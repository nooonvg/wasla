# CLM-0579 — Stage Zero — الجرد الهيكلي الأول (شريحة أولى محدودة النطاق)

> **النطاق:** شريحة أولى فقط من المرحلة صفر لبرنامج الإكمال (دمج متطلبات حزمة خارطة الإكمال في الخارطة الحاكمة + جرد هيكلي للمستودع). **الجرد السلوكي العميق** (اختبارات E2E حية، صحة العقود، انحراف الحزم، جاهزية النشر) خارج نطاق هذه الشريحة، وسيأتي في شرائح تالية من نفس المرحلة صفر.
>
> **رأس القياس:** `6c4a8fa6bc9692a3261d10e13dbf30632b6768ce` (main).
> **وقت القياس:** 2026-10-17T00:10:00Z (UTC).

---

## §1 ما تم قياسه فعلًا في هذه الشريحة (ولم يُدَّعَ ما لم يُقَس)

| ما قِيس | كيف قِيس | القيمة |
|---|---|---|
| عدد المجلدات: خدمات / تطبيقات / بوتات / حزم / بنية تحتية | مسح شجرة git | 27 / 5 / 3 / 40 / 9 |
| ملفات TS متتبعة | `git ls-files` | 1454 |
| ملفات اختبار متتبعة | `git ls-files` | 525 |
| مجلدات لا تحتوي إلا `.gitkeep` (نصوص placeholder بقرار) | مسح شجرة | 26 |
| ملفات `api.openapi.yml` | `git ls-files` | 17 |
| ملفات `schema.sql` | `git ls-files` | 18 |
| ملفات `events.json` | `git ls-files` | 16 |
| سير عمل GitHub | `ls .github/workflows` | 17 |
| سكربتات الحوكمة في `scripts/checks` | `ls` | 47 |
| صحة الخدمات الحية على Render (قراءة فقط، عبر سير عمل `service-health`) | سجل تشغيل 38968137240 | **14/14 healthy** (2026-10-16T21:16Z) |

**حدود القياس (تُقال صريحة):** هذا جرد هيكلي (وجود ملفات ومجلدات وعددها) لا جرد سلوكي. وجود 525 ملف اختبار لا يثبت أن الاختبارات تمر؛ وجود `api.openapi.yml` لا يثبت مطابقة الكود للعقد. لا يُستنتج من هذا الجرد أي نسبة اكتمال كلية للمشروع.

---

## §2 تصنيف المكوّنات (بالملصقات الست للمرحلة صفر)

الملصقات المستخدمة هي ملصقات المرحلة صفر كما وردت في الحزمة: `VERIFIED_COMPLETE` · `IMPLEMENTED_UNVERIFIED` · `PARTIAL` · `PLACEHOLDER` · `BLOCKED` · `NOT_APPLICABLE_WITH_APPROVAL`. **لا يوجد ملصق سابع.** `NOT_PROVEN` لا يُستخدم كملصق مكوّن بل كقيد على الدليل.

### §2.1 الخدمات الـ27 (`services/`)

| الخدمة | ملفات src | ملفات test | الملصق في هذه الشريحة | أساس الملصق |
|---|---|---|---|---|
| customers | 34 | 18 | IMPLEMENTED_UNVERIFIED | كود واختبارات موجودة؛ سلوكها لم يُقس في هذه الشريحة |
| delivery | 68 | 62 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| dispatch | 42 | 29 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| drivers | 45 | 22 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| geography | 28 | 11 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| identity | 30 | 14 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| marketplace | 51 | 35 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| matching | 35 | 20 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| negotiations | 48 | 21 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| orders | 36 | 16 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| partners | 25 | 9 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| reputation | 46 | 21 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| search | 35 | 23 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| subscriptions | 46 | 21 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| support | 21 | 8 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| audit | 18 | 1 | PARTIAL | كود واختبارات موجودة لكن اختبار واحد فقط؛ عدم كفاية الاختبار مُعلَن |
| billing | 27 | 12 | IMPLEMENTED_UNVERIFIED | نفس الأساس |
| observability | 6 | 1 | PARTIAL | نفس أساس audit |
| analytics | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M8 · Phase 21+) |
| auth | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار |
| chat | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M5 · Phase 08) |
| compliance | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M7 · Phase 20) |
| fraud | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M6-19 · Phase 09 · [ADR-014](../../../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md)) |
| notifications | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M3) |
| referrals | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M5-16 · Phase 16) |
| rides | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M5-15 · Phase 15) |
| translation | 0 | 0 | PLACEHOLDER | `.gitkeep` فقط؛ Placeholder بقرار (M8 · Phase 21+) |

### §2.2 التطبيقات الخمسة (`apps/`)

| التطبيق | ملفات src | ملفات test | الملصق | أساس |
|---|---|---|---|---|
| admin-portal | 30 | 5 | IMPLEMENTED_UNVERIFIED | كود واختبارات موجودة؛ سلوك لم يُقس |
| customer-mini-app | 17 | 2 | PARTIAL | كود موجود؛ اختباران فقط |
| driver-mini-app | 28 | 7 | IMPLEMENTED_UNVERIFIED | كود واختبارات |
| admin-web | 0 | 0 | PLACEHOLDER | `.gitkeep`؛ Placeholder بقرار (M3) |
| partner-mini-app | 0 | 0 | PLACEHOLDER | `.gitkeep`؛ Placeholder بقرار (M3) |

### §2.3 البوتات الثلاثة (`bots/`)

| البوت | ملفات src | ملفات test | الملصق | أساس |
|---|---|---|---|---|
| customer-bot | 8 | 6 | IMPLEMENTED_UNVERIFIED | كود واختبارات |
| driver-bot | 8 | 6 | IMPLEMENTED_UNVERIFIED | كود واختبارات |
| partner-bot | 3 | 2 | PARTIAL | كود موجود؛ اختباران فقط |

### §2.4 الحزم الـ40 (`packages/`)

33 حزمة لها `package.json`؛ 7 مجلدات حزمة بلا `package.json` هي نفسها مجلدات `.gitkeep` (events, ui, contracts, test-utils, i18n, date-time, telemetry) — Placeholder بقرار (نواة مشتركة عالية الخطورة، محجوزة لمسارات فرعية صريحة).

الحزم المنفذة (33) مصنفة `IMPLEMENTED_UNVERIFIED` في هذه الشريحة (وجود كود واختبارات؛ السلوك لم يُقس هنا)، باستثناء:
- `packages/contracts/` — مجلد `.gitkeep` فقط لكنه يحمل اسم النواة المشتركة (Placeholder بقرار).
- الحزم `*-e2e` الـ16 (app-edge, billing, channel, customer, delivery, dispatch, driver, golden, marketplace, negotiation, order, partners, pilot-feedback, reputation, search, subscription) — `IMPLEMENTED_UNVERIFIED`؛ وجودها لا يثبت أن رحلات E2E تمر حية.

### §2.5 البنية التحتية (`infra/`)

| المجلد | الملفات | الملصق | أساس |
|---|---|---|---|
| docker | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| environments | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| kubernetes | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| migrations | `migration-owners.json` | PARTIAL | ملف ملكية موجود؛ لا سكربتات ترحيل فعلية في المجلد |
| observability | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| render | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| secrets | `secret-inventory.json` | PARTIAL | ملف جرد موجود (28 سرًا) |
| terraform | `.gitkeep` فقط | PLACEHOLDER | بقرار |
| tls | `.gitkeep` فقط | PLACEHOLDER | بقرار |

**الحدود:** مجلدات `.gitkeep` في `infra/` قد تكون نية تصميمية موثقة (Deployment ككود) أو فجوة؛ هذا القرار يُترك للشرائح التالية من المرحلة صفر للتحقق من الأدلة الفعلية للنشر (Render resources 24 موجودة ومقيسة في CLM-0577/0578، فالبنية الحية موجودة خارج المجلدات).

---

## §3 مصفوفة الأثر (شريحة أولى: اتجاه واحد فقط)

هذه الشريحة تنشئ **اتجاهًا واحدًا فقط** من مصفوفة الأثر: المكوّن ← ما هو موجود فعليًا من كود واختبار وعقد. **الاتجاه الثاني** (المتطلب ← المكوّن الذي يبرره) لم يُبنَ في هذه الشريحة ويحتاج جرد المتطلبات من `docs/01-product/` و`ROADMAP.md` و`LAUNCH_TO_100_ROADMAP.md` — وهذا عمل الشريحة التالية من نفس المرحلة صفر.

---

## §4 الحوكمة وحدود المرحلة صفر (صريحة)

| البند | الحالة في هذه الشريحة |
|---|---|
| المرحلة صفر كاملة | **In Progress** — هذه الشريحة الأولى فقط |
| الشريحة التالية المطلوبة | (أ) بناء الاتجاه الثاني لمصفوفة الأثر من المتطلبات (جرد `docs/01-product/` · `ROADMAP.md` · `LAUNCH_TO_100_ROADMAP.md`) (ب) تصنيف الفجوات الفعلية مقابل المتطلبات (ج) التحقق السلوكي للرحلات الحرجة على بيئة معزولة |
| نسبة اكتمال كلية | **غير معلنة** — يمنع إعلانها قبل اكتمال الجرد في الاتجاهين |
| المكونات ذات `IMPLEMENTED_UNVERIFIED` | 27 خدمة + تطبيقان + 3 بوتات + 33 حزمة — تحتاج تحققًا سلوكيًا قبل رفعها إلى `VERIFIED_COMPLETE` |
| `INC-0007` | مفتوحة — التدوير لم يحدث (قياس CLM-0578) |
| `RISK-0067` | `mitigating` — بلا تغيير |
| `RISK-0066` | `open` — بلا تغيير |
| `M6-18B` | `Blocked` — بلا تغيير |

---

## §5 الدليل الخام

- [raw-structural-census.json](raw-structural-census.json) — المسح الهيكلي الآلي (المجلدات · عدد الملفات · وجود `package.json` · `.gitkeep` · Dockerfile · العقود · الهجرات · ملفات الاختبار · `/health`)
---

## §6 الحوكمة قبل الدفع (مقيسة في هذه الجلسة)

| الفحصُ | الأمر | النتيجة |
|---|---|---|
| State-sync | `bash scripts/checks/validate-state-sync.sh` | **PASS** — project state synchronized (ledger: 4 · documentation: 7) |
| Governance (28 فحصاً) | `bash scripts/checks/verify-governance.sh origin/main HEAD` | **نجح** لكلِّ الفحوصِ المُنفَّذةِ — **تنبيهٌ مسمّى:** فحصٌ واحدٌ (8: CI مانعٌ) تخطّي مُعلَنًا على لقطةٍ مؤرَّخةٍ (2026-09-28T06:48:00Z) ولم يُسأل حيًّا؛ لا يُعدُّ هذا نجاحًا كاملًا |
| خوارزمياتُ تزويرِ الحوكمة | `bash scripts/checks/test-governance.sh` | **691 ناجحًا · 0 فاشلاً** (أقلُّ من 722 في جلسةِ CLM-0578 لأنَّ نطاقَ هذه الشريحةِ لا يمسُّ `scripts/` — عددُ الحالاتِ يتبعُ الحالاتِ المنطبقةَ على نطاقِ التغييرِ لا قيمةً مطلقةً) |
| Work claims | `bash scripts/checks/validate-work-claims.sh origin/main HEAD` | **نجح** — الحجزُ: CLM-0579 (مُقفَلٌ في هذا النطاق) · كلُّ الملفاتِ داخلَ النطاقِ |
| require-doc-update | `bash scripts/checks/require-doc-update.sh origin/main HEAD` | **نجح** |
| Launch board | `bash scripts/checks/validate-launch-board.sh` | **OK** (119 عنصرًا · مطابقةُ معرفاتِ TASK_LOG) — مقيسٌ بعدَ إدراجِ M0-53 |

> الحوكمةُ الكاملةُ **قِيسَت** قبلَ الدفعِ (STATE_SYNC_RULE §6) — كلُّ أرقامِها مقيسةٌ في هذه الجلسةِ لا موعودة. `pnpm` نُصِّبَ في البيئةِ المحليةِ (v9.15.9 · `pnpm install --frozen-lockfile --ignore-scripts`) لأنَّ فحصَ 14 يحتاجُه.
