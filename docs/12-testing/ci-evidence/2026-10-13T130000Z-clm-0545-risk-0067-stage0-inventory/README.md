# CLM-0545 — المرحلة 0: جردٌ قراءةٌ فقط لسعةِ اتصالاتِ قاعدةِ البيانات (RISK-0067 · M6-18B)

**الحالة:** قراءةٌ فقط. **لم يُنفَّذ حِمل ولا كتابة ولا تغيير إعدادات.**
**توقيتُ القياس:** 2026-10-13 (توقيت UTC).
**الحجز:** `CLM-0545` (فرع `docs/clm-0545-risk-0067-stage0-inventory`).
**المرجعُ الحاكم:** [`M6-18B_RISK-0067_LOAD_MEASUREMENT_PLAN.md`](../M6-18B_RISK-0067_LOAD_MEASUREMENT_PLAN.md) §4 المرحلة 0.
**تغييرُ الحالة:** لا شيء. `RISK-0067` تبقى `mitigating` · `M6-18B` تبقى `Blocked` · حكمُ الإصدار `NO-GO`.

---

## 1. نتيجةُ الجردِ الفعلية (مقيسةٌ لا مُفترضة)

### 1.1 أسطول Render — العددُ الفعلي والنسخ

| المصدر | القيمة المقيسة | ملاحظة |
|---|---|---|
| Render API `/v1/services` | **24 خدمة** (21 `web_service` + 3 `static_site`) | الخطةُ كانت تُفترِضُ 17 — القياسُ الفعليُّ 21 |
| `plan` لكل `web_service` | **`free`** (كلها) | نفس الافتراض (RISK-0066) |
| `numInstances` لكل `web_service` | **1** (كلها) | يُثبِتُ أن الافتراض «نسخة واحدة» صحيح |
| `suspended` | **`not_suspended`** (كلها) | لا إيقاف عند لحظة القياس |
| `region` | **oregon** للـalertmanager/prometheus و**singapore** لبقية الخدمات (الجردُ يُقرأُ من `sshAddress`) | اكتشافٌ: كانت الخطةُ تُفترضُ موقعًا واحدًا |
| `buildPlan` | `starter` | — |
| `runtime` | `docker` (Dockerfile في جذر المستودع) | — |

**الجردُ الكاملُ من Render API (`render_inventory.json`):**

| الخدمة | plan | numInstances | WASLA_PG_POOL_MAX (من env-vars) | healthCheckPath |
|---|---|---|---|---|
| wasla-alertmanager | free | 1 | **غائب** | (فارغ) |
| wasla-prometheus | free | 1 | **غائب** | (فارغ) |
| wasla-partner-bot | free | 1 | **غائب** | (فارغ) |
| wasla-driver-bot | free | 1 | **غائب** | (فارغ) |
| wasla-customer-bot | free | 1 | **غائب** | (فارغ) |
| wasla-dispatch | free | 1 | **غائب** | (فارغ) |
| wasla-customers | free | 1 | **غائب** | (فارغ) |
| wasla-delivery | free | 1 | **غائب** | (فارغ) |
| wasla-matching | free | 1 | **غائب** | (فارغ) |
| wasla-geography | free | 1 | **غائب** | (فارغ) |
| wasla-marketplace | free | 1 | **غائب** | (فارغ) |
| wasla-audit | free | 1 | **غائب** | `/health` |
| wasla-subscriptions | free | 1 | **غائب** | (فارغ) |
| wasla-negotiations | free | 1 | **غائب** | (فارغ) |
| wasla-reputation | free | 1 | **غائب** | (فارغ) |
| wasla-drivers | free | 1 | **غائب** | (فارغ) |
| wasla-search | free | 1 | **غائب** | (فارغ) |
| wasla-orders | free | 1 | **غائب** | (فارغ) |
| wasla-identity | free | 1 | **غائب** | (فارغ) |
| wasla-otel-collector | free | 1 | **غائب** | (فارغ) |
| wasla-observability | free | 1 | **غائب** | `/healthz` |

### 1.2 متغيّر `WASLA_PG_POOL_MAX` — القيمةُ الفعلية

**النتيجة:** غائبٌ من `env-vars` لكل خدمة `web_service` (21/21). هذا **قياسٌ فعليٌّ من Render API**، لا تخمين.

