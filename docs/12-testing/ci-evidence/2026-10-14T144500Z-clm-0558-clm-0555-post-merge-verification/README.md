# CLM-0558 — التحقّقُ بعدَ الدمجِ لـCLM-0555 (ADR-070) وCLM-0556/0557 — قراءةٌ فقط

- **الحجز:** CLM-0558 · M6-18B · الفرع `docs/clm-0558-clm-0555-post-merge-verification`.
- **النطاق:** قراءةُ أحكامِ CI والنشرِ الفعلية، وفحصُ `/health` المفتوح، وقراءاتُ Supabase للقراءةِ فقط. لا حِمل، لا كتابة، لا تغييرَ إعداد.
- **الحالةُ لا تتغيّر:** RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO.

## 1. الدمج والموافقات

| PR | الحجز | الموافقة | الدمج (squash) |
|---|---|---|---|
| #708 | CLM-0551 + CLM-0554 | xuuux-voox (APPROVED) | `70a1d975` |
| #710 | CLM-0555 | xuuux-voox 2026-10-14T14:16:48Z | `6ad1a384` |
| #711 | CLM-0556 + CLM-0557 | xuuux-voox 2026-10-14T14:17:07Z | `2b00cbe1` (أُعيدَ بناؤه فوقَ `6ad1a384` قبلَ الدمج؛ الموافقةُ باقيةٌ لأنّ `dismiss_stale_reviews=false`) |

## 2. أحكامُ CI على main (مقروءةٌ من GitHub Actions)

| الالتزام | WASLA CI | Roadmap freshness | Render deploy |
|---|---|---|---|
| `70a1d975` | success (run 38527663123) | — | — |
| `6ad1a384` | **success** (run 38579322582) | success (38579322102) | **success** (38579322375) |
| `2b00cbe1` | **success** (run 38583046833) | success (38583046768) | لا كودَ زمنِ تشغيل (توثيقٌ فقط) |

## 3. النشرُ على Render (Render API · بعدَ 2026-10-14T14:22Z)

آخرُ نشرٍ لكلِّ خدمةِ ويب: **21/21 `live` على `6ad1a384`** ⇒ الشرطُ 7 في §9.5 من الخطة (CLM-0555 مدموجٌ ومنشورٌ ومتحقَّقٌ من التزامِه) **مستوفى**.

## 4. `/health` المفتوح (GET واحد لكلِّ خدمة، بلا مصادقة، بلا أثر)

17/17 خدمةً مرتبطةً بقاعدةِ البيانات أجابت **200** و`x-wasla-database: up`: audit · customers · delivery · dispatch · drivers · geography · identity · marketplace · matching · negotiations · orders · reputation · search · subscriptions · customer-bot · driver-bot · partner-bot.

هذا لا يُثبتُ مسارَ الاستعارةِ في زمنِ التشغيل: مجمعُ الإعادةِ يُفتحُ عندَ أوّلِ طلبٍ مصادَقٍ برمزِ خدمة، و`/health` لا يحملُ رمزًا. الاستعارةُ مُثبتةٌ باختبارِ الوحدة والبابِ 5 فقط.

## 5. Supabase الإنتاج (قراءةٌ فقط)

| القيمة | الوقت (UTC) | النتيجة |
|---|---|---|
| `pg_stat_activity` client backends | 2026-10-14T14:45:40Z | 7 (منها 1 عبرَ Supavisor) |
| `supavisor_logs` 14:15Z→14:46Z | — | 71 سطرًا · تغطيةٌ 14:19:50Z→14:22:44Z (حولَ النشر) · `EMAXCONN*` = 0 |

حسابٌ نظريٌّ لا قياسٌ حيّ: الحدُّ بعدَ ADR-070 = 36 (CLM-0554 · CLM-0555). `pool_size` ما زالَ غيرَ مقيس.

## 6. ما يبقى ناقصًا لمعايرةِ DR (من §9.5 بعدَ هذا التحقّق)

1 تشغيلُ DR (قرارُ المالك) · 2 `pool_size` (صلاحيةُ `database_pooling_config_read` أو لقطةُ Dashboard) · 3 اتصالاتُ DR القائمة · 4 `supavisor_logs` لـDR · 5 موافقةُ سيرِ عملِ المعايرة · 6 قرارُ RISK-0066 (مراجعة 2026-10-15) · 8 عددُ العملياتِ داخلَ الحاويةِ في زمنِ التشغيل. **الشرطُ 7 مستوفى.**
