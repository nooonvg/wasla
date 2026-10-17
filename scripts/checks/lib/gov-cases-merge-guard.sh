# gov-cases-merge-guard.sh — cases for scripts/ops/merge-on-approved-head.sh (CLM-0559 · RISK-0064 · ADR-071).
#
# Sourced from scripts/checks/test-governance.sh; relies on t() defined there.
# The guard is exercised against a stub `gh` (no network): each case writes the API answers
# the stub returns, then asserts the guard merges when the PR is open with green checks on
# the current head — with or without any approval (ADR-071: approval is not a required
# condition) — and refuses on an explicit objection (CHANGES_REQUESTED on head), a failed or
# pending check, a non-open PR, or `--admin`. The merge it issues must carry
# --match-head-commit <head> and never --admin.
#
# Reference: docs/15-decisions/ADR-071-approval-not-required-for-merge.md and
# docs/16-progress/SINGLE_REVIEWER_DEPENDENCY_REVIEW_2026-10-07.md §6–§9.

printf '\n\033[1m[م] حارسُ الدمجِ على الرأسِ المعتمَد (CLM-0559 · RISK-0064 · ADR-071)\033[0m\n'

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
_mg_run() { MG_DIR="$MG_DIR" GH="$MG_DIR/gh" REPO=o/r bash "$MG" 7 --squash; }
_mg_merged_on_head() { _mg_run && grep -q -- "--match-head-commit $MG_HEAD" "$MG_DIR/merged" && ! grep -q -- "--admin" "$MG_DIR/merged"; }

OPEN="open\t$MG_HEAD"
GREEN="WASLA CI / verify\tcompleted\tsuccess\nRestore\tcompleted\tskipped"

_mg_set "$OPEN" "" "$GREEN"
t "لا مراجعةَ إطلاقًا (ADR-071: الموافقةُ ليست شرطًا) والفحوصُ خضراء ⇒ دمجٌ بـ--match-head-commit" pass _mg_merged_on_head

_mg_set "$OPEN" "APPROVED\t$MG_HEAD" "$GREEN"
t "موافقةٌ موجودةٌ على الرأس ⇒ دمج (استشاريةٌ لا شرط)" pass _mg_merged_on_head

_mg_set "$OPEN" "APPROVED\t$MG_OLD" "$GREEN"
t "موافقةٌ على التزامٍ أقدم (شكلُ #734) ⇒ دمجٌ الآن (ADR-071 ألغى شرطَ الموافقة)" pass _mg_merged_on_head

_mg_set "$OPEN" "APPROVED\t$MG_HEAD\nCHANGES_REQUESTED\t$MG_HEAD" "$GREEN"
t "اعتراضٌ صريحٌ (CHANGES_REQUESTED) على الرأس ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "APPROVED\t$MG_HEAD" "WASLA CI / verify\tcompleted\tfailure"
t "فحصٌ فاشلٌ على الرأس ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "APPROVED\t$MG_HEAD" "WASLA CI / verify\tin_progress\t"
t "فحصٌ لم يكتملْ على الرأس ⇒ رفض" fail _mg_run

_mg_set "closed\t$MG_HEAD" "APPROVED\t$MG_HEAD" "$GREEN"
t "PR غيرُ مفتوح ⇒ رفض" fail _mg_run

_mg_set "$OPEN" "APPROVED\t$MG_HEAD" "$GREEN"
t "--admin يُرفضُ ولو كانَ كلُّ شيءٍ أخضر" fail env MG_DIR="$MG_DIR" GH="$MG_DIR/gh" REPO=o/r bash "$MG" 7 --admin

rm -rf "$MG_DIR"
