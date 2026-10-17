# CLM-0579 — Stage Zero — الجرد الهيكلي الأول (شريحة أولى محدودة النطاق) — نسخة مصححة

> **النطاق:** شريحة أولى فقط من المرحلة صفر لبرنامج الإكمال (دمج متطلبات حزمة خارطة الإكمال في الخارطة الحاكمة + جرد هيكلي للمستودع). **الجرد السلوكي العميق** خارج نطاق هذه الشريحة.
>
> **رأس القياس:** `6c4a8fa6bc9692a3261d10e13dbf30632b6768ce` (main).
> **وقت القياس الفعلي:** 2026-10-17T00:10:00Z (UTC) · **التصحيح:** 2026-10-17T00:55:00Z (UTC).
> **حالة هذا الدليل:** مُصحَّح بعدَ مراجعةِ أشارت إلى عيوبِ في الكاشفِ الأولي (تصنيفُ مجلداتٍ غيرِ فارغةٍ كـ placeholder لأنَّ الكاشفَ لم يفحصِ الملفاتِ المُتتبَّعةَ تِباعيًا في الأدلةِ الفرعية).

---

## §1 الأوامر القابلة لإعادة التشغيل (الجرد قابل للتكرار)

كلُّ رقمٍ في هذا الملفِ يُعادُ إنتاجُه بهذه الأوامرِ على الرأسِ `6c4a8fa6`:

```bash
# كل الملفات المتتبعة
git ls-tree -r --name-only 6c4a8fa6bc9692a3261d10e13dbf30632b6768ce

# ملفات TS (الكل)
git ls-tree -r --name-only 6c4a8fa6 | grep '\.ts$' | wc -l   # = 1454

# منها ملفات مصدر (غير اختبار)
git ls-tree -r --name-only 6c4a8fa6 | grep '\.ts$' | grep -vE '\.(test|integration)\.ts$' | wc -l   # = 929

# منها ملفات اختبار
git ls-tree -r --name-only 6c4a8fa6 | grep -cE '\.(test|integration)\.ts$'   # = 525

# مجلد placeholder حقيقي (لا ملف متتبع تحته غير .gitkeep)
# لكل dir D: git ls-tree -r --name-only 6c4a8fa6 -- D | grep -v '\.gitkeep$' | wc -l  == 0
```

**مصدرُ الأرقام:** `git ls-tree -r --name-only` على الرأسِ المذكورِ بالاسمِ — لا `os.walk` على الشجرةِ العاملةِ (الفرقُ: `os.walk` يرى الملفاتِ غيرَ المُتتبَّعةِ مثل `node_modules`).

---

## §2 ما تم قياسه فعلًا

| ما قِيس | كيف قِيس | القيمة |
|---|---|---|
| مكوّنات المستوى الثاني: خدمات / تطبيقات / بوتات / حزم / بنية تحتية | مسح `git ls-tree` على الرأس | 27 / 5 / 3 / 40 / 9 (مجموع 84) |
| ملفات TS متتبعة — **الكل** | `git ls-tree` | **1454** |
| منها ملفات مصدر (غير اختبار) | `git ls-tree` | **929** |
| منها ملفات اختبار (`.test.ts`/`.integration.ts`) | `git ls-tree` | **525** |
| مجلدات لا تحتها أي ملف متتبع غير `.gitkeep` | فحص متتابع لكل مجلد | **18** (وليس 26 — التصحيحُ موثَّقٌ أدناه) |
| ملفات `api.openapi.yml` | `git ls-tree` | 17 |
| ملفات `schema.sql` | `git ls-tree` | 18 |
| ملفات `events.json` | `git ls-tree` | 16 |
| سير عمل GitHub | `ls .github/workflows` (الشجرةِ العاملةِ المطابقةِ للرأسِ) | 17 |
| سكربتات الحوكمة في `scripts/checks` | `ls` | 47 |
| صحة الخدمات الحية على Render (قراءة فقط) | سجل تشغيل 38968137240 | **14/14 healthy** (2026-10-16T21:16Z) — **حدُّها:** 14 خدمةً فقط تُفحصُ في هذا السيرِ لا 84 مكوّنًا |