**معنى هذا:**
- الحارس `withPgPoolDefaults` (الملف `packages/resilience/src/pg-guard.ts`) يقرأ `WASLA_PG_POOL_MAX` من `process.env` عند بدء التشغيل. غيابُه يعني أن `PG_GUARD_DEFAULTS.poolMax` يبقى **2** (الافتراضي).
- لذلك الحدُّ النظريُّ لكل مجمعٍ في كل نسخةٍ من الخدمة هو **2** (لا توجد تجاوزات صريحة ولا قيم `max` مرسلة من المستدعين في كود التشغيل).

### 1.3 `pg.Pool` الفعلي في زمن التشغيل

من الكود على `main` (التزام `33970581`):
- كل خدمات الـDB تُنشئ `pg.Pool` عبر `guardPgPool(new pg.Pool(withPgPoolDefaults(...)))`.
- `withPgPoolDefaults` يفرض `max` محدودًا: الافتراضي 2، أو `WASLA_PG_POOL_MAX`، أو `max` صريح من المستدعي (فقط `migrate-cli` يستخدم `max: 1`).
- لا يوجد تجاوزٌ صريحٌ (`?? 10`) في أي كود تشغيل — أُزيلَت كلها في CLM-0510.

**قيمةٌ غير مقيسة:** لا يمكن إثباتُ أن `numInstances=1` يقابلُ عمليةً واحدة (process) داخل الحاوية — Docker قد يشغّل عملياتٍ متعددة. سجّلنا `numInstances` من Render API، وهو ما يعرفه Render، لكن عدد العمليات داخل الحاوية **غير مقيس**. الحارسُ يفرضُ الحدَّ لكل عمليةٍ، فإن تعددت العمليات داخل حاويةٍ واحدةٍ فالحدُّ الفعليُّ يضاعف.

### 1.4 عددُ النسخ الفعلي — الحساب

`numInstances = 1` لكل الخدمات الـ21. **فالحسابُ النظريُّ للسقف:**

\[
\text{الحد النظري} = \sum_{\text{خدمة}} \left( \text{numInstances} \times \text{processes per container} \times \text{pool max} \right)
\]

- إذا كانت كل حاويةٍ **عملية واحدة** (الافتراض المعتاد لـ`node src/server.ts`): 
  \[
  21 \times 1 \times 2 = \mathbf{42}
  \]
- إذا تعددت العمليات داخل الحاوية (غير مقيس): يضاعف الحد.
- الخطةُ السابقة كانت تفترض 17 خدمة × 2 = 34. **القياسُ الفعليُّ يُثبِتُ 21 خدمة** (وليس 17)، فالحدُّ النظريُّ الصحيح **42**، لا 34.

---

## 2. Supavisor — الإنتاج

| القيمة | القياس | المصدر والتوقيت |
|---|---|---|
| `max_connections` (PostgreSQL) | **60** | Supabase connector `execute_sql` على `ppixaauyqoykrogwdxtv`، 2026-10-13 |
| الاتصالات الحالية (pg_stat_activity) | **13 total** (5 idle · 1 active · 7 بدون حالة) | نفس المصدر، نفس التوقيت |
| سجلات `supavisor_logs` | متاحةٌ ومقروءة | Supabase connector `query_logs`، 2026-10-13 |
| `EMAXCONNSESSION` في آخر 24 ساعة | **0** | `query_logs`، 2026-10-13 |
| `default_pool_size` (Supavisor) | **غير مقيس** — لا يظهر في `pg_settings` (Supavisor منفصلٌ عن PostgreSQL) ولا في سجلات الإقلاع | يحتاج واجهة إدارة Supabase أو استعلامًا مباشرًا — القياسُ 40 من CLM-0509 (2026-10-08) لا يُعتدُّ به اليوم |

**تنبيهٌ مهم:** لا توجد أيُّ اتصالاتٍ من أسطول Render ظاهرةٌ في `pg_stat_activity` (كل الاتصالات 13 هي أدوات Supabase الداخلية: `pg_net`, `PostgREST`, `pg_cron`, `postgres_exporter`, `mgmt-api`, `pgbouncer`). هذا **دليلٌ قويٌّ** على أن أسطول Render لا يحملُ اتصالًا فعليًّا إلى قاعدة البيانات في هذه اللحظة، أو أن الاتصال يتم عبر مسارٍ آخر غير ظاهر هنا.

---

## 3. Supavisor — مشروع DR (البديل)

