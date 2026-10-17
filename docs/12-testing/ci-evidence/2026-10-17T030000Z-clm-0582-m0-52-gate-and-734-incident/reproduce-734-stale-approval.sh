#!/usr/bin/env bash
# ⚠ إشعارٌ مؤرَّخ (ADR-071 · 2026-10-17): هذا السكربتُ دليلٌ تاريخيٌّ على سلوكِ الحارسِ **قبلَ ADR-071**
# (سياسةُ «الموافقةُ على الرأسِ شرطًا» — أُلغيت بقرارِ المالكِ). لا يعكسُ سلوكَ الحارسِ الحاليّ:
# بموجبِ ADR-071، دمجُ الـPR لا يشترطُ موافقةً، والسيناريو الذي كانَ يُرفضُ هنا (موافقةٌ قديمةٌ
# وفحوصٌ خضراء) يُدمَجُ الآن. حُفظَ هذا الملفُ كأثرٍ تاريخيّ.
# reproduce-734-stale-approval.sh — إعادةُ إنتاجٍ حتميةٍ (بلا شبكةٍ) لواقعةِ دمجِ PR #734
# بموافقةٍ قديمةٍ، لمحاكاةِ سلوكِ حارسِ الدمجِ `scripts/ops/merge-on-approved-head.sh`.
#
# الواقعة (قياسُ GitHub API · 2026-10-17):
#   - الموافقة: xuuux-voox APPROVED على d61bed93a1dae… (2026-10-17T02:19:34Z)
#   - ثلاثُ دفعاتٍ بعدَها: b6b826a2 (02:19:44Z) · 6ca5a7f9 (02:19:51Z) · be1d6c84 (02:44:20Z)
#   - الدمجُ وقعَ 02:57:07Z (squash b883c7d6) بمسارٍ مباشرٍ تجاوزَ الحارسَ.
# هذا السكربتُ يُعيدُ نفسَ الشكلِ (PR مفتوح · رأسٌ be1d6c84 · موافقةٌ على d61bed93 · فحوصٌ خضراء)
# ويُثبتُ أنَّ الحارسَ **يرفضُ**: «stale approval; re-request review» ولا يُصدرُ أيَّ دمجٍ.
#
# الاستعمال: bash reproduce-734-stale-approval.sh   (يتوقعُ exit=1 وREFUSED)
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
MG="$REPO_ROOT/scripts/ops/merge-on-approved-head.sh"
[[ -f "$MG" ]] || { echo "guard missing: $MG" >&2; exit 2; }

D="$(mktemp -d)"
cat > "$D/gh" <<STUB
#!/usr/bin/env bash
d="$D"
if [[ "\$1" == "pr" && "\$2" == "merge" ]]; then printf '%s\n' "\$*" >> "\$d/merged"; exit 0; fi
url=""; for a in "\$@"; do [[ "\$a" == repos/* ]] && url="\$a"; done
case "\$url" in
  */reviews)     cat "\$d/reviews" ;;
  */check-runs)  cat "\$d/runs" ;;
  */pulls/*)     cat "\$d/pr" ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$D/gh"

# شكلُ #734 حرفيًّا: مفتوح · الرأسُ be1d6c84… · موافقةُ xuuux-voox على d61bed93… · فحوصٌ خضراء
printf 'open\tbe1d6c84deadbeefdeadbeefdeadbeefdeadbeef\tskyosv10-art\n' > "$D/pr"
printf 'xuuux-voox\tAPPROVED\td61bed93a1dae2276d6ffc9918cc65a4184cf196\t2026-10-17T02:19:34Z\n' > "$D/reviews"
printf 'WASLA CI / verify\tcompleted\tsuccess\nRoadmap freshness\tcompleted\tsuccess\n' > "$D/runs"

echo "=== إعادةُ إنتاجِ واقعةِ #734 ضدَّ الحارس (موافقةٌ على d61bed93 · الرأسُ be1d6c84) ==="
GH="$D/gh" REPO=skyosv10-art/wasla REQUIRED_REVIEWER=xuuux-voox bash "$MG" 734 --squash
rc=$?
echo "guard exit=$rc"
if [[ -f "$D/merged" ]]; then
  echo "FAIL: the guard issued a merge — reproduction did not hold"
  rm -rf "$D"; exit 1
fi
echo "PASS: no merge issued (expected refusal)"
rm -rf "$D"
exit "$rc"
