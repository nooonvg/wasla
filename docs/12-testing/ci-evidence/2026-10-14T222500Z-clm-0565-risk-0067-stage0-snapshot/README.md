# CLM-0565 — إغلاقُ CLM-0564 + لقطةُ قياسٍ طازجةٌ للمرحلة 0 من RISK-0067 (قراءةٌ فقط)

- **الحجز:** CLM-0565 · الفرع `docs/clm-0565-risk-0067-stage0-snapshot-clm-0564-closure` · العنصر `M6-18B` (يخصُّ RISK-0067) ويُغلِقُ CLM-0564 (`M0-07`)
- **ما لم يُفعَل:** لا اتصالاتِ ضغط، لا حمل، لا كتابةَ على الإنتاجِ أو DR، لا تغييرَ في Render أو Supavisor، لا تشغيلَ لـDR، لا تمرينَ RISK-0058. لم تُطبَعْ قيمةُ أيِّ سرّ؛ سُجّلت أسماءُ المفاتيحِ فقط.

## A. إغلاقُ CLM-0564 (#718)

| البند | القيمة |
|---|---|
| الرأس / الموافقة | `c1d0de28` · موافقةُ `xuuux-voox` على `c1d0de28` في 2026-10-14T22:21:31Z |
| الفحوص على الرأس | 43/43 pass (WASLA CI 38645827267 success؛ governance-guard 22:11:07–22:21:59Z · verify 22:11:03–22:22:21Z) |
| الدمج | `scripts/ops/merge-on-approved-head.sh 718 --squash` (DRY_RUN OK ثمّ دمج) ⇒ `580458a5` في 22:23:15Z؛ الفرعُ حُذف (Merged branch cleanup success) |
| بعدَ الدمج | Roadmap freshness 38647286727 success؛ WASLA CI 38647286764 على `580458a5` **success 41/41** |

## B. المرحلة 0 — القيمُ المقيسةُ اليوم

| القيمة | المقيس | المصدر والتوقيت |
|---|---|---|
| عددُ الخدمات | 21 web service + 3 static sites | Render API `GET /v1/services`، 2026-10-14T21:58:17Z — [`raw-render-inventory-2026-10-14T215817Z.tsv`](raw-render-inventory-2026-10-14T215817Z.tsv) |
| عددُ النسخ | **`numInstances=1` لكلٍّ من الـ21**، كلُّها `free` و`not_suspended` | نفسُه |
| الشفرةُ الحيّة | 20/21 على `6280760a`؛ `wasla-alertmanager` على `3c9edc71` (آخرُ نشرٍ `update_failed` — متابعةُ CLM-0563) | Render deploys API، نفسُ التوقيت |
| `WASLA_PG_POOL_MAX` | **غيرُ مضبوطٍ** في env-vars الخدماتِ الـ21 وفي مجموعةِ `wasla-prod-db` (مفاتيحُها `DATABASE_URL` و`CUSTOMER_DATABASE_URL` فقط، مرتبطةٌ بـ17 خدمة) ⇒ الافتراضيُّ `PG_GUARD_DEFAULTS.poolMax = 2` (`packages/resilience/src/pg-guard.ts:56`) | Render API env-vars + env-groups، 22:08Z — [`raw-pool-env-names.tsv`](raw-pool-env-names.tsv) |
| حدودُ المجمعاتِ في الشفرة | لا تغييرَ في `services/` `packages/` `bots/` `apps/` منذ `6ad1a384` (ADR-070)؛ التجاوزاتُ الصريحةُ غيرُ الاختبارية: `services/billing/src/http/server.ts:81` (`max: 2`، مجمعُ المصدرِ في billing) و`packages/search-e2e` (`max: 8`، e2e لا يعملُ على Render) | `git log 6ad1a384..580458a5` و`git grep` |
| `max_connections` (إنتاج) | **60** · `superuser_reserved_connections` **3** | `current_setting`، 21:58:31Z — [`raw-prod-pg-snapshot.json`](raw-prod-pg-snapshot.json) |
| `pg_stat_activity` (client backend) | **9**: Supavisor-labelled `postgres` 3 · pgbouncer 2 · authenticator (PostgREST) 1 · supabase_admin 2 (منها postgres_exporter 1) · mgmt-api 1 | نفسُه — لقطةٌ واحدة؛ الثلاثُ المعنونةُ «Supavisor» يُرجَّحُ أنّها جلساتُ تطبيقٍ عبرَ المجمِّع، **والإسنادُ غيرُ مُثبت** |
| `supavisor_logs` (إنتاج) | 498 سطرًا بين 2026-10-13T22:50:10Z و2026-10-14T21:57:41Z؛ **0** `EMAXCONN` | `query_logs` 21:58Z — [`raw-supavisor-logs.json`](raw-supavisor-logs.json) |
| `pool_size` / `default_pool_size` / `max_client_conn` (إنتاج وDR) | **غيرُ مقيس**. محاولةٌ جديدة: لا سطرَ في `supavisor_logs` يكشفُ هذه الحقول، فالسجلّاتُ **ليست** مصدرًا بديلًا | نفسُه |
| مشروعُ DR `pvyuhjadrygqqdoczmnd` | **`INACTIVE`** ⇒ إعدادُه وسجلّاتُه واتصالاتُه غيرُ مقيسة | Supabase `list_projects`، 22:00Z — [`raw-supabase-projects.json`](raw-supabase-projects.json) |