**حدود القياس (تُقال صريحة):** هذا جرد هيكلي (وجود ملفات متتبعة) لا جرد سلوكي. وجود 525 ملف اختبار لا يثبت أن الاختبارات تمر؛ وجود `api.openapi.yml` لا يثبت مطابقة الكود للعقد. لا يُستنتج من هذا الجرد أي نسبة اكتمال كلية للمشروع. **وقياسُ 14/14 healthy تاريخيٌّ لحظيٌّ** (تشغيلُ 38968137240 · 2026-10-16T21:16Z) لا يُدَّعى أنه تحققٌ سلوكيٌّ للـ84 مكوّنًا ولا أنه مستمرٌّ الآن.

### §2.1 تصحيح الكاشف الأولي (موثَّق بالإضافة لا بالمحو)

الكاشفُ الأوليُّ عدَّ 26 مجلدَ `.gitkeep`. **العددُ الصحيحُ 18.** السببُ الجذريُّ: الكاشفُ الأوليُّ عدَّ الملفاتِ في المستوى الأولِ للمجلدِ فقط، فظنَّ أنَّ مجلدًا يحملُ `.gitkeep` في جذرِهِ وملفاتٍ فعليةً في أدلةٍ فرعيةٍ هو placeholder. الحالاتُ السبعُ المصحَّحةُ:

| المجلد | `.gitkeep` في الجذر؟ | الملفات المتتبعة فعليًا | التصحيح |
|---|---|---|---|
| `packages/contracts/` | نعم | **144 ملفًا** (47 TS · 59 اختبار · 12 package.json في أدلة فرعية) | **IMPLEMENTED_UNVERIFIED** — ليس placeholder |
| `infra/environments/` | نعم | 7 ملفات (5 environment.json · README) | **IMPLEMENTED_UNVERIFIED** |
| `infra/observability/` | نعم | 11 ملفًا (3 Dockerfiles · prometheus/alertmanager/otel-collector yml) | **IMPLEMENTED_UNVERIFIED** |
| `infra/render/` | نعم | 3 ملفات JSON | **IMPLEMENTED_UNVERIFIED** |
| `infra/terraform/` | نعم | 16 ملفًا (main.tf · environments · variables) | **IMPLEMENTED_UNVERIFIED** |
| `infra/migrations/` | نعم | 1 ملف (`migration-owners.json`) | **IMPLEMENTED_UNVERIFIED** (ملفُ ملكيةٍ لا سكربتاتِ ترحيلٍ — المجلدُ لا يحملُ سكربتاتِ الترحيلِ الفعليةَ لأنها تعيشُ في `services/*/db/`) |
| `infra/secrets/` | نعم | 1 ملف (`secret-inventory.json` · 28 سرًا) | **IMPLEMENTED_UNVERIFIED** |

---

## §3 تصنيف المكوّنات (بالملصقات الست للمرحلة صفر)

الملصقات: `VERIFIED_COMPLETE` · `IMPLEMENTED_UNVERIFIED` · `PARTIAL` · `PLACEHOLDER` · `BLOCKED` · `NOT_APPLICABLE_WITH_APPROVAL`. **لا ملصق سابع.** `NOT_PROVEN` قيدُ دليلٍ لا ملصقَ مكوّنٍ.

### §3.1 قاعدة التصنيف (مصححة)

- `IMPLEMENTED_UNVERIFIED` — كودٌ مُتتبَّعٌ موجودٌ ولا يُدَّعى سلوكُهُ في هذه الشريحةِ. **هذا الملصقُ هو الافتراضيُّ لأيِّ مكوّنٍ فيهِ ملفاتٌ فعلية.**
- `PARTIAL` — يُستخدمُ **فقط** عندَ وجودِ متطلبٍ محددٍ غيرِ مُلبّى مُعرَّفٍ بالاسمِ (لا يُستنتجُ من عددِ ملفاتِ الاختبارِ وحده).
- `PLACEHOLDER` — المجلدُ لا يحملُ أيَّ ملفٍ متتبَّعٍ غيرَ `.gitkeep` **و** القرارُ (ADR أو قاعدة ملكية) موثَّقٌ بالاسمِ.
- `VERIFIED_COMPLETE` = **صفرٌ** — لا يُدَّعى في هذه الشريحةِ.
- `BLOCKED` / `NOT_APPLICABLE_WITH_APPROVAL` = **صفرٌ** في هذه الشريحة.

### §3.2 الخدمات الـ27

