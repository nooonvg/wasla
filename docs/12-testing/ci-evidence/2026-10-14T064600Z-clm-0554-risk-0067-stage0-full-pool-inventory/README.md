# CLM-0554 — RISK-0067 · المرحلة 0: جردُ المجمعاتِ الكاملُ من الكود والمنصّة (قراءةٌ فقط)

- **الحجز:** CLM-0554 (حجزٌ ثانٍ على فرعِ CLM-0551 وفقَ WORK_CLAIM_RULE §6 — لا يُوسَّعُ حجزٌ بعدَ بدءِ الكتابة).
- **الفرع / PR:** `docs/clm-0551-risk-0067-stage0-pool-map-correction` · PR #708.
- **المرجعُ البرمجيّ:** main عند `79729e07` (الكودُ الذي يعملُ على Render — كلُّ الخدماتِ الـ21 `live` على هذا الالتزامِ بعدَ إعادةِ نشرِ `wasla-search` في 2026-10-14T06:47:35Z؛ انظر §6).
- **النطاق:** قراءةٌ فقط. لا حِملَ، لا اتصالاتٍ اختباريةً للضغط، لا كتابةَ على الإنتاج أو DR، لا تغييرَ لإعداداتِ Render أو Supavisor، لا تمرينَ RISK-0058، لا تعديلَ لخطةِ القياس (حجزٌ مستقلٌّ لاحق).
- **الحالةُ لا تتغيّر:** RISK-0067 `mitigating` · M6-18B `Blocked` · حكمُ الإصدار `NO-GO`.

## 1. الخلاصة

**الحدُّ النظريُّ لاتصالاتِ أسطولِ Render المتزامنةِ نحو Supavisor = 104 لا 28 ولا 42 ولا 34.**

| مصدر الرقم | القيمة | لماذا خاطئ / صحيح |
|---|---:|---|
| CLM-0510 (اختبار `pg-guard.test.ts:116`) | 17 × 2 = 34 | يَعُدُّ مجمعًا واحدًا لكلِّ خدمة ويُغفلُ مجمعَ `service-auth-replay` ومجمعاتِ البوتات. |
| CLM-0545 §1.4/§5 | 21 × 2 = 42 | يَعُدُّ خدماتٍ بلا قاعدةِ بيانات (otel-collector · observability · alertmanager · prometheus) ويُغفلُ مجمعَ الإعادة. |
| CLM-0551 (`pool-map.md` على هذا الفرع) | 14 × 2 = 28 | يصنّفُ البوتاتِ الثلاثةَ «غيرَ DB» خطأً، ويُغفلُ مجمعَ الإعادة. **مُصحَّحٌ هنا بالإضافة.** |
| **CLM-0554 (هذا الجرد)** | **104** | 14 خدمة × (2 + 4) + customer-bot (2 + 2 + 4) + driver-bot (2 + 4) + partner-bot (2 + 4). |

الحدُّ 104 أكبرُ من `pool_size` لجلسةِ Supavisor (آخرُ قراءةٍ موثّقة 40 بتاريخ 2026-10-08 — **غيرُ مُقاسةٍ اليوم**، §4) وأكبرُ من `max_connections` لـPostgreSQL (60، مُقاسةٌ اليوم). أي أنّ إجراءَ CLM-0510 (`max=2` لكلِّ مجمع) **لا يحدُّ الطلبَ النظريَّ تحتَ السقف**؛ الشرطُ الأوّلُ لإغلاقِ RISK-0067 («تغييرٌ مدموجٌ يحدُّ الطلب») لم يتحقّقْ نظريًّا. هذا اكتشافٌ جديدٌ مسجَّلٌ في RISK_REGISTER تحتَ RISK-0067 (§7)، وإصلاحُه حجزٌ مستقلٌّ لاحقٌ لا يدخلُ هذا الـPR.

## 2. الجرد لكلِّ خدمة (Render API · 2026-10-14T06:51:19Z)

المصدرُ الكاملُ القابلُ للآلة: [`pool-inventory.json`](./pool-inventory.json) (أسماءُ المفاتيحِ فقط، لا قيمَ سرية).