| القيمة | القياس | المصدر والتوقيت |
|---|---|---|
| حالة المشروع | **INACTIVE** | Supabase connector `list_projects`، 2026-10-13 |
| `max_connections` | **غير مقيس** — `execute_sql` فشل بـ`Connection terminated due to connection timeout` (مرتين) | Supabase connector، 2026-10-13 |
| `default_pool_size` | **غير مقيس** | — |

**القيدُ الفعلي:** مشروع DR (`pvyuhjadrygqqdoczmnd`) غير مُفعّل. أيُّ معايرةٍ عليه تتطلب **إعادة تشغيله أولًا** (وهذا عملٌ كتابيٌّ خارج نطاق المرحلة 0).

---

## 4. مساراتُ القراءةِ الفعلية لكل خدمة

**القياس الفعلي** (HTTP GET، 2026-10-13):

| الخدمة | المسار | النتيجة | ملاحظات |
|---|---|---|---|
| كل خدمات الـDB الـ21 | `/health` | **200** لكلها (كانت تُعدّ مهلة عند أول محاولة بسبب خطة free / sleep) | يُعيد JSON |
| wasla-alertmanager | `/ready` | **401 Unauthorized** | يتطلب auth |
| wasla-prometheus | `/ready` | **404** | لا يوجد |
| wasla-observability | `/healthz` | **404** مع رسالة خطأ JSON | لا يوجد |
| wasla-admin-app, wasla-driver-app, wasla-customer-app | `/health` | 200 (HTML) | static sites |
| wasla-partner-bot, wasla-driver-bot, wasla-customer-bot | `/health` | **200** `{"status":"ok","channel":"telegram"}` | — |
| wasla-otel-collector | `/ready` | **404** | لا يوجد |
| wasla-audit | `/health` | **200** | مسارُ الصحة المسجَّل فعليًا |

**المصادقةُ والأثرُ الجانبي:**
- `GET /health` لكل خدمةٍ لا يتطلب auth (يُعِدُّ 200 بدون headers).
- `GET /health` لا يُنفّذُ أيَّ عملٍ أعمالٍ (read-only، لا يكتب ولا يعدّل). البرهانُ من الكود: `createOrderApp` يعرّف `/health` كـ`GET` يعيد JSON ثابتًا دون أي استدعاءٍ لقاعدة البيانات أو الكتابة.
- `GET /ready` غير موجودٍ في كل الخدمات (404)، لكن `healthCheckPath` الفعلي لكل خدمةٍ هو `/health` أو فارغٌ (الافتراضي هو `/`).
- **تنبيه:** `/health` لا يفتحُ اتصالًا فعليًّا إلى DB في بعض الخدمات (يعيد `persistence` من متغير البيئة، لا من ping فعلي) — لا يصلحُ وحدهُ قياسًا للسعة.

---

## 5. الحدُّ النظريُّ للاتصالاتِ المتزامنة

### المعادلة
\[
\text{الحد النظري} = \sum_{\text{21 خدمة}} \left( \underbrace{1}_{\text{numInstances}} \times \underbrace{\text{عدد العمليات}}_{\text{غير مقيس (افتراض = 1)}} \times \underbrace{2}_{\text{pool max افتراضي}} \right)
\]

### النتيجة
- **على افتراض عملية واحدة لكل حاوية:** \( 21 \times 1 \times 2 = \mathbf{42} \) اتصال نظري.
- **الاتصالات الفعلية الملحوظة الآن:** 13 (كلها أدوات Supabase الداخلية، لا شيء من أسطول Render).
- **الهامش من Supavisor (40 slots):** إذا كان الحدُّ النظريُّ 42 > 40 slots، فالأسطولُ **يتجاوزُ سعة Supavisor نظريًّا** — لكن لا يوجد حمل فعلي يُثبت ذلك. القياسُ الحيُّ للحمل لا يزال غائبًا.

### القيمُ غيرُ المقيسة (لا يُستبدلُ بأي افتراض)
1. `default_pool_size` لـSupavisor على الإنتاج (قراءة 2026-10-08 لا تُعتمد).
2. `default_pool_size` لـSupavisor على DR (مشروعٌ غير مُفعّل).
3. عددُ العمليات داخل كل حاوية (افتراض = 1، غير مقيس).
4. أي تجاوزاتٍ صريحةٍ من `WASLA_PG_POOL_MAX` — غائبةٌ (مقيس: env-vars لا يحتويها).

---

