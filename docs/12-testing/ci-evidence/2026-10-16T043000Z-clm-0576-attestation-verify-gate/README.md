# CLM-0576 — إصلاحُ بوّابةِ التحقّقِ من Artifact Attestation في `image-supply-chain`

**التاريخ:** 2026-10-16 · **البند:** M6-18B (سلسلةُ التوريد M6-19C · ADR-056) · **الحجز:** CLM-0576 (صفُّه التُزمَ `8a92d8a0` ودُفعَ قبلَ أيِّ ملفٍّ آخر) · **الفرع:** `fix/clm-0576-attestation-verify-gate` من `main` `a5b36cf0`.

> **حاجزُ دمج — لا دمجَ حتى يؤكّدَ المالك:** (1) تدويرَ مفتاحِ Render API · (2) تحديثَ سرِّ `RENDER_API_KEY` في GitHub · (3) التحقّقَ من صلاحيةِ الاعتمادِ الجديدِ بقراءةٍ غيرِ مُغيِّرة · (4) إبطالَ المفتاحِ القديم. السببُ: هذا التغييرُ يمسُّ `.github/workflows/ci.yml` و`scripts/**` — خارجَ `paths-ignore` في `render-deploy.yml` (`docs/**`، `**/*.md`) — **فالدمجُ إلى `main` يُطلقُ نشرَ Render المعتادَ لـ 24 موردًا `wasla-*` (21 web_service + 3 static_site)** — كما قِيسَ في النشرِ الأخير [38843128137](../2026-10-16T031500Z-clm-0574-clm-0573-post-merge-verification/README.md) بالسرِّ `RENDER_API_KEY` الذي يُعامَلُ مكشوفًا (INC-0007). لا تُستخدَمُ القيمةُ القديمةُ في أيِّ أمرٍ أو اختبار، ولا يُطلَبُ المفتاحُ في المحادثة.

## 1. العيب — مفتوحٌ اكتُشفَ بعدَ الدمجِ في CLM-0575

سُجّلَ في [CLM-0575 §2](../2026-10-16T034500Z-clm-0575-supply-chain-retry-and-728-verification/README.md) (لم يُعدَّل): خطوةُ «تحقُّقٌ من الإثباتِ» كانت:

```yaml
gh attestation verify artifacts/sbom/pass1.cdx.json \
  --repo ${{ github.repository }} || echo "WARN: attestation verify requires gh CLI 2.50+"
```

- `gh` بلا `GH_TOKEN` ⇒ خطأُ مصادقة ⇒ `|| echo` يُحوّلُه نجاحًا. **الخطوةُ خضراءُ بلا تحقّق** في كلِّ تشغيلٍ سابق.
- الملفُّ الثاني `pass2.cdx.json` لم يُتحقَّق منه أصلًا، ولا قيدَ على سيرِ التوقيع.
- الحارسُ `validate-workflow-supply-chain.sh` (البابُ 7) كان يكتفي بوجودِ النصِّ `gh attestation verify`.

## 2. الإصلاح

| الملفّ | التغيير |
|---|---|
| `scripts/ci/verify-sbom-attestations.sh` (جديد) | `set -euo pipefail` · `GH_TOKEN` غائبٌ/فارغ ⇒ **2** · `gh` أقدمُ من **2.50.0** أو بلا `--repo`/`--signer-workflow`/`--predicate-type`/`--format` ⇒ **3** (لا تحذيرَ يُمرِّر) · لكلِّ ملفّ: `gh attestation verify <f> --repo <repo> --signer-workflow <repo>/.github/workflows/ci.yml --predicate-type https://slsa.dev/provenance/v1 --format json` · **الخروجُ الصفريُّ وحدَه لا يكفي**: يُشترطُ أن يحويَ المخرَجُ نتيجةً بـ`predicateType` نفسِه وبصمةِ `sha256` الملفِّ نفسِه و`buildSignerURI` يبدأ بـ`https://github.com/<repo>/.github/workflows/ci.yml@` و`sourceRepositoryURI` المستودعِ نفسِه · فشلُ أيِّ ملفٍّ ⇒ **1** للكلّ. لا يطبعُ الرمز. |
| `.github/workflows/ci.yml` · `image-supply-chain` | خطوةُ التحقّق: `shell: bash` + `set -euo pipefail` + `env: GH_TOKEN: ${{ github.token }}` (**لهذه الخطوةِ والتي تليها فقط**) · تستدعي البوّابةَ للملفَّين `pass1` و`pass2` · **حُذفَ `|| echo "WARN…"`**. أُضيفت: خطوةُ اختباراتِ الوحدة (قبلَ البناء، بلا رمز)، وخطوةُ الحالاتِ الحيّة (بعدَ التحقّق)، ورفعُ أدلّتِها `image-supply-chain-attestation-verify-evidence` (`if: always()`، `if-no-files-found: error`). `gh --version` في «بيئةُ القياس». **الصلاحيّاتُ بلا تغيير:** `contents: read` · `id-token: write` · `attestations: write` (لازمةٌ للإنشاء؛ القراءةُ مشمولة). |
| `scripts/ci/test-verify-sbom-attestations.sh` (جديد) | 16 حالةَ وحدةٍ بـ`gh` مُصطنَع (§3.1). |
| `scripts/ci/test-verify-sbom-attestations-live.sh` (جديد) | 10 حالاتٍ حيّةٍ بـ`gh` الحقيقيِّ والإثباتِ الحقيقيِّ في التشغيلِ نفسِه (§3.2). |
| `scripts/checks/validate-workflow-supply-chain.sh` (البابُ 7) | يُلزِم: استدعاءَ البوّابةِ بالملفَّين و`.github/workflows/ci.yml` · `GH_TOKEN: ${{ github.token }}` · ويرفض: أيَّ `||` بعدَ التحقّق (مع ضمِّ الأسطرِ المستمرّة) · نصَّ `WARN: attestation verify` · `continue-on-error: true` في الوظيفة. |
| `scripts/checks/test-governance.sh` | الحالةُ 16 تتبعُ الخطوةَ الجديدة؛ وأُضيفت (17)–(22): قناعُ `|| echo WARN` · قناعُ `|| true` · الملفُّ الأوّلُ وحدَه · غيابُ `GH_TOKEN` · `continue-on-error` · سيرُ توقيعٍ غيرُ `ci.yml` — كلُّها تُرفَض. |

