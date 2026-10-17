#!/usr/bin/env bash
# merge-on-approved-head.sh — the agent's ONLY merge path (CLM-0559 · RISK-0064 · CLM-0494 §6.1–§6.2).
#
# ADR-071 (owner decision 2026-10-17): a reviewer approval is NO LONGER a required merge
# condition. The required-reviewer approval checks of the pre-ADR-071 guard were removed by
# that decision; see docs/15-decisions/ADR-071-approval-not-required-for-merge.md. Approvals
# are advisory. What the guard still refuses on, read from the API:
#   1. the PR is open and its head SHA is read now;
#   2. no review on that head is CHANGES_REQUESTED (an explicit objection blocks the merge —
#      this is not an approval condition; kept deliberately, see ADR-071);
#   3. every check run on that head is completed, none failed/cancelled/timed out, at least one
#      succeeded;
# then merges with `--match-head-commit <head>` so a push between the read and the merge fails.
# It never passes `--admin`.
#
# Usage: scripts/ops/merge-on-approved-head.sh <pr-number> [--squash|--merge|--rebase]
# Env:   REPO (default skyosv10-art/wasla) · GH (default gh) · DRY_RUN=1 → print, do not merge.
set -euo pipefail

GH="${GH:-gh}"
REPO="${REPO:-skyosv10-art/wasla}"
PR="${1:-}"
METHOD="${2:---squash}"

refuse() { printf 'REFUSED pr=%s: %s\n' "$PR" "$*" >&2; exit 1; }

[[ "$PR" =~ ^[0-9]+$ ]] || refuse "usage: $0 <pr-number> [--squash|--merge|--rebase]"
case "$METHOD" in --squash|--merge|--rebase) ;; *) refuse "merge method must be --squash, --merge or --rebase (never --admin)";; esac
for arg in "$@"; do [[ "$arg" == "--admin" ]] && refuse "--admin is forbidden (CLM-0494 §6.2 · ADR-071)"; done

# 1. PR state and head, read now.
pr_line="$("$GH" api "repos/$REPO/pulls/$PR" --jq '[.state, .head.sha] | @tsv')" \
  || refuse "cannot read the PR"
IFS=$'\t' read -r state head <<<"$pr_line"
[[ "$state" == "open" ]] || refuse "PR state is '$state', not open"
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || refuse "head SHA unreadable ('$head')"

# 2. Reviews: only an explicit CHANGES_REQUESTED on the current head blocks (ADR-071:
#    approval is not a required condition; objections still are).
reviews="$("$GH" api --paginate "repos/$REPO/pulls/$PR/reviews" --jq '.[] | [.state, .commit_id] | @tsv')" \
  || refuse "cannot read reviews"
if printf '%s\n' "$reviews" | awk -F'\t' -v h="$head" '$2==h && $1=="CHANGES_REQUESTED"{f=1} END{exit f?0:1}'; then
  refuse "a CHANGES_REQUESTED review exists on head $head (objection blocks merge — ADR-071)"
fi

# 3. Check runs on the head.
runs="$("$GH" api --paginate "repos/$REPO/commits/$head/check-runs" --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv')" \
  || refuse "cannot read check runs"
[[ -n "$runs" ]] || refuse "no check runs on head $head"
pending="$(printf '%s\n' "$runs" | awk -F'\t' '$2!="completed"' | wc -l | tr -d ' ')"
failed="$(printf '%s\n' "$runs" | awk -F'\t' '$2=="completed" && $3!="success" && $3!="skipped" && $3!="neutral"' | wc -l | tr -d ' ')"
passed="$(printf '%s\n' "$runs" | awk -F'\t' '$3=="success"' | wc -l | tr -d ' ')"
skipped="$(printf '%s\n' "$runs" | awk -F'\t' '$3=="skipped" || $3=="neutral"' | wc -l | tr -d ' ')"
(( pending == 0 )) || refuse "$pending check run(s) not completed on head $head"
(( failed == 0 ))  || refuse "$failed check run(s) failed on head $head"
(( passed > 0 ))   || refuse "no successful check run on head $head"

printf 'OK pr=%s head=%s policy=ADR-071-approval-not-required changes_requested_on_head=no checks: success=%s skipped_or_neutral=%s failed=0 pending=0\n' \
  "$PR" "$head" "$passed" "$skipped"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf 'DRY_RUN: would run: %s pr merge %s --repo %s %s --match-head-commit %s\n' "$GH" "$PR" "$REPO" "$METHOD" "$head"
  exit 0
fi
"$GH" pr merge "$PR" --repo "$REPO" "$METHOD" --match-head-commit "$head"
