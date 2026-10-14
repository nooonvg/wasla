# CLM-0563 (أ) — إغلاقُ CLM-0562: دمجُ #716 عبرَ الحارس والتحقّقُ بعدَ الدمج

> إضافةٌ لاحقةٌ لا تمسُّ سجلَّ CLM-0562 الأصليّ (`../2026-10-14T181900Z-clm-0562-post-merge-713-715/README.md`)؛ ذلك السجلُّ يبقى بلوحتِه الزمنيّةِ كما دُمج.

## 1. حدثُ الموافقةِ والدمج (UTC، 2026-10-14)

| البند | القيمة | المصدر |
|---|---|---|
| حالةُ #716 قبلَ الدمج | `open` · رأس `d907ba327abf95440adf556b9d871999d70e8918` · main `09b88a85e199ab65e39b44ce456d7b004e60e570` | `GET pulls/716` و`commits/main` في 20:27:02Z |
| الموافقة | `xuuux-voox` · APPROVED · `commit_id` = `d907ba327abf95440adf556b9d871999d70e8918` · **19:12:09Z** · id 5523294458 (المراجعةُ الحاسمةُ الوحيدة، لا CHANGES_REQUESTED) | [`716-premerge-reviews.json`](./716-premerge-reviews.json) |
| الفحوصُ على الرأس | 42/42 `completed:success` | [`716-premerge-checks.json`](./716-premerge-checks.json) |
| التشغيلُ التجريبيّ | `DRY_RUN=1 scripts/ops/merge-on-approved-head.sh 716 --squash` ⇒ `OK … approval_commit=d907ba32… checks: success=42 … failed=0 pending=0` | [`716-guard-dryrun.txt`](./716-guard-dryrun.txt) |
| الدمج | `scripts/ops/merge-on-approved-head.sh 716 --squash` في 20:27:14Z ⇒ `--match-head-commit d907ba32…` · **SHA الدمج `47a1a76d3b8e729da1f573a9f445c4bc3203ec5e`** · 20:27:19Z · لا `gh pr merge` مباشر ولا `--admin` | [`716-guard.txt`](./716-guard.txt) · [`716-merge.json`](./716-merge.json) |

## 2. بعدَ الدمج

- main = `47a1a76d3b8e729da1f573a9f445c4bc3203ec5e`.
- WASLA CI ‏38632212599 (push، 20:27:23Z): 41 وظيفة، 41 بدأت، **41 success**. Roadmap freshness ‏38632212584: **success**.
- سيرٌ ثانٍ بحدثِ `push` على SHA نفسِه في 20:31:15Z (WASLA CI ‏38632770269 · Roadmap freshness ‏38632770172 = success) — لم يصدرْ عن الوكيل، وmain لم يتغيّر؛ يُسجَّلُ رصدًا لا تفسيرًا.
- الفرعُ `docs/clm-0562-post-merge-713-715` محذوف (`git ls-remote` ⇒ 0).
- لا نشر: التغييرُ توثيقيٌّ و`render-deploy.yml` يتجاهلُ `docs/**`.

**CLM-0562 مُغلَق** بهذا السجلّ. نشرُ `6280760a` **ليس** مُغلقًا — بندٌ تشغيليٌّ مستقلّ: [`../2026-10-14T204000Z-clm-0563-render-6280760a-alertmanager-followup/README.md`](../2026-10-14T204000Z-clm-0563-render-6280760a-alertmanager-followup/README.md).

## 3. تصحيحٌ بالإضافة لـCLM-0562 §2

عبارةُ «التصنيف: عَرَضٌ منصّيٌّ على الخطةِ المجانية … لا عيبٌ في الكود» في CLM-0562 §2 (وما يقابلُها في TASK_LOG ورسالةِ الالتزام) **تتجاوزُ ما يثبتُه الدليل**. التصنيفُ الصحيح: **السببُ الجذريُّ غيرُ محسوم** — انظر سجلَّ المتابعة §3. الحكمُ يبقى **FAIL**، و20/21 خدمةً فقط بلغتْ `6280760a`.