| الخدمة | ملفات متتبعة | TS (غير اختبار) | TS (اختبار) | الملصق |
|---|---|---|---|---|
| customers | 75 | 34 | 18 | IMPLEMENTED_UNVERIFIED |
| delivery | 156 | 68 | 62 | IMPLEMENTED_UNVERIFIED |
| dispatch | 89 | 42 | 29 | IMPLEMENTED_UNVERIFIED |
| drivers | 88 | 45 | 22 | IMPLEMENTED_UNVERIFIED |
| geography | 58 | 28 | 11 | IMPLEMENTED_UNVERIFIED |
| identity | 62 | 30 | 14 | IMPLEMENTED_UNVERIFIED |
| marketplace | 104 | 51 | 35 | IMPLEMENTED_UNVERIFIED |
| matching | 73 | 35 | 20 | IMPLEMENTED_UNVERIFIED |
| negotiations | 83 | 48 | 21 | IMPLEMENTED_UNVERIFIED |
| orders | 68 | 36 | 16 | IMPLEMENTED_UNVERIFIED |
| partners | 39 | 25 | 9 | IMPLEMENTED_UNVERIFIED |
| reputation | 85 | 46 | 21 | IMPLEMENTED_UNVERIFIED |
| search | 80 | 35 | 23 | IMPLEMENTED_UNVERIFIED |
| subscriptions | 81 | 46 | 21 | IMPLEMENTED_UNVERIFIED |
| support | 40 | 21 | 8 | IMPLEMENTED_UNVERIFIED |
| audit | 26 | 18 | 1 | IMPLEMENTED_UNVERIFIED (تصنيفُ «اختبارٌ واحدٌ» لا يُثبتُ نقصًا — الفحصُ السلوكيُّ للشرائحِ التالية) |
| billing | 53 | 27 | 12 | IMPLEMENTED_UNVERIFIED |
| observability | 10 | 6 | 1 | IMPLEMENTED_UNVERIFIED |
| analytics | 1 | 0 | 0 | PLACEHOLDER (M8 · Phase 21+ · [WORK_INDEX](../../16-progress/WORK_INDEX.md)) |
| auth | 1 | 0 | 0 | PLACEHOLDER (WORK_INDEX) |
| chat | 1 | 0 | 0 | PLACEHOLDER (M5 · Phase 08 · WORK_INDEX) |
| compliance | 1 | 0 | 0 | PLACEHOLDER (M7 · Phase 20 · WORK_INDEX) |
| fraud | 1 | 0 | 0 | PLACEHOLDER (M6-19 · Phase 09 · [ADR-014](../../../15-decisions/ADR-014-reputation-derived-scores-and-fact-sourced-fraud-signals.md)) |
| notifications | 1 | 0 | 0 | PLACEHOLDER (M3 · WORK_INDEX) |
| referrals | 1 | 0 | 0 | PLACEHOLDER (M5-16 · Phase 16 · WORK_INDEX) |
| rides | 1 | 0 | 0 | PLACEHOLDER (M5-15 · Phase 15 · WORK_INDEX) |
| translation | 1 | 0 | 0 | PLACEHOLDER (M8 · Phase 21+ · WORK_INDEX) |

**الملخص:** 18 خدمة `IMPLEMENTED_UNVERIFIED` · 9 خدمات `PLACEHOLDER` · 0 `PARTIAL`.

### §3.3 التطبيقات الخمسة

| التطبيق | ملفات متتبعة | TS (غير اختبار) | TS (اختبار) | الملصق |
|---|---|---|---|---|
| admin-portal | 60 | 30 | 5 | IMPLEMENTED_UNVERIFIED |
| customer-mini-app | 45 | 17 | 2 | IMPLEMENTED_UNVERIFIED |
| driver-mini-app | 60 | 28 | 7 | IMPLEMENTED_UNVERIFIED |
| admin-web | 1 | 0 | 0 | PLACEHOLDER (M3 · WORK_INDEX) |
| partner-mini-app | 1 | 0 | 0 | PLACEHOLDER (M3 · WORK_INDEX) |

### §3.4 البوتات الثلاثة