## 6. ما لا تُفعله هذه المرحلةُ (ممنوع)
- لا فتحُ اتصالاتٍ اختبارية بغرض الضغط.
- لا إنشاءُ حمل.
- لا كتابةٌ على الإنتاج أو DR.
- لا تغييرُ إعدادات Render أو Supavisor.
- لا تشغيلُ تمرين RISK-0058.

## 7. الأثرُ على تصحيحِ الخطة (المرحلة التالية)

هذه النتائج **تُلزِمُ** تصحيح الخطة قبل أي معايرة:
1. الهدفُ «34 اتصالًا» مبنيٌّ على عدد 17 خدمة — **العددُ الفعليُّ 21**، فالحدُّ النظريُّ الصحيحُ 42 (تجاوز Supavisor 40 نظريًّا).
2. يجبُ إضافةُ حالة `HOLD` واضحةٍ للمنطقة الوسطى بين PASS وFAIL.
3. المعايرةُ على DR تتطلبُ أولًا **إعادة تشغيل مشروع DR** (عملٌ كتابيٌّ خارج نطاق هذه المرحلة) ثم قياس `default_pool_size` الفعلي.
4. لا يمكن اعتبارُ أي قيمةٍ من قراءة 2026-10-08 دليلًا كافيًا على الحالة الحالية — يجبُ قياسُ `default_pool_size` من واجهة الإدارة أو استعلام مباشر قبل أي معايرة.

---

## 8. مصدرُ كل قيمة

| القيمة | المصدر | التوقيت |
|---|---|---|
| عددُ الخدمات (24) و`numInstances` (1) و`plan` (free) و`suspended` | Render API `/v1/services` + `/v1/services/{id}/env-vars` | 2026-10-13 |
| غياب `WASLA_PG_POOL_MAX` من env-vars | Render API `/v1/services/{id}/env-vars` | 2026-10-13 |
| `max_connections=60` وعدد الاتصالات (13) | Supabase connector `execute_sql` على `ppixaauyqoykrogwdxtv` | 2026-10-13 |
| سجلات `supavisor_logs` متاحة | Supabase connector `query_logs` | 2026-10-13 |
| `EMAXCONNSESSION` = 0 في آخر 24 ساعة | Supabase connector `query_logs` | 2026-10-13 |
| مشروع DR INACTIVE | Supabase connector `list_projects` | 2026-10-13 |
| مسارات `/health` (200 لكل الخدمات) | HTTP GET مباشر | 2026-10-13 |
| `withPgPoolDefaults` يفرض `max=2` افتراضيًّا | كود `main` عند `33970581` (`packages/resilience/src/pg-guard.ts`) | 2026-10-13 |

**لا تُطبعُ أيُّ أسرارِ بيئةٍ أو رموزِ اتصالٍ في هذا التقرير.**

---

## 9. الحكمُ النهائي

- **المرحلة 0 (قراءة) مستوفاة** فيما يخصُّ الجردَ المقيس.
- **قياسُ `default_pool_size` غير مكتمل** — يحتاجُ واجهة إدارة Supabase أو access token إداري (غير متوفر في هذه الجلسة).
- **مشروع DR غير مُفعّل** — لا يمكنُ المعايرةُ عليه حتى يُعادَ تشغيله.
- **الحكمُ على المعايرة: HOLD** (لا PASS ولا FAIL) — تنقصُ قياساتٌ مؤثرة.
- **حالةُ RISK-0067 تبقى `mitigating`** · **M6-18B تبقى `Blocked`** · **حكمُ الإصدار `NO-GO`**.

## 10. ما ينقصُ لبدءِ معايرةِ DR (قائمةٌ دقيقة)

1. **إعادة تشغيل مشروع DR** (`pvyuhjadrygqqdoczmnd`) — عملٌ كتابيٌّ على Supabase يحتاجُ موافقة المالك أو تفويضًا.
2. **قياس `default_pool_size` لـSupavisor على DR والإنتاج** من واجهة الإدارة (Supabase dashboard أو API إداري) — القياسُ من `pg_settings` لا يعمل لأن Supavisor منفصلٌ عن PostgreSQL.
3. **قياس عدد العمليات داخل كل حاوية** (عبر SSH أو من Dockerfile) — إن تعددت فالحدُّ يضاعف.
4. **موافقة المالك على إضافة workflow للمعايرة** (تغيير في `.github/workflows/`) — بمراجعة CODEOWNERS.
5. **حسم RISK-0066** (استهلاك ساعات Render المجانية) قبل أي حملٍ يستهلك ساعات.