لا تخفيفَ لأيِّ فحصٍ آخر. لا وظيفةَ جديدة (`ci_jobs` بلا تغيير) ولا ملفَّ اختبارٍ `*.test.*` (`test_files_tracked` بلا تغيير) ولا `continue-on-error`.

## 3. الاختبارات

### 3.1 وحدة (CI: خطوةُ «اختباراتُ وحدةٍ لبوّابةِ تحقُّقِ الإثبات»)

موجبة: الملفُّ الأوّل · الثاني · كلاهما ⇒ 0. سالبة: غيابُ `GH_TOKEN` (2) · فارغ (2) · مصادقةٌ غيرُ صالحة (1) · **`gh` يخرجُ 0 بتحذيرِ WARN فقط (1)** · بصمةٌ أخرى/ملفٌّ معدَّل (1) · سيرُ توقيعٍ آخر (1) · نوعٌ غيرُ SLSA v1 (1) · غيابُ إثباتِ الثاني (1) · غيابُ إثباتِ الأوّل (1) · ملفٌّ غائب (1) · `gh 2.49.2` (3) · `gh` بلا `--signer-workflow` (3) · وسائطُ ناقصة (2).
محليًّا: [`local-unit-tests.txt`](local-unit-tests.txt) — 16/16. **اختبارُ الطفرات** [`local-mutation-tests.txt`](local-mutation-tests.txt): أربعُ طفراتٍ تُضعفُ البوّابةَ (`exit 0` في النهاية · تعطيلُ فحصِ المخرَج · `die`→`echo` للرمز · `die`→`echo` للإصدار) — **كلُّها تكشفُها الحزمة** (8 · 4 · 2 · 1 حالاتٍ تفشل).

### 3.2 حيّة (CI: خطوةُ «تحقُّقُ الإثباتِ — حالاتٌ موجبةٌ وسالبةٌ حيّة»)

موجبة ⇒ 0: `positive-pass1` · `positive-pass2` (وخطوةُ التحقّقِ نفسُها للملفَّين معًا). سالبة ⇒ غيرُ 0 بلا سطرِ نجاح: `negative-tampered-pass1` · `negative-tampered-pass2` (نسخةٌ + بايتٌ بعدَ إنشاءِ الإثبات) · `negative-one-of-two-bad` · `negative-no-gh-token` · `negative-invalid-gh-token` · `negative-wrong-signer-workflow` (`render-deploy.yml`) · `negative-wrong-repo` · `negative-raw-gh-no-token` (`gh` الخامُ بلا رمز). مخالفةُ أيِّ حالةٍ تُفشِلُ الوظيفة. مخرَجُ كلِّ حالةٍ في الأرتفاكت.

### 3.3 الحارسُ الثابت

[`local-governance-cases.txt`](local-governance-cases.txt): الحالاتُ (15)–(22) ✓. والحارسُ يمرُّ على الشجرة.

**محليًّا ليس بديلًا عن CI:** التحقّقُ الموجبُ محليًّا يتعذّرُ بلا رمزٍ حقيقيٍّ (والرمزُ لا يُمرَّرُ هنا)، فحكمُه لوظيفةِ CI وحدَها (§4). محليًّا ثبتَ السالب فقط: رمزٌ مُصطنَع ⇒ `HTTP 401` ⇒ 1 · بلا رمز ⇒ 2 · ملفٌّ صحيحٌ + معدَّل ⇒ 1.

## 4. حكمُ CI على فرعِ الإصلاح

يُسجَّلُ في §4 بإضافةٍ بعدَ التشغيل (`ci-run-*.md` في هذا المجلد) — لا يُعَدُّ الإصلاحُ مُثبَتًا قبلَه.

## 5. ما بعدَ الدمج (بعدَ رفعِ الحاجزِ فقط)

إعادةُ قراءةِ الرأسِ والموافقةِ والفحوصِ مباشرةً ثمّ `scripts/ops/merge-on-approved-head.sh <pr> --squash` وحدَه · WASLA CI (41/41) · Roadmap freshness · Render deploy: `render-sync.json` يجبُ أن يُظهرَ **24/24** موردًا `matches_target` على SHA الدمج — وإلا فالنشرُ غيرُ مكتمل ويُسجَّلُ الإخفاق.

## 6. الحالات

INC-0007 `Open` (تدويرُ مفتاحِ Render **وتوكناتِ البوتات** وإثباتُ صلاحيتِها بعدَ التحديث — لم يحدث) · RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 — **بلا تغيير**. لا معايرةَ DR، ولا حمل، ولا RISK-0058، ولا `workflow_dispatch`.