| البوت | ملفات متتبعة | TS (غير اختبار) | TS (اختبار) | الملصق |
|---|---|---|---|---|
| customer-bot | 16 | 8 | 6 | IMPLEMENTED_UNVERIFIED |
| driver-bot | 16 | 8 | 6 | IMPLEMENTED_UNVERIFIED |
| partner-bot | 7 | 3 | 2 | IMPLEMENTED_UNVERIFIED |

### §3.5 الحزم الـ40

| الحزمة | ملفات متتبعة | TS (غير اختبار) | TS (اختبار) | الملصق |
|---|---|---|---|---|
| contracts | 144 | 47 | 59 | IMPLEMENTED_UNVERIFIED (**مُصحَّحة** — كانت مُصنَّفةً placeholderً زورًا) |
| bot-runtime | 34 | 16 | 16 | IMPLEMENTED_UNVERIFIED |
| service-auth | 30 | 15 | 13 | IMPLEMENTED_UNVERIFIED |
| channel-core | 27 | 13 | 7 | IMPLEMENTED_UNVERIFIED |
| channel-postgres | 24 | 13 | 5 | IMPLEMENTED_UNVERIFIED |
| telegram-adapter | 22 | 11 | 9 | IMPLEMENTED_UNVERIFIED |
| resilience | 16 | 7 | 7 | IMPLEMENTED_UNVERIFIED |
| auth-sdk | 12 | 7 | 3 | IMPLEMENTED_UNVERIFIED |
| authz-policy | 11 | 7 | 2 | IMPLEMENTED_UNVERIFIED |
| channel-edge | 11 | 4 | 1 | IMPLEMENTED_UNVERIFIED |
| observability | 9 | 5 | 2 | IMPLEMENTED_UNVERIFIED |
| outbox | 7 | 4 | 1 | IMPLEMENTED_UNVERIFIED |
| config | 7 | 2 | 2 | IMPLEMENTED_UNVERIFIED |
| tick-scheduler | 7 | 4 | 1 | IMPLEMENTED_UNVERIFIED |
| `*-e2e` (15 حزمةً مُسمّاةً واحدةً واحدةً: app-edge · billing · channel · customer · delivery · dispatch · driver · golden · marketplace · negotiation · order · partners · reputation · search · subscription) | 4–7 لكلٍّ منها | 1–4 | 1–3 | IMPLEMENTED_UNVERIFIED |
| date-time | 1 | 0 | 0 | PLACEHOLDER |
| events | 1 | 0 | 0 | PLACEHOLDER |
| i18n | 1 | 0 | 0 | PLACEHOLDER |
| telemetry | 1 | 0 | 0 | PLACEHOLDER |
| test-utils | 1 | 0 | 0 | PLACEHOLDER |
| ui | 1 | 0 | 0 | PLACEHOLDER |

**الملخص (مُتصحَّح):** 34 حزمةً `IMPLEMENTED_UNVERIFIED` (منها `contracts` ذاتُ الـ12 package.json فرعيًا) · **6** حزمٍ `PLACEHOLDER` (date-time · events · i18n · telemetry · test-utils · ui). 40 = 34 + 6.

### §3.6 البنية التحتية (`infra/`)

| المجلد | ملفات متتبعة | الملصق | أساس |
|---|---|---|---|
| docker | 1 (`.gitkeep` فقط) | PLACEHOLDER | WORK_INDEX |
| kubernetes | 1 (`.gitkeep` فقط) | PLACEHOLDER | WORK_INDEX |
| environments | 7 | IMPLEMENTED_UNVERIFIED | 5 ملفات environment.json |
| observability | 11 | IMPLEMENTED_UNVERIFIED | Dockerfiles + prometheus/alertmanager/otel-collector |
| render | 3 | IMPLEMENTED_UNVERIFIED | ملفات JSON |
| secrets | 1 | IMPLEMENTED_UNVERIFIED | secret-inventory.json (28 سرًا) |
| migrations | 1 | IMPLEMENTED_UNVERIFIED | migration-owners.json (الهجراتُ الفعليةُ تعيشُ في `services/*/db/`) |
| terraform | 16 | IMPLEMENTED_UNVERIFIED | main.tf · environments · variables |
| tls | 1 (`supabase-root-2021-ca.pem` — **ملفٌ حقيقيٌّ لا `.gitkeep`**) | IMPLEMENTED_UNVERIFIED | شهادةُ CA حقيقيةٌ متتبَّعة |


---

