# CLM-0587 — M0-53 شريحة 2: الاتجاه العكسي لمصفوفة الأثر (الرحلات الحرجة) + تصنيف الفجوات الفعلية + التحقق السلوكي المقيس

> **رأس العمل عند البدء:** `b4d29548de47e7bddead88b4988b71ef4cfa38c3` (main بعد #739) · **وقت القياس:** 2026-10-17T07:30:00Z (UTC).
> **مصدر المتطلبات لهذه الشريحة:** [`docs/01-product/USER_FLOWS.md`](../../../01-product/USER_FLOWS.md) (Baseline v1.0 · 2026-08-19) — مصدر الرحلات الحرجة المعلن في الشريحة الموقوفة.

---

## §1 استيفاء شرط البدء (إزالة الإيقاف — التاريخ محفوظ)

الإيقاف الموقوف (CLM-0582 · 2026-10-17): «كلُّ شريحةٍ لاحقةٍ من M0-53 تعتمدُ على إغلاقِ M0-52 موقوفةٌ حتى يَحسمَ المالكُ (نقلُ M0-52 إلى Completed أو تصريحٌ نصيٌّ بقراءةِ الاعتماد)».

**الحسم وقع:** المالك نقل M0-52 إلى `Completed` بقرارٍ مكتوبٍ (§7 من `M0-52_GATE.md` · CLM-0583 · PR #737 المدموج عبر الحارس). لا يُمحى نصُّ الإيقاف من سجل CLM-0582 — يُوسَم في صف اللوحة بأنه **تاريخي انتهى شرطه** بقرار CLM-0583، والحالة النافذة هي الاستئناف.

## §2 مصفوفة التتبّع العكسي — USER_FLOWS.md (المتطلب ← التنفيذ ← الاختبار ← الدليل المقيس)

**وحدات القياس الثلاث لكل صف** (لا تُخلط): **التنفيذ** (موجود/جزئي/مفقود/placeholder) · **التغطية** (اختبار مناسب/جزئي/مفقود) · **دليل التحقق** (نتيجة التشغيل + البيئة + حدود المحاكاة، بتعريفات المستودع `MEASURED_REAL`/`EMULATED`/`MODEL_ONLY`).

### §2.1 رحلة العميل (§2 في المواصفة)

| # | المتطلب | موضع التنفيذ | الاختبار | دليل التشغيل المقيس | الحكم |
|---|---|---|---|---|---|
| C1 | Start → Identity Bootstrap (ربط Telegram ID بـWasla User) (§2.1) | `services/identity` + `bots/customer-bot` عبر `MockChannelAdapter` (التبديل المصرح به ADR-007) | `customer-e2e` phase04: «creates an identity and a readable profile from a bot /start alone» | تشغيل فعلي 2026-10-17T07:1xZ · 11/11 PASS | **MEASURED_REAL** |
| C2 | إنشاء الطلب: `DRAFT → PUBLISHED → SEARCHING` (§2.1) | `services/orders` · آلة الحالات في `packages/contracts/order`: الحالة الأولى `published` — **لا يوجد `draft` إطلاقًا** (قرار ADR-010 البند 2: «There is no draft») | `order-e2e` phase06 (16 اختبارًا) + فحوص آلة الحالات في الخدمة | تشغيل فعلي · 16/16 PASS | **تنفيذ موجود، والمواصفة متقادمة** (انظر G1) |
| C3 | سلسلة الحالات `ACCEPTED → ASSIGNED → DRIVER_EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED` (§2.1) | نفس العقد: `accepted/assigned/driver_en_route/arrived/in_progress/completed` موجودة حرفيًا | `order-e2e` + `dispatch-e2e` phase07 | تشغيل فعلي · 16/16 + 13/13 PASS | **MEASURED_REAL** |
| C4 | Matching (بحث مرشحين + ترتيب) (§2.1) | `services/matching` (المُرشِّح السابع قراءة تدرج المناطق عبر HTTP حقيقي) + `services/dispatch` (أمواج العروض) | `dispatch-e2e` phase07: «can a real order find a real driver — offer by offer, wave by wave» | تشغيل فعلي · 13/13 PASS | **MEASURED_REAL** |
| C5 | نموذج السعر: اقتراح العميل / بلا سعر → تفاوض (§2.2 · نمطا 1-2) | `services/negotiations` (جولات مرقمة · سياسة مجمّدة `saudi-launch-v1`) | `negotiation-e2e` (8 اختبارات) | تشغيل فعلي · 8/8 PASS | **MEASURED_REAL** |
| C6 | السعر الاسترشادي من WASLA (§2.2 · نمط 3 «لاحقًا») | **غير منفذ** — والمواصفة نفسها تؤجله («لاحقًا») | لا اختبار | لا تشغيل | **مفقود بتصميم** (موثق في المواصفة كإرجاء) |
| C7 | الخصوصية: لا كشف رقم هاتف أو بيانات حساسة قبل القبول (§2.3) | أحداث `orders` لا تحمل إحداثيات ولا نص مستخدم | `customer-e2e`: «publishes no coordinates and no user text in any event» | تشغيل فعلي · PASS | **MEASURED_REAL** |
| C8 | Customer Home UX: 8 عناصر قائمة (§2.4) | `apps/customer-mini-app` | `navigation.spec.ts`: «home shows all 8 menu items» | Playwright فعلي · 35/35 PASS | **MEASURED_REAL** |

### §2.2 رحلة السائق (§3 في المواصفة)

| # | المتطلب | موضع التنفيذ | الاختبار | دليل التشغيل المقيس | الحكم |
|---|---|---|---|---|---|
| D1 | التسجيل → رفع المستندات (هوية/رخصة/استمارة/تأمين/صور مركبة) (§3.1) | `packages/contracts/driver`: أنواع المستندات `national_id · driving_license · vehicle_registration · vehicle_insurance · vehicle_photo` — **مطابقة حرفية لقائمة المواصفة** | `driver-e2e` phase05 | تشغيل فعلي · 14/14 PASS | **MEASURED_REAL** |
| D2 | التحقق الأولي → الأهلية المحسوبة → استقبال العرض → القبول (§3.1) | `services/drivers` (review→eligibility) + `services/dispatch` | `driver-e2e`: «سائق مُراجَع يصير مؤهَّلًا... فيصله عرض من التوزيع فيقبله» + «الأهليّة ليست ادّعاءً: قبل المراجعة لا عرض» | تشغيل فعلي · PASS | **MEASURED_REAL** |
| D3 | Trial Subscription «أول شهر مجاني» (§3.1) | `SUBSCRIPTION_LAUNCH_TRIAL_DAYS = 14` (عقد مجمّد) | فحوص العقد | قياس قيمة | **انحراف قيمة** (انظر G2) |
| D4 | حالات الاشتراك `TRIAL→ACTIVE→GRACE→EXPIRED→COMMUNITY→SUSPENDED→CANCELLED` (§3.2) | العقد: `SUBSCRIPTION_STATES = [trial, active, expired, community]` — **4 حالات لا 7** (قرار موثق: «لا رمز عقابيًّا» البند 4) | فحوص العقد + `subscription-e2e` | قياس قيمة | **انحراف مواصفة** (انظر G3) |
| D5 | أشهر مجانية عبر Referral (§3.2) | `SUBSCRIPTION_PERIOD_SOURCES` تشمل `referral_reward` | فحوص العقد | قياس قيمة | منفذ في العقد |
| D6 | Community Fallback: تصعيد للمجموعة عند غياب قبول (§3.3) | `services/dispatch`: `escalated_community` (غير نهائي) + أحداث قناة المجتمع | فحوص وحدوية للنطاق | لم يُشغَّل مسار مجموعة المدينة (Telegram) في e2e | **جزئي** — تصعيد الخدمة منفذ؛ مسار البوت في المجموعة غير مغطى e2e |
| D7 | القفل الذري للطلب عند قبول سائق (§3.1) | نطاق dispatch (أمواج + قفل) | مغطى ضمن `dispatch-e2e` (13/13) | تشغيل فعلي · PASS | **MEASURED_REAL** |
| D8 | Driver Home UX: 7 عناصر (§3.4) | `apps/driver-mini-app` | مواصفات Playwright | تشغيل فعلي · 34/34 PASS | **MEASURED_REAL** |

### §2.3 رحلة الشريك (§4 في المواصفة)

| # | المتطلب | موضع التنفيذ | الاختبار | دليل التشغيل المقيس | الحكم |
|---|---|---|---|---|---|
| P1 | تسجيل الشريك → إنشاء Store من هوية قائمة (§4.1) | `services/partners` (ADR-055 · 6 محولات Postgres · محرك ويبهوك) | `partners-e2e` phase14 | **NOT_RUN** — البوابة تتطلب Postgres حقيقيًا (`DATABASE_URL`) | تنفيذ موجود؛ تحقق سلوكي **غير مُنفَّذ** (البيئة) |
| P2 | طلبات المتجر → Inventory reserve → Delivery (§4.1) | `services/marketplace` + `services/delivery` | `delivery-e2e` m5-13m + phase13 | **NOT_RUN** — بوابة Postgres | تنفيذ موجود؛ تحقق سلوكي **غير مُنفَّذ** |
| P3 | التسعير: Product + Delivery = Payable (§4.2) | عقد `delivery`: `items_total_minor_units` + `total_minor_units` · أحداث السوق تستبعد التسعير عمدًا (معلن في `events-types`) | مغطى ضمن `delivery-e2e` (DB-gated) | **NOT_RUN** | تنفيذ على مستوى العقد |
| P4 | Partner/Enterprise API (§4.3) | `services/partners` (مفاتيح/ويبهوك/Idempotency) — عنصر اللوحة `M5-14` «Ready for Gate» | نفس بوابات partners | **NOT_RUN** | يتبع حالة M5-14 |
| P5 | Partner Home UX: 8 عناصر (§4.4) | **`apps/partner-mini-app` مجلد `.gitkeep` فارغ** (من جرد CLM-0579) | **لا اختبارات UI إطلاقًا** | لا تشغيل | **غير منفذ** (placeholder) — انظر G5 |

### §2.4 التفاوض متعدد المرشحين (§5) ومبادئ UX (§6)

| # | المتطلب | موضع التنفيذ | الاختبار | دليل التشغيل المقيس | الحكم |
|---|---|---|---|---|---|
| N1 | جولات مرشحين متتابعة عند عدم الاتفاق + إعادة فتح المطابقة (§5) | `services/negotiations`: جولات مرقمة (`roundNotPending`/`roundStale`) — إعادة الفتح عند `max_rounds_reached` | `negotiation-e2e` (8/8) | تشغيل فعلي · PASS | **MEASURED_REAL** |
| N2 | «10s لكل مرشح» و3 مرشحين (§5) | السياسة المجمّدة `saudi-launch-v1` (تُزرع في `schema.sql` وتقيّم في العقد): `round_ttl_seconds = 120` · `max_rounds = 5` | فحوص العقد | قياس قيمة | **انحراف قيمة** (انظر G4) |
| N3 | لا يُعاد عرض الطلب لنفس المرشحين في نفس الجولة (§5) | `roundStale` (رفض جولة متقادمة برقم جولة) | ضمن `negotiation-e2e` | تشغيل فعلي · PASS | **MEASURED_REAL** |
| N4 | Countdown ظاهر للمستخدم (§5) | `round_ttl_seconds` مقيم في العقد لعرض العداد التنازلي (تعليق موثق في العقد) | واجهة العرض في البوتات | غير مغطى e2e على مستوى الواجهة | جزئي |
| N5 | السعر المتفق عليه يصبح مرجع الرحلة + Data point (§5) | `services/orders/domain/agreed-price.ts` + محرك الطلبات يحمل الرقم | `negotiation-e2e`: «have the ORDER ENGINE end up holding that number» | تشغيل فعلي · PASS | **MEASURED_REAL** |
| U1 | مبادئ UX (§6): وضوح/لا تعليق صامت/أخطاء تشرح الحل | `apps/customer-mini-app` | `frontend-quality.spec.ts` (locale/RTL · offline banner · overflow) + `order-flow.spec.ts` (submit error shows error message) + `accessibility.spec.ts` (axe-core على 9 شاشات) | Playwright فعلي · 35/35 PASS | **MEASURED_REAL** |

## §3 تصنيف الفجوات الفعلية (المقيسة)

| # | الفجوة | النوع | الدليل | الإجراء المطلوب |
|---|---|---|---|---|
| G1 | المواصفة تقول `DRAFT → PUBLISHED` والتنفيذ لا يملك `draft` إطلاقًا (قرار ADR-010 البند 2) | **تقادم مواصفة** (التنفيذ موثق بقرار) | `packages/contracts/order`: «The one and only initial state. There is no `draft` (ADR-010 decision 2)» | قرار مالك: تحديث USER_FLOWS §2.1 أو إلغاء تعليق |
| G2 | المواصفة: تجربة «أول شهر مجاني» · القيمة المجمّدة: 14 يومًا | **انحراف قيمة** (أيّهما النافذ؟) | `SUBSCRIPTION_LAUNCH_TRIAL_DAYS = 14` | قرار مالك: أي المصدرين نافذ |
| G3 | المواصفة: 7 حالات اشتراك · العقد: 4 (`trial/active/expired/community`) بقرار موثق (لا رمز عقابيًّا) | **تقادم مواصفة** | `packages/contracts/subscription` + تعليق «القرار 4» | قرار مالك: تحديث §3.2 |
| G4 | المواصفة: 10 ثوانٍ/مرشح · السياسة المجمّدة: 120 ثانية/جولة و5 جولات | **انحراف قيمة** | `services/negotiations/contracts/schema.sql`: `VALUES (1, 'saudi-launch-v1', 'SAR', 500, 500000, 5, 120, 900, ...)` | قرار مالك: تحديث §5 أو نسخة سياسة جديدة |
| G5 | واجهة الشريك (`apps/partner-mini-app`) غير منفذة — مجلد `.gitkeep` فارغ | **تنفيذ مفقود** (placeholder معلن في الجرد) | `ls apps/partner-mini-app` → `.gitkeep` فقط | عنصر عمل قائم (ليس فجوة توثيق) |
| G6 | رحلة الشريك سلوكيًّا (partners/marketplace/delivery e2e) **لم تُتحقق** — بوابات Postgres | **فجوة تغطية قابلة للتشغيل** (البيئة لا التنفيذ) | تشغيل 2026-10-17: `marketplace-e2e` 12 skipped · `partners-e2e` 8 skipped · `subscription-e2e` 3 skipped · `billing-e2e` 3 skipped · `delivery-e2e` 19/20 skipped · `search-e2e` 21/22 skipped · `channel-e2e` 25/52 skipped | بيئة Postgres تدميريّة (لا الإنتاج) — شريحة مستقبلية أو قرار مالك |
| G7 | `golden-e2e` (39 اختبارًا ضد staging حي) — لم يُشغَّل | **فجوة تغطية بيئة** | 39/39 skipped بلا `GOLDEN_STAGING_BASE` | قرار مالك: بيئة staging (وبحذر INC-0007) |
| G8 | مسار مجموعة مجتمع السائقين (بوت المدينة) غير مغطى e2e | **فجوة تغطية جزئية** | §2.2 D6 | عنصر اختبار مستقبلي |

**قاعدة القراءة:** G1-G4 فجوات **توثيق/قيمة** تحتاج قرار مالك (المواصفة أم العقد/السياسة) — لم يُصحَّح أيٌّ منها في هذه الشريحة. G5 فجوة تنفيذ معلنة. G6-G8 فجوات تغطية قابلة للإغلاق ببيئات/شرائح مستقبلية.

## §4 التحقق السلوكي المقيس (تشغيل فعلي 2026-10-17T07:10-07:45Z · محلي · node v20 · pnpm 9.15.9)

| الجناح | ماذا يثبت | النتيجة المقيسة | حدود المحاكاة المعلنة |
|---|---|---|---|
| `customer-e2e` (phase04) | عميل → نواة عميل → محرك طلبات | **11/11 PASS** (2.3s) | `MockChannelAdapter` (تبديل ADR-007) + كعب محرك الطلبات (حد مرحلة) · identity/geography حقيقية عبر HTTP |
| `driver-e2e` (phase05) | تسجيل → أهلية → عرض → قبول | **14/14 PASS** | كل المسار حقيقي عبر HTTP (identity · dispatch · matching) |
| `order-e2e` (phase06) | دورة حياة الطلب على العقد المنشور | **16/16 PASS** | identity/geography حقيقية · كعب العميل المعلن |
| `dispatch-e2e` (phase07) | طلب حقيقي يجد سائقًا موجةً موجة | **13/13 PASS** (ملفان) | 6 خدمات عبر HTTP حقيقي · تدرج المناطق ليس كعبًا |
| `negotiation-e2e` | تفاوض → محرك الطلبات يحمل السعر | **8/8 PASS** | حقيقي عبر HTTP |
| `reputation-e2e` | سمعة السائق | **12/12 PASS** | — |
| `app-edge-e2e` | جلسة الحافة | **2/2 PASS** | — |
| `channel-e2e` | قناة البوت + جلسات الهوية | **27 PASS · 25 skipped** | الجزء المتخطى يتطلب Postgres (G6) |
| `search-e2e` | بحث المنتجات | **1 PASS · 21 skipped** | الجزء المتخطى Postgres (G6) |
| `delivery-e2e` | توصيل متعدد الأصناف | **1 PASS · 19 skipped** | الجزء المتخطى Postgres (G6) |
| `marketplace/partners/subscription/billing-e2e` | السوق/الشركاء/الاشتراك/الفواتير | **skipped كليًا (12+8+3+3)** | تتطلب Postgres (G6) |
| `golden-e2e` | رحلات staging الحية | **39/39 skipped** | يتطلب `GOLDEN_STAGING_BASE` (G7) |
| `customer-mini-app` (Playwright) | رحلات واجهة العميل (طلب/أماكن/تنقل/جودة/وصولية) | **35/35 PASS** (19.2s) | API محاكاة في طبقة المسار — **معلنة في رأس الملف** (تثبت الواجهة لا التكامل الخلفي) |
| `driver-mini-app` (Playwright) | رحلات واجهة السائق | **34/34 PASS** (19.6s) | نفس الإعلان |
| `admin-portal` (Playwright) | رحلات واجهة الإدارة | **30/30 PASS** (13.5s) | نفس الإعلان |

**السجلات الخام:** مسار `/tmp/journey-runs/` في جلسة التنفيذ (ملف log لكل جناح) — مذكورة هنا لأن الشريحة توثيقية ولا تضيف سجلات سوى الأدلة المجمّدة في المستودع. **ملاحظة تشغيلية مسجلة:** تشغيل Playwright الأول فشل (35/35) لعدم تطابق نسخة المتصفح (المثبت 1217 والمطلوب 1243) — حُدِّث المتصفح (`playwright install chromium`) وأعيد التشغيل فنجح. لا يُدّعى أن المحاولة الأولى لم تحدث.

## §5 الحدود المعلنة لهذه الشريحة

1. **المصادر غير المتتبعة بعد:** `VISION.md` · `SERVICES.md` · `CUSTOMER_MINI_APP_SPEC.md` · `DRIVER_MINI_APP_SPEC.md` · `ADMIN_MVP_SPEC.md` · `FRONTEND_UX_QUALITY_SPEC.md` · `ROADMAP.md` · الخارطة الحاكمة — الاتجاه العكسي **غير مكتمل**، وM0-53 يبقى `In Progress`.
2. **لا نسبة اكتمال** إجمالية للمرحلة صفر تُعلن من هذه الشريحة.
3. **لم يُصحَّح أي انحراف مواصفة** (G1-G4) — التصحيح قرار مالك لأنه يمس مصدر الحقيقة.
4. القياسات السلوكية محلية (in-memory) إلا ما ذُكر — لا ادّعاء تحقق staging/إنتاج هنا.

## §6 الحزمة المحلية (تُقاس قبل الدفع وتُوثق هنا)

| الفحص | النتيجة |
|---|---|
| `validate-state-sync.sh origin/main HEAD` | (يُملأ قبل الـcommit) |
| `verify-governance.sh origin/main HEAD` | (يُملأ قبل الـcommit) |
| `test-governance.sh` | (يُملأ قبل الـcommit) |
| `validate-work-claims.sh origin/main HEAD` | (يُملأ قبل الـcommit) |
| `validate-merged-branches.sh` | (يُملأ قبل الـcommit) |
| `validate-launch-board.sh` | (يُملأ قبل الـcommit) |
