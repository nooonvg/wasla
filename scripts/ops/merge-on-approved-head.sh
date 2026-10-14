#!/usr/bin/env bash
# merge-on-approved-head.sh — the agent's ONLY merge path (CLM-0559 · RISK-0064 · CLM-0494 §6.1–§6.2).
#
# Why: the owner's written rule (docs/16-progress/SINGLE_REVIEWER_DEPENDENCY_REVIEW_2026-10-07.md
# §6.1) says the agent merges only when the approval is on the CURRENT head (`commit_id` = head
# SHA), with `--match-head-commit`, and never on a stale approval. Branch protection on `main`
# does not enforce this (`dismiss_stale_reviews=false`, `require_last_push_approval=false`), and
# the owner decided on 2026-10-08 not to change protection (alternative E deferred). Behaviour
# alone failed: 7 of 58 merges since #650 were on a non-head approval (CLM-0558 §7). This script
# turns the rule into a refusal the agent cannot skip by forgetting.
#
# It changes NO setting. It never passes `--admin`. It refuses unless ALL hold, read from the API:
#   1. the PR is open and its head SHA is read now;
#   2. the newest review of the required reviewer is APPROVED with `commit_id` == that head SHA,
#      and the reviewer is not the PR author;
#   3. no review on that head is CHANGES_REQUESTED;
#   4. every check run on that head is completed, none failed/cancelled/timed out, at least one
#      succeeded;
# then merges with `--match-head-commit <head>` so a push between the read and the merge fails.
#
# Usage: scripts/ops/merge-on-approved-head.sh <pr-number> [--squash|--merge|--rebase]
# Env:   REPO (default skyosv10-art/wasla) · REQUIRED_REVIEWER (default xuuux-voox) · GH (default gh)
#        DRY_RUN=1 → print the decision, do not merge.
set -euo pipefail

GH="${GH:-gh}"
REPO="${REPO:-skyosv10-art/wasla}"
REQUIRED_REVIEWER="${REQUIRED_REVIEWER:-xuuux-voox}"
PR="${1:-}"
METHOD="${2:---squash}"

refuse() { printf 'REFUSED pr=%s: %s\n' "$PR" "$*" >&2; exit 1; }

[[ "$PR" =~ ^[0-9]+$ ]] || refuse "usage: $0 <pr-number> [--squash|--merge|--rebase]"
case "$METHOD" in --squash|--merge|--rebase) ;; *) refuse "merge method must be --squash, --merge or --rebase (never --admin)";; esac
for arg in "$@"; do [[ "$arg" == "--admin" ]] && refuse "--admin is forbidden (CLM-0494 §6.2)"; done

# 1. PR state and head, read now.
pr_line="$("$GH" api "repos/$REPO/pulls/$PR" --jq '[.state, .head.sha, .user.login] | @tsv')" \
  || refuse "cannot read the PR"
IFS=$'\t' read -r state head author <<<"$pr_line"
[[ "$state" == "open" ]] || refuse "PR state is '$state', not open"
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || refuse "head SHA unreadable ('$head')"

# 2–3. Reviews (paged list, oldest first).
reviews="$("$GH" api --paginate "repos/$REPO/pulls/$PR/reviews" --jq '.[] | [.user.login, .state, .commit_id, .submitted_at] | @tsv')" \
  || refuse "cannot read reviews"
[[ "$REQUIRED_REVIEWER" != "$author" ]] || refuse "required reviewer is the PR author ($author)"
latest="$(printf '%s\n' "$reviews" | awk -F'\t' -v r="$REQUIRED_REVIEWER" '$1==r && ($2=="APPROVED" || $2=="CHANGES_REQUESTED" || $2=="DISMISSED") {l=$0} END{print l}')"
[[ -n "$latest" ]] || refuse "no decisive review by $REQUIRED_REVIEWER"
IFS=$'\t' read -r _ rstate rcommit rtime <<<"$latest"
[[ "$rstate" == "APPROVED" ]] || refuse "latest review by $REQUIRED_REVIEWER is $rstate"
[[ "$rcommit" == "$head" ]] || refuse "approval is on $rcommit, current head is $head — stale approval; re-request review"
if printf '%s\n' "$reviews" | awk -F'\t' -v h="$head" '$3==h && $2=="CHANGES_REQUESTED"{f=1} END{exit f?0:1}'; then
  refuse "a CHANGES_REQUESTED review exists on head $head"
fi

# 4. Check runs on the head.
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

printf 'OK pr=%s head=%s approved_by=%s approval_commit=%s approved_at=%s checks: success=%s skipped_or_neutral=%s failed=0 pending=0\n' \
  "$PR" "$head" "$REQUIRED_REVIEWER" "$rcommit" "$rtime" "$passed" "$skipped"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf 'DRY_RUN: would run: %s pr merge %s --repo %s %s --match-head-commit %s\n' "$GH" "$PR" "$REPO" "$METHOD" "$head"
  exit 0
fi
"$GH" pr merge "$PR" --repo "$REPO" "$METHOD" --match-head-commit "$head"
