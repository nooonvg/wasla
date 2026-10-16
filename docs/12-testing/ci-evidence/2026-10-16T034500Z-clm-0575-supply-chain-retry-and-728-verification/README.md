# CLM-0575 — محاولتا `image-supply-chain` في تشغيلِ #728، والتحقّقُ النهائيُّ بعدَ دمجِ #728 — بلا تشغيلٍ ولا حمل

**التاريخ:** 2026-10-16 · **البند:** M6-18B · **الحجز:** CLM-0575 (التُزمَ صفُّه `b24f22b3` ودُفعَ قبلَ أيِّ ملفٍّ آخر) · **النطاق:** قراءاتٌ فقط (GitHub API، سجلّاتُ الوظائف، artifacts، `gh attestation verify` محليًّا، Supabase `get_project`). **لا إعادةَ تشغيلٍ لأيِّ سيرٍ لهذا الغرض، ولا نشر، ولا `workflow_dispatch`، ولا حمل.** أدلّةُ #727 و#728 المسجّلةُ في CLM-0574 لا تُكرَّر هنا.

## 1. محاولتا `image-supply-chain` — التشغيل [38845059289](https://github.com/skyosv10-art/wasla/actions/runs/38845059289) (رأسُ #728 `a4187feb`)

| | المحاولة 1 | المحاولة 2 |
|---|---|---|
| الوظيفة | [116793593794](https://github.com/skyosv10-art/wasla/actions/runs/38845059289/job/116793593794) | [116795772617](https://github.com/skyosv10-art/wasla/actions/runs/38845059289/job/116795772617) |
| البدء → الانتهاء | 03:20:59Z → 03:23:19Z | 03:29:14Z → 03:30:58Z |
| كيف بدأت | تشغيلُ PR الأصليّ | `gh run rerun 38845059289 --failed` — **الوظيفةُ الفاشلةُ وحدَها**، لا السيرُ كاملًا |
| الخطوة 12 «إثباتُ أصلِ قوائمِ الموادِ (M6-19C)» (`actions/attest-build-provenance@v2`) | **failure** · 03:22:15Z → 03:23:17Z | **success** · 03:30:50Z → 03:30:53Z |
| الخطأ / المخرَج | `##[error]InternalError: error fetching tlog entry` · `FetchError: network timeout at: https://rekor.sigstore.dev/api/v1/log/entries/108e9186…` (03:23:17.808Z، بعدَ 61 538 ms) | `Attestation created for 2 subjects` · `Attestation signature uploaded to Rekor transparency log` · `https://github.com/skyosv10-art/wasla/attestations/56518457` |
| الخطوة 13 «تحقُّقٌ من الإثبات» | skipped | success — **لكنها لم تتحقّق فعلًا** (§2) |
| نتيجةُ الوظيفة | **failure** | **success** |

- الدليلانِ محفوظان: [`raw-attempt1-116793593794-excerpt.txt`](raw-attempt1-116793593794-excerpt.txt) · [`raw-attempt2-116795772617-excerpt.txt`](raw-attempt2-116795772617-excerpt.txt) (مقتطفُ الخطوتَين 12–13 بطوابعِه، من `gh run view --attempt N --log --job …`). **سجلُّ الفشلِ الأصليّ باقٍ في GitHub** (المحاولة 1 لا تُحذفُ بإعادةِ المحاولة).
- **المحاولة 1 لم تُخزّن إثباتًا:** بصمةُ `pass1.cdx.json` من artifact المحاولة 1 (12022043717) = `sha256:29cd8031…` ⇒ `GET /repos/…/attestations/sha256:29cd8031…` = **404**.
- **التصنيف:** **تعافٍ بعدَ إعادةِ المحاولةِ من إخفاقِ شبكةٍ خارجيّ** (مهلةُ شبكةٍ عندَ جلبِ مدخلِ سجلِّ الشفافيةِ من Rekor العامّ). لا دليلَ على عيبٍ في الكود: التغييرُ في #728 توثيقيٌّ فقط، والخطوةُ نفسُها بالمدخلاتِ نفسِها نجحت في المحاولة 2. لم يُخفَّف أيُّ فحص.

## 2. ملاحظةٌ مفتوحة: الخطوة 13 «تحقُّقٌ من الإثبات» لا تتحقّق

في المحاولة 2 (03:30:53Z → 03:30:56Z) خرجَ `gh attestation verify` بخطأ «set the GH_TOKEN environment variable»، ثمّ أخفاه `|| echo "WARN: attestation verify requires gh CLI 2.50+"` فصارت الخطوةُ **success بلا تحقّق**. فنجاحُها **ليس دليلَ تحقّق**.

**تحقّقٌ مستقلٌّ من المنفّذ (محليًّا، 2026-10-16):** artifact المحاولة 2 (12023460709) ⇒ `pass1.cdx.json` = `sha256:3e0e0d81ec3c419a4626df992878d494c58ce43c0c639dd0754190da46ea5b0d` ⇒ `gh attestation verify pass1.cdx.json --repo skyosv10-art/wasla` ⇒ **exit 0**؛ النتيجة [`raw-attestation-verify-pass1-attempt2.json`](raw-attestation-verify-pass1-attempt2.json): `predicateType = https://slsa.dev/provenance/v1` · الموضوعان `pass1.cdx.json` و`pass2.cdx.json` · الموقّع `…/.github/workflows/ci.yml@refs/pull/728/merge` · المُصدِر `https://token.actions.githubusercontent.com` · `runInvocationURI = …/runs/38845059289/attempts/2` · طابعُ Rekor المتحقَّق 2026-10-16T03:30:52Z. **ضابطٌ سلبيّ:** الملفُّ نفسُه بعدَ إلحاقِ بايتَين (`" \n"`) ⇒ **exit 1** (لا إثباتَ للبصمة). (`sourceRepositoryDigest = 8791c428` هو التزامُ الدمجِ التجريبيِّ لـ`refs/pull/728/merge`، لا رأسُ الطلب — متوقّعٌ لحدثِ `pull_request`.)

**الإصلاحُ غيرُ منفّذٍ هنا** (خارجَ نطاقِ هذا الحجزِ التوثيقيّ، وتعديلُ سيرِ العملِ يُطلقُ نشرًا لأنه خارجَ `docs/**`): يلزمُ حجزٌ مستقلٌّ يمرّرُ `GH_TOKEN: ${{ github.token }}` إلى الخطوة ويزيلُ `|| echo WARN` حتى يفشلَ التحقّقُ فعلًا عندَ فشله.

## 2b. المصدرُ الجذريُّ لظهورِ `health-report.json` في الجذر (CLM-0574)

`scripts/ops/health/check-health.py` يكتبُ تقريرَه افتراضيًّا إلى `health-report.json` في المجلدِ الحاليّ (السطر 73)، والملفُّ ليس في `.gitignore`. أُصلحَ أثرُه قبلَ الدفعِ في CLM-0574 (نُقلَ إلى مجلدِ الأدلة). **إجراءُ المنفّذ من الآن:** تمريرُ مسارٍ صريحٍ خارجَ الشجرةِ أو داخلَ مجلدِ الأدلة (`check-health.py <path>`). إضافةُ السطرِ إلى `.gitignore` مؤجّلةٌ إلى حجزٍ ينشرُ أصلًا (تعديلُه خارجَ `docs/**` يُطلقُ نشرًا).

## 3. التحقّقُ النهائيُّ بعدَ دمجِ #728

| البند | القيمة (مقيسةٌ عبرَ GitHub API) |
|---|---|
| الرأس / المراجعة | `a4187febf34d3b6d904cd61b30f6b570a0315530` · `xuuux-voox` `APPROVED` على الرأسِ نفسِه 03:28:10Z |
| الحارس | 42 success · 0 failed · 0 pending (بعدَ المحاولة 2) |
| الدمج | **`4c2833af60a0ba51f7fde1bfa8fb848e1acadc45`** · 2026-10-16T03:33:33Z |
| WASLA CI | [38846122272](https://github.com/skyosv10-art/wasla/actions/runs/38846122272) success · **41/41** (`total_count` = 41، كلُّها success) · 03:33:36Z → 03:44:56Z |
| Roadmap freshness | [38846122282](https://github.com/skyosv10-art/wasla/actions/runs/38846122282) success · 03:33:36Z → 03:33:50Z |
| تشغيلاتُ `4c2833af` | هذان فقط — **لا Render deploy** (توثيقٌ مستثنًى بـ`paths-ignore`) |
| `health-report.json` في جذرِ `4c2833af` | **غائب** (`git ls-tree origin/main`)؛ النسختانِ الوحيدتانِ داخلَ مجلدَي أدلّةِ CLM-0569 وCLM-0574 |
| الفرع | حُذف؛ لا فروعَ بعيدةٌ غيرُ `main` |

**CLM-0574 مغلق.**

## 4. INC-0007 — `Open` · مفتاحُ Render وتوكناتُ البوتاتِ تُعامَلُ مكشوفةً حتى إثباتِ التدوير

قياسٌ متجدّد (بياناتٌ وصفيةٌ فقط): `RENDER_API_KEY` 2026-10-08T15:19:45Z · `RENDER_OWNER_ID` 2026-10-06T13:30:34Z · `TELEGRAM_BOT_TOKEN_*` و`*_BOT_TOKEN` 2026-10-06T13:30:50–31:04Z — **بلا تغييرٍ منذ CLM-0574 ⇒ لا تدوير.** لم تُستخدم القيمُ القديمةُ في أيِّ أمرٍ جديد، ولم تُطلب أسرارٌ في المحادثة. سلسلةُ الإغلاق (CLM-0574 §6): التدويرُ وتحديثُ GitHub ومجموعاتِ Render ← قراءةُ API غيرُ مُغيِّرةٍ بالاعتمادِ الجديدِ من النموذجِ الآمن ← إثباتُ إبطالِ المفتاحِ القديم ← صحّةُ البوتات ← توثيق.

## 5. RISK-0066 — `open` · HOLD 0/20

الخيار B معتمد؛ بانتظارِ تغييرِ المالكِ للخططِ من لوحةِ Render، ثمّ تحقّقٌ بالتتابعِ في حجزٍ مستقلٍّ مع التوقّفِ عندَ أيِّ فرقٍ في النطاقِ أو الكلفة.

## 6. RISK-0067 — `mitigating` · المعايرةُ HOLD

DR `pvyuhjadrygqqdoczmnd` = **`INACTIVE`** (`get_project`، هذا الحجز). غائب: حدُّ مجمّعِ الجلساتِ 5432 مؤرّخًا للإنتاجِ وDR · إثباتُ تدفّقِ سجلّاتِ Supavisor المستهدفِ وتغطيتِه · نافذةٌ مأذونة · `PREFLIGHT_OK` لـ\(E\) في النافذةِ نفسِها. لا `workflow_dispatch` ولا إعادةَ تشغيلٍ لـDR.

## 7. الحالات

RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 — **كما هي**. لا RISK-0058، ولا تغييرَ لحمايةِ الفروعِ أو إعداداتِ Supavisor.