- **عدد خدمات Render:** 24 = 21 `web_service` + 3 `static_site` (admin-app · customer-app · driver-app).
- **numInstances = 1** لكلِّ الخدماتِ الـ21، الخطةُ `free`، المنطقةُ `singapore`، لا خدمةَ معلّقة.
- **مجموعةُ البيئة `wasla-prod-db`** (evg-db40ojmb7d7c739u51jg، آخرُ تعديل 2026-10-08T21:34:06Z): مفتاحانِ فقط `DATABASE_URL` و`CUSTOMER_DATABASE_URL`، مربوطةٌ بـ**17** خدمة = الـ14 خدمةَ مجالٍ + البوتاتُ الثلاثة. (CLM-0551 فحصَ env-vars الخدمةِ وحدَها ولم يفحصْ مجموعةَ البيئة — هذا سببُ تصنيفِ البوتاتِ «غيرَ DB».)
- **`WASLA_PG_POOL_MAX` غائبٌ** عن env-vars الخدماتِ الـ21 وعن مجموعةِ البيئة ⇒ القيمةُ الفعّالةُ لكلِّ مجمعٍ لا يحدّدُ المستدعي حدَّه = `PG_GUARD_DEFAULTS.poolMax` = **2** (`packages/resilience/src/pg-guard.ts:56`).
- **هدفُ الاتصال:** `DATABASE_URL` و`CUSTOMER_DATABASE_URL` كلاهما Supavisor `aws-0-ap-south-1` على المنفذ **5432 (وضعُ session)**، بنفسِ المستأجرِ والمستخدمِ وقاعدةِ البيانات (قورِنتْ دونَ طباعةِ القيم) ⇒ كلُّ المجمعاتِ تتنافسُ على **مجمعِ Supavisor واحد** (`tenant ppixaauyqoykrogwdxtv · mode :session · user postgres · db postgres` — مؤكَّدٌ من `supavisor_logs`).

| خدمة Render | نسخ | المجمعات (الحدّ · المصدر) | لكل نسخة | الإجمالي |
|---|---:|---|---:|---:|
| wasla-audit · customers · delivery · dispatch · drivers · geography · identity · marketplace · matching · negotiations · orders · reputation · search · subscriptions (14) | 1 | مجمعُ الخدمة 2 (افتراضي) + `service-auth-replay` **4 (صريح)** | 6 | 84 |
| wasla-customer-bot | 1 | `channel-postgres` 2 + customers (جهة البوت، `CUSTOMER_DATABASE_URL`) 2 + `service-auth-replay` 4 | 8 | 8 |
| wasla-driver-bot | 1 | `channel-postgres` 2 + `service-auth-replay` 4 (مجمعُ drivers لا يُنشأ: `DRIVER_DATABASE_URL` غائب) | 6 | 6 |
| wasla-partner-bot | 1 | `channel-postgres` 2 + `service-auth-replay` 4 | 6 | 6 |
| wasla-otel-collector · observability · alertmanager · prometheus (4) | 1 | لا مجمع (غيرُ مربوطةٍ بمجموعةِ البيئة، ولا `pg.Pool` في الكود) | 0 | 0 |
| **المجموع** | | | | **104** |

**الصيغة:** \( \sum_{s} \text{numInstances}_s \times \sum_{p \in s} \text{max}_p \).

### 2.1 التجاوزاتُ الصريحةُ من المستدعي

| الموضع | القيمة | الأثر |
|---|---:|---|
| `packages/service-auth/src/replay-store.ts:104` — `withPgPoolDefaults({ connectionString, max: 4 })` | 4 | `withPgPoolDefaults` لا يتجاوزُ قيمةً حدّدها المستدعي، فـ`WASLA_PG_POOL_MAX` **لا يحكمُ** هذا المجمع. يُنشأُ في كلِّ عمليةٍ (17 على Render) لأنّ `WASLA_SERVICE_TOKEN_REPLAY_MODE` غائبٌ ⇒ النمطُ `postgres` (`replay-store.ts:58-60`) والوصلةُ تسقطُ إلى `DATABASE_URL`. يُفتحُ **كسولًا** عندَ أوّلِ طلبٍ مصادَقٍ برمزِ خدمة (`replay-store.ts:228-247`) — فوجودُه في الحدِّ النظريِّ ثابتٌ وإن لم يُفتحْ في الخمول. |
| `services/billing/src/http/server.ts:81` (`sourcePool`) `max: 2` | 2 | billing غيرُ مُنشرٍ على Render ⇒ 0 في الأسطولِ الحيّ. |

