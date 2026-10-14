# CLM-0554 — قراءاتُ Supabase الحيّة (موصلُ Supabase MCP · قراءةٌ فقط)

لا كتابة، لا تغييرَ إعداد، لا اتصالَ ضغط. الاستعلاماتُ نُفِّذت مرّةً واحدةً كلٌّ منها.

## الإنتاج — `ppixaauyqoykrogwdxtv` (ap-south-1 · PostgreSQL 17.11.0.002 · `ACTIVE_HEALTHY`)

| الاستعلام | الوقت (UTC) | النتيجة |
|---|---|---|
| `current_setting('max_connections')` | 2026-10-14T06:48:49Z | 60 |
| `superuser_reserved_connections` / `reserved_connections` | 06:48:49Z | 3 / 0 |
| `count(*) from pg_stat_activity` | 06:48:49Z | 16 إجمالي · 8 `client backend` |
| تفصيلُ `client backend` حسب `usename/application_name/state` | 06:48:5xZ | authenticator·PostgREST 14.18·idle 1 · pgbouncer·(فارغ)·idle 1 · pgbouncer·Supavisor (auth_query)·idle 1 · postgres·mgmt-api·active 1 (هذا الاستعلام) · postgres·Supavisor·idle 1 · supabase_admin·(فارغ)·idle 1 · supabase_admin·postgres_exporter·idle 1 · supabase_storage_admin·Supabase Storage API·idle 1 |

اتصالٌ تطبيقيٌّ واحدٌ عبرَ Supavisor (`postgres · Supavisor · idle`)؛ الخدماتُ في الخمول (خطةُ `free`).

### السجلات — نافذةُ 2026-10-13T06:50Z → 2026-10-14T06:50Z

| المصدر | الأسطر | أوّل | آخر | `EMAXCONN*` |
|---|---:|---|---|---:|
| pgbouncer_logs | 11600 | 2026-10-13T06:50:03Z | 2026-10-14T06:48:48Z | 0 |
| **supavisor_logs** | **252** | **2026-10-13T14:18:19Z** | **2026-10-14T06:19:20Z** | **0** |
| postgres_logs | 22 | 2026-10-13T13:06:28Z | 2026-10-14T06:19:10Z | 0 |

- تغطيةُ `supavisor_logs` الفعليةُ تبدأُ بعدَ 7.5 ساعاتٍ من بدايةِ النافذة ⇒ **ليست تغطيةً كاملة**؛ `EMAXCONN* = 0` صحيحٌ ضمنَ التغطيةِ فقط.
- المجمعُ الوحيدُ في السجلات: `Supavisor.id(type: :single, tenant: "ppixaauyqoykrogwdxtv", mode: :session, user: "postgres", db: "postgres", upstream_tls: true)` — آخرُ «Starting pool(s)» في 2026-10-14T06:18:45Z (يتزامنُ مع نشرِ 79729e07).
- لا يطبعُ Supavisor `pool_size` في سجلّاتِه (بحثٌ عن `size`/`Starting pool` = 0 أسطرٍ تحملُ الحجم).

## DR — `pvyuhjadrygqqdoczmnd` (`wasla-dr-replacement` · `INACTIVE`)

| الاستعلام | الوقت | النتيجة |
|---|---|---|
| `list_projects` | 2026-10-14T06:48Z | `status: INACTIVE` |
| `select now(), current_setting('max_connections')` | 2026-10-14T06:52Z | **فشل:** `Failed to run sql query: Connection terminated due to connection timeout` |

⇒ كلُّ قيمِ DR **غيرُ مقيسة**. لا تُعادُ قراءةُ 2026-10-08 بديلًا.

## غيرُ مقيسٍ والصلاحيةُ المطلوبة

| القيمة | المصدرُ المطلوبُ بالضبط |
|---|---|
| `default_pool_size` · `max_client_conn` · `pool_mode` (الإنتاج وDR) | Supabase Management API `GET /v1/projects/{ref}/config/database/pooler` برمزٍ يحملُ `database_pooling_config_read`، أو لقطةُ Dashboard مؤرّخة. موصلُ MCP الحاليُّ لا يكشفه. |
| كلُّ قيمِ DR | قرارُ المالك بإعادةِ تشغيلِ مشروعِ DR (حصّةُ الخطة المجانية) ثمّ القراءاتُ نفسُها. |