## §4 مصفوفة الأثر (شريحة أولى: اتجاه واحد فقط)

هذه الشريحة تنشئ **اتجاهًا واحدًا فقط** من مصفوفة الأثر: المكوّن ← ما هو موجود فعليًا من كود واختبار وعقد. **الاتجاه الثاني** (المتطلب ← المكوّن الذي يبرره) لم يُبنَ في هذه الشريحة — وهذا عملُ الشريحةِ التاليةِ من نفسِ المرحلةِ صفر، **وكذلك خريطة التقاطع (crosswalk)** بينَ متطلباتِ الحزمةِ وأقسامِ الخارطةِ الحاكمةِ القائمة.

---

## §5 الحوكمة وحدود المرحلة صفر

| البند | الحالة |
|---|---|
| المرحلة صفر كاملة | **In Progress** — الشريحة الأولى فقط |
| الشريحة التالية | (أ) الاتجاه الثاني لمصفوفة الأثر من المتطلبات (جرد `docs/01-product/` · `ROADMAP.md` · الخارطة) (ب) خريطة التقاطع بين متطلبات الحزمة وأقسام الخارطة القائمة (ج) تصنيف الفجوات الفعلية (د) التحقق السلوكي للرحلات الحرجة |
| نسبة اكتمال كلية | **غير معلنة** |
| `INC-0007` | مفتوحة (قياس CLM-0578: التدوير لم يحدث) |
| `RISK-0067` | `mitigating` — بلا تغيير |
| `RISK-0066` | `open` — بلا تغيير |
| `M6-18B` | `Blocked` — بلا تغيير |

---

## §6 الحوكمة قبل الدفع (مقيسة)

| الفحصُ | الأمر | النتيجة |
|---|---|---|
| State-sync | `bash scripts/checks/validate-state-sync.sh` | **PASS** |
| Governance (28 فحصاً) | `bash scripts/checks/verify-governance.sh origin/main HEAD` | **نجح** لكلِّ الفحوصِ المُنفَّذةِ — **تنبيهٌ مسمّى:** فحصٌ واحدٌ (8: CI مانعٌ) تخطّي مُعلَنًا على لقطةٍ مؤرَّخةٍ؛ لا يُعدُّ هذا نجاحًا كاملًا |
| خوارزمياتُ تزويرِ الحوكمة | `bash scripts/checks/test-governance.sh` | **691 ناجحًا · 0 فاشلاً** (بعدَ التصحيح) — **تصحيحُ تفسيرٍ سابقٍ:** قلتُ في نسخةٍ سابقةٍ من هذا الدليلِ إنَّ 691 مقابلَ 722 يرجعُ إلى «نطاقِ التغييرِ» — هذا **تفسيرٌ غيرُ مُتحقَّقٍ منه** ولم يُقَس؛ الصحيحُ المُتحقَّقُ أنَّ الرقمَينِ قِيسا على رأسَينِ مختلفَينِ (722 على رأسِ #730 الذي يُضيفُ `scripts/checks/lib/attest_verify_step.py` وحالاتَهُ؛ 691 على رأسِ هذه الشريحةِ) — والفرقُ **لم يُفسَّر** بدقةٍ ولن يُدَّعى تفسيرُهُ هنا. |
| Work claims | `bash scripts/checks/validate-work-claims.sh origin/main HEAD` | **نجح** |
| require-doc-update | `bash scripts/checks/require-doc-update.sh origin/main HEAD` | **نجح** |
| Launch board | `bash scripts/checks/validate-launch-board.sh` | **OK** (119 عنصرًا) |

> الحوكمةُ الكاملةُ **تُقاسُ قبلَ الدفعِ** لا تُوعَد.

---

## §7 الدليل الخام

- [raw-structural-census.json](raw-structural-census.json) — **نسخة الكاشف الأولي** (مُعلَنَةٌ كأثرٍ تاريخيٍّ لا كحقيقةٍ؛ عيوبُها موثَّقةٌ في §2.1)
- [raw-structural-census-fixed.json](raw-structural-census-fixed.json) — **النسخة المصححة** (من `git ls-tree -r` على الرأس · الأرقامُ النهائية)
- [collect-census.py](collect-census.py) — **جامعُ الجردِ القابلُ لإعادةِ التشغيل** (على أيِّ رأسٍ: `python3 collect-census.py <sha>`)