لا تجاوزاتٍ أخرى في كودِ زمنِ التشغيل (`rg "new (pg\.)?Pool\(|withPgPoolDefaults\("` خارجَ الاختباراتِ وأدواتِ CLI).

### 2.2 اتصالاتُ الأدوات وما لا يمرُّ عبرَ مجمعِ الجلسة

قراءةُ `pg_stat_activity` الحيّةُ (§4) تُظهرُ اتصالاتِ المنصّةِ المباشرةَ (PostgREST · Storage · postgres_exporter · mgmt-api · supabase_admin · `pgbouncer` auth_query): **7 اتصالاتِ عميلٍ غيرِ تطبيقية** تُحسَبُ من `max_connections=60` لا من `pool_size` لجلسةِ Supavisor. أدواتُ CI التي تفتحُ اتصالًا بالإنتاج (نسخٌ احتياطيةٌ ونحوها) غيرُ مجرودةٍ في هذا الحجز ⇒ **غيرُ مقيسة** (تحتاجُ جردَ `.github/workflows` المتصلِ بأسرارِ الإنتاج).

### 2.3 الهامش

| السقف | القيمة | الحالة | الهامش مقابل 104 |
|---|---:|---|---:|
| Supavisor session `pool_size` (الإنتاج) | 40 (2026-10-08) | **غيرُ مقيسٍ اليوم** | −64 إن بقيَ 40 |
| PostgreSQL `max_connections` (الإنتاج) | 60 | مقيسٌ 2026-10-14T06:48:49Z | 60 − 3 (superuser_reserved) − 7 (منصّة) = 50 ⇒ −54 |

**لا حسابَ نظريًّا هنا قياسٌ حيّ:** الحدُّ 104 سقفٌ لا طلبٌ مرصود. ذروةُ L1 المرصودةُ (21) جاءتْ على `/health` الذي يخزّنُ نتيجةَ المجسِّ ثانيةً واحدة (`pg-guard.ts:45,452`)، فلا تختبرُ هذا السقف.

## 3. مساراتُ القراءةِ لكلِّ خدمة

التفصيل: [`read-paths.md`](./read-paths.md). الخلاصة: **لا `/ready` في كلِّ خدمة** — المسارُ المفتوحُ المشتركُ `/health` (مع `/delivery/health` و`/search/health`)، و`/delivery/ready` مفتوح، و`/search/ready` مفروضٌ برمزِ خدمة. **كلُّ طلبٍ مصادَقٍ برمزِ خدمة يكتبُ صفًّا** في جدولِ آثارِ الرموز (`INSERT … ON CONFLICT`، `replay-postgres.ts:170`) ⇒ لا يوجدُ اليومَ مسارُ قراءةٍ مصادَقٌ بلا أثرٍ كتابيٍّ جانبيّ.

## 4. قراءاتُ Supabase الحيّة (موصلُ Supabase · قراءةٌ فقط)

التفصيل: [`supabase-readings-2026-10-14T0648Z.md`](./supabase-readings-2026-10-14T0648Z.md).

| القيمة | الإنتاج `ppixaauyqoykrogwdxtv` | DR `pvyuhjadrygqqdoczmnd` |
|---|---|---|
| حالة المشروع | `ACTIVE_HEALTHY` | `INACTIVE` (موقوف) |
| `max_connections` | 60 (06:48:49Z) | **غيرُ مقيس** — `execute_sql`: «Connection terminated due to connection timeout» |
| `superuser_reserved_connections` / `reserved_connections` | 3 / 0 | غيرُ مقيس |
| `pg_stat_activity` (client backends) | 8 (كلُّها منصّة/Supavisor؛ لا اتصالَ تطبيقيَّ نشطًا) | غيرُ مقيس |
| Supavisor `default_pool_size` / `pool_size` / `max_client_conn` | **غيرُ مقيس** | **غيرُ مقيس** |
| `supavisor_logs` 24h | 252 سطرًا · تغطيةٌ فعليةٌ 2026-10-13T14:18:19Z → 2026-10-14T06:19:20Z (ليست النافذةَ الكاملة) · `EMAXCONN*` = 0 | غيرُ متاح (المشروع موقوف) |