### B.1 الحدُّ النظريُّ (حسابٌ، لا قياسٌ حيّ)

\[ C = \sum_{\text{pool}} \text{max}_{\text{pool}} \times \text{instances} = 14 \times 2 + (2 + 2)_{\text{customer-bot}} + 2_{\text{driver-bot}} + 2_{\text{partner-bot}} = 36 \]

الافتراضات: نسخةٌ واحدةٌ لكلِّ خدمة (مقيس) · عمليةٌ واحدةٌ داخلَ كلِّ حاوية (**مستنتَجٌ من الشفرة، غيرُ مقيس** — §10.2 الصفّ 7) · `WASLA_PG_POOL_MAX` غائب (مقيس) · مجمعُ replay يستعيرُ مجمعَ المضيف (ADR-070، في الشفرةِ الحيّة `6280760a`).

| الهامش | القيمة | الحكم |
|---|---|---|
| على PostgreSQL | \( 60 - 3 - 6_{\text{non-app}} = 51 \ge 36 \) ⇒ هامش 15 (إن عُدَّت الثلاثُ المعنونةُ Supavisor جلساتِ تطبيقٍ فهي داخلَ الـ36) | حسابيٌّ |
| على Supavisor \( L = S \) | **غيرُ قابلٍ للحساب** — \( S \) غيرُ مقيس، وقراءةُ 40 بتاريخ 2026-10-08 لا تُستعمل (§9.2) | **HOLD** |

هدفُ الإنتاجِ يبقى \( C = 36 \) بشرطِ \( C \le L \) (§9.3)، والشرطُ غيرُ قابلٍ للتحقّقِ اليوم.

### B.2 مساراتُ القراءة

لا تغييرَ في الشفرة منذ الجرد؛ يبقى مرجعُها [`read-paths.md`](../2026-10-14T064600Z-clm-0554-risk-0067-stage0-full-pool-inventory/read-paths.md) و§9 من الخطة. لم يُضرب أيُّ مسارٍ في هذه المرحلةِ غيرَ ما في §C (GET `/` لـPrometheus وAlertmanager، وGET `/health` لـidentity وcustomers ضمنَ CLM-0564).

## C. مسارُ الإنذار — تعافى بعدَ حلِّ حادثةِ Render

[`raw-alert-path-recovery.txt`](raw-alert-path-recovery.txt): Alertmanager وPrometheus (oregon) أجابا 502 `x-render-routing: no-deploy` حتى 22:03Z؛ صفحةُ Render أعلنت **حلَّ الحادثة 22:18Z**؛ وفي 22:23:23Z أجابا 401 (مصادقةُ Alertmanager = العمليةُ تعمل) و302 بعدَ إيقاظٍ باردٍ ~12 s، وبدأ Prometheus في 22:23:41Z بلا أيِّ `Error sending alert` حتى 22:24:56Z. التزامنُ يقوّي فرضيّةَ أنّ الحادثةَ سببُ عطبِ التوجيه، **ويبقى فرضيّةً**. لم يُعَدْ أيُّ نشر؛ متابعةُ نشرِ Alertmanager `update_failed` (CLM-0563) ما زالت مفتوحة. issue #689 يبقى مفتوحًا حتى يمرَّ فحصُ الصحّةِ المجدولُ التالي.

## D. ما ينقصُ لبدءِ معايرةِ DR (بلا تغييرٍ عن §10.2، مُعادُ القياس)

1. **قرارٌ مكتوبٌ من المالك بإعادةِ تشغيلِ `pvyuhjadrygqqdoczmnd`** (ما زالَ `INACTIVE`).
2. **\( S \) لـDR وللإنتاج:** رمزُ Supabase Management API بصلاحيّة `database_pooling_config_read` عبرَ نموذجِ الأسرارِ الآمن، أو لقطةُ Dashboard مؤرّخة. (ثبتَ اليومَ أنّ `supavisor_logs` لا تكشفُه.)
3. \( E \) على DR — يتبعُ 1.
4. تغطيةُ `supavisor_logs` على DR للنافذةِ كاملة — يتبعُ 1.
5. موافقةُ المالكِ على إضافةِ سيرِ عملِ المعايرة (`.github/workflows/`) تحتَ حجزٍ مستقلٍّ ومراجعةِ CODEOWNERS.
6. قرارُ RISK-0066 (حزمةُ القرار §6.3/§7) — المراجعةُ التالية 2026-10-22.

وما ينقصُ للمرحلة 2 (الإنتاج) فوقَ ذلك: موافقةٌ كتابيّةٌ بالنافذةِ والحدود · \( S \) للإنتاجِ في يومِها · قياسُ عددِ العملياتِ داخلَ الحاوية · قرارُ RISK-0066.

## E. الحالات

RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 — بلا تغيير. لا حِمل ولا معايرة.
