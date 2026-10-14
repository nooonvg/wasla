# gov-cases-merge-guard.sh — cases for scripts/ops/merge-on-approved-head.sh (CLM-0559 · RISK-0064).
#
# Sourced from scripts/checks/test-governance.sh; relies on t() defined there.
# The guard is exercised against a stub `gh` (no network): each case writes the API answers
# the stub returns, then asserts the guard merges ONLY when the required reviewer's newest
# review is APPROVED on the exact current head and every check run on that head passed — and
# that the merge it issues carries --match-head-commit <head> and never --admin.
#
# Reference: docs/16-progress/SINGLE_REVIEWER_DEPENDENCY_REVIEW_2026-10-07.md §6.1–§6.2 and §7.

printf '\n\033[1m[م] حارسُ الدمجِ على الرأسِ المعتمَد (CLM-0559 · RISK-0064)\033[0m\n'

MG="$REPO_ROOT/scripts/ops/merge-on-approved-head.sh"
if [[ ! -f "$MG" ]]; then
  printf '  \033[31m✗\033[0m %s مفقود\n' "$MG"; ((FAIL++))
  return 0 2>/dev/null || exit 1
fi

MG_DIR="$(mktemp -d)"
MG_HEAD=1111111111111111111111111111111111111111
MG_OLD=2222222222222222222222222222222222222222
cat > "$MG_DIR/gh" <<'STUB'
#!/usr/bin/env bash
# stub gh: answers from files in $MG_DIR; records merge invocations.
d="$MG_DIR"
if [[ "$1" == "pr" && "$2" == "merge" ]]; then printf '%s\n' "$*" >> "$d/merged"; exit 0; fi
url=""; for a in "$@"; do [[ "$a" == repos/* ]] && url="$a"; done
case "$url" in
  */reviews)     cat "$d/reviews" ;;
  */check-runs)  cat "$d/runs" ;;
  */pulls/*)     cat "$d/pr" ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$MG_DIR/gh"

_mg_set() { # _mg_set <pr-line> <reviews> <runs>
  printf '%b\n' "$1" > "$MG_DIR/pr"; printf '%b\n' "$2" > "$MG_DIR/reviews"; printf '%b\n' "$3" > "$MG_DIR/runs"
  rm -f "$MG_DIR/merged"
}
_mg_run() { MG_DIR="$MG_DIR" GH="$MG_DIR/gh" REPO=o/r REQUIRED_REVIEWER=rev bash "$MG" 7 --squash; }
_mg_merged_on_head() { _mg_run && grep -q -- "--match-head-commit $MG_HEAD" "$MG_DIR/merged" && ! grep -q -- "--admin" "$MG_DIR/merged"; }

OPEN="open\t$MG_HEAD\tauthor"
GREEN="WASLA CI / verify\tcompleted\tsuccess\nRestore\tcompleted\tskipped"

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "$GREEN"
t "الموافقةُ على الرأسِ والفحوصُ خضراء ⇒ دمجٌ بـ--match-head-commit" pass _mg_merged_on_head

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_OLD\t2026-10-14T00:00:00Z" "$GREEN"
t "موافقةٌ على التزامٍ أقدم (حالةُ #711) ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z\nrev\tCHANGES_REQUESTED\t$MG_HEAD\t2026-10-14T01:00:00Z" "$GREEN"
t "طلبُ تغييراتٍ بعدَ الموافقةِ على الرأس ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z\nrev\tDISMISSED\t$MG_HEAD\t2026-10-14T01:00:00Z" "$GREEN"
t "موافقةٌ أُسقطت (DISMISSED) ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "other\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "$GREEN"
t "موافقةٌ من غيرِ المراجِعِ المطلوب ⇒ رفض" fail _mg_run

_mg_set "open\t$MG_HEAD\trev" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "$GREEN"
t "المراجِعُ هو صاحبُ الـPR (موافقةٌ ذاتية) ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "WASLA CI / verify\tcompleted\tfailure"
t "فحصٌ فاشلٌ على الرأس ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "WASLA CI / verify\tin_progress\t"
t "فحصٌ لم يكتملْ على الرأس ⇒ رفض" fail _mg_run

_mg_set "closed\t$MG_HEAD\tauthor" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "$GREEN"
t "PR غيرُ مفتوح ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "rev\tAPPROVED\t$MG_HEAD\t2026-10-14T00:00:00Z" "$GREEN"
t "--admin يُرفضُ ولو كانَ كلُّ شيءٍ أخضر" fail env MG_DIR="$MG_DIR" GH="$MG_DIR/gh" REPO=o/r REQUIRED_REVIEWER=rev bash "$MG" 7 --admin

rm -rf "$MG_DIR"