**المطلوبُ بالضبط لقياسِ إعدادِ Supavisor:** رمزُ Supabase Management API (PAT أو OAuth) بصلاحيةِ `database_pooling_config_read` لقراءة `GET /v1/projects/{ref}/config/database/pooler` (الحقول `default_pool_size` · `max_client_conn` · `pool_mode`) لكلا المشروعين، أو لقطةٌ مؤرّخةٌ من Dashboard → Database → Connection pooling. موصلُ Supabase المتاحُ لا يكشفُ هذا الـendpoint، و`pg_settings` لا يحملُ إعداداتِ Supavisor. **وللـDR تحديدًا:** إعادةُ تشغيلِ المشروعِ قرارُ مالكٍ (يستهلكُ حصّةً)، فلا يُقاسُ قبلَه.

## 5. ما بقيَ غيرَ مقيس (لا يُستبدلُ بافتراض)

1. `pool_size` / `default_pool_size` / `max_client_conn` لجلسةِ Supavisor — الإنتاج وDR.
2. كلُّ إعداداتِ DR وسعتُه واتصالاتُه الحالية وسجلاتُ Supavisor له.
3. اتصالاتُ أدواتِ CI بالإنتاج (جردُ workflows).
4. الطلبُ الحيُّ الفعليُّ تحتَ حِمل — خارجَ نطاقِ المرحلة 0 بالتعريف.

## 6. أثرٌ جانبيٌّ موثّقٌ أثناءَ هذا الحجز (ليس جزءًا من القياس)

نشرُ main `79729e07` (run 38521315979) فشلَ على `wasla-search` وحدَها: `dep-db7ht3mq1p3s73cip4v0` = `update_failed`. السببُ الجذريُّ من سجلِّ Render: بعدَ «Deploying…» في 06:18:41Z لم تبدأ الحاويةُ إلّا 06:33:12Z (تأخّرُ جدولةٍ في المنصّة 14.5 دقيقة)، فاستمعتْ 06:33:13Z ثمّ انتهتْ مهلةُ النشر 06:33:41Z. **لا خطأَ في الكود** (الخدمةُ أقلعتْ واستمعتْ خلالَ ثانية). المعالجة: إعادةُ تشغيلِ وظيفةِ النشرِ المُثبَّتةِ على الالتزامِ نفسه (`gh run rerun --failed`) ⇒ `dep-db7iaoavcj2c73dou4gg` `live` على `79729e07` في 06:47:35Z. لا تغييرَ في إعدادِ Render. الصلةُ بـRISK-0066: خطةُ `free` وتأخّرُ الجدولةِ فيها.

## 7. ما سُجِّل

- `docs/07-security/RISK_REGISTER.md` — إضافةٌ مؤرّخةٌ لـRISK-0067 (الحالةُ تبقى `mitigating`).
- `pool-map.md` لـCLM-0551 — قسمُ تصحيحٍ مؤرّخٌ بالإضافة (النصُّ الأصليُّ محفوظ).
- TASK_LOG · WORK_CLAIMS · LAUNCH_EXECUTION_BOARD · ROADMAP.

## 8. الحجوزُ التالية (بالترتيب)

1. **إصلاحُ الطلبِ النظريّ (هندسي):** جعلُ مجمعِ الإعادةِ خاضعًا لميزانيةِ الأسطول (إزالةُ `max: 4` الثابت أو مشاركةُ مجمعِ الخدمة) واستبدالُ اختبارِ `17 × 2 ≤ 40` باختبارٍ بنيويٍّ يَعُدُّ مواضعَ إنشاءِ المجمعاتِ فعليًّا. حجزٌ مستقلّ.
2. **تصحيحُ الخطة (المرحلة الثانية):** إضافةٌ مؤرّخةٌ §9 تربطُ هدفَ الإنتاجِ بهذا الجرد. حجزٌ مستقلّ.
3. **قياسُ Supavisor** بعدَ توفيرِ الصلاحية المذكورة في §4.
