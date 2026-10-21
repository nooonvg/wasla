#!/usr/bin/env bash
# validate-xr-domain-freeze.sh — الفحص 29 (XR-1.1 · XR-1.2 · XR-1.3 · ADR-076 · M0-54).
#
# مجالُ MOVE ومجالاتُ CORE المكرّرةُ هنا مجمَّدةٌ: لا يُقبَلُ تغييرٌ في مسارٍ مجمَّدٍ
# إلا إن كان (أ) حذفًا للملفّ (إزالةٌ في XR-5)، أو (ب) في نطاقِ رسالةِ إيداعٍ تحملُ
# `XR-RETIRE` (عملُ الإزالة) أو `SECURITY` (إصلاحٌ أمنيّ). كلُّ ما عدا ذلك رفض.
#
# المرجع: docs/ecosystem/ECOSYSTEM_ROADMAP.md §4 (XR-1) ·
#         docs/15-decisions/ADR-076-move-sole-delivery-owner-market-retirement.md
#
#   bash scripts/checks/validate-xr-domain-freeze.sh OLD NEW   # نطاقُ git
#   bash scripts/checks/validate-xr-domain-freeze.sh --self-test
#
# للاختبار بلا git: XR_FREEZE_CHANGES="<status>\t<path>\n…" و XR_FREEZE_MESSAGES="…".
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

# shellcheck source=lib/xr-frozen-paths.sh
source "scripts/checks/lib/xr-frozen-paths.sh"

is_frozen() { # is_frozen <path>
  local p="$1" f
  for f in "${XR_FROZEN_PREFIXES[@]}"; do [[ "$p" == "$f"* ]] && return 0; done
  for f in "${XR_FROZEN_FILES[@]}"; do [[ "$p" == "$f" ]] && return 0; done
  return 1
}

evaluate() { # evaluate <changes-name-status> <messages> → rc 0 ok / 1 violation
  local changes="$1" messages="$2" status path rest violations=0 exempt=""
  if grep -Eq '(^|[^A-Za-z0-9_])(XR-RETIRE|SECURITY)([^A-Za-z0-9_]|$)' <<<"$messages"; then
    exempt="$(grep -Eo '(XR-RETIRE|SECURITY)' <<<"$messages" | sort -u | tr '\n' ' ')"
  fi
  while IFS=$'\t' read -r status path rest; do
    [[ -z "${status:-}" ]] && continue
    # الإعادةُ تسمّي (R100 old new): المسارُ الجديدُ هو المعنيّ، والقديمُ يُعدُّ حذفًا
    if [[ "$status" == R* ]]; then
      path="$rest"
      status="A"
    fi
    is_frozen "$path" || continue
    if [[ "$status" == D ]]; then
      printf '  ✓ removal  %s\n' "$path"
      continue
    fi
    if [[ -n "$exempt" ]]; then
      printf '  ✓ %s%s\n' "$exempt" "$path"
      continue
    fi
    printf '  ✗ [XR-FREEZE] %s %s — frozen by ADR-076 (XR-1). Removal, or a commit tagged XR-RETIRE / SECURITY, only.\n' "$status" "$path"
    violations=$((violations + 1))
  done <<<"$changes"
  if (( violations )); then
    printf '✗ xr-domain-freeze: %d change(s) in frozen MOVE/CORE domains\n' "$violations"
    return 1
  fi
  printf '✓ xr-domain-freeze: no unapproved change in %d frozen prefixes + %d frozen files\n' \
    "${#XR_FROZEN_PREFIXES[@]}" "${#XR_FROZEN_FILES[@]}"
  return 0
}

self_test() {
  local fails=0 out
  check() { # check <expect-rc> <label> <changes> <messages>
    out="$(evaluate "$3" "$4" 2>&1)"; local rc=$?
    if [[ "$rc" == "$1" ]]; then printf '  ✓ self-test: %s\n' "$2"
    else printf '  ✗ self-test: %s (rc=%s, expected %s)\n%s\n' "$2" "$rc" "$1" "$out"; fails=$((fails + 1)); fi
  }
  check 1 "modification in services/dispatch is rejected" $'M\tservices/dispatch/src/index.ts' "feat: tweak"
  check 1 "addition in bots/driver-bot is rejected" $'A\tbots/driver-bot/src/new.ts' "feat: new"
  check 1 "frozen delivery leg file is rejected" $'M\tservices/delivery/src/use-cases/delegate-to-dispatch.ts' "fix"
  check 1 "rename into a frozen prefix is rejected" $'R100\tservices/marketplace/a.ts\tservices/drivers/a.ts' "chore"
  check 0 "deletion in services/matching is allowed" $'D\tservices/matching/src/index.ts' "chore: remove"
  check 0 "XR-RETIRE commit may edit frozen paths" $'M\tservices/orders/package.json' "chore(xr): XR-RETIRE unwire orders"
  check 0 "SECURITY commit may edit frozen paths" $'M\tservices/identity/src/a.ts' "fix: SECURITY patch"
  check 0 "store_order code in services/delivery stays open" $'M\tservices/delivery/src/domain/store-order.ts' "feat"
  check 0 "services/marketplace stays open" $'M\tservices/marketplace/src/a.ts' "feat"
  check 1 "SECURITYX is not the SECURITY tag" $'M\tservices/billing/src/a.ts' "SECURITYX"
  check 1 "SECURITY_RULES is not the SECURITY tag" $'M\tservices/billing/src/a.ts' "docs: SECURITY_RULES §11"
  if (( fails )); then printf '✗ xr-domain-freeze self-test: %d failure(s)\n' "$fails"; return 1; fi
  printf '✓ xr-domain-freeze self-test: all cases\n'
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit $?
fi

if [[ -n "${XR_FREEZE_CHANGES:-}" ]]; then
  evaluate "$XR_FREEZE_CHANGES" "${XR_FREEZE_MESSAGES:-}"
  exit $?
fi

OLD="${1:-origin/main}"
NEW="${2:-HEAD}"
if ! git rev-parse --verify "${OLD}^{commit}" >/dev/null 2>&1; then
  printf '✗ xr-domain-freeze: cannot resolve %s (fail-closed)\n' "$OLD"
  exit 1
fi
BASE="$(git merge-base "$OLD" "$NEW")" || { printf '✗ xr-domain-freeze: no merge base\n'; exit 1; }
self_test >/dev/null || { self_test; exit 1; }
# كلُّ إيداعٍ يُقاس وحدَه: وسمُ XR-RETIRE / SECURITY يُعفي ملفّاتِ إيداعِه هو لا النطاقَ كلَّه.
RC=0
N=0
while read -r C; do
  [[ -z "$C" ]] && continue
  N=$((N + 1))
  CH="$(git diff-tree --no-commit-id --name-status -r -M "$C")"
  MSG="$(git log -1 --format=%B "$C")"
  OUT="$(evaluate "$CH" "$MSG")" || { printf '  commit %s:\n%s\n' "${C:0:7}" "$OUT"; RC=1; }
done < <(git rev-list --no-merges "$BASE..$NEW")
if (( RC )); then
  printf '✗ xr-domain-freeze: unapproved change in frozen MOVE/CORE domains (ADR-076 · XR-1)\n'
  exit 1
fi
printf '✓ xr-domain-freeze: %d commit(s) checked · %d frozen prefixes + %d frozen files (ADR-076 · XR-1)\n' \
  "$N" "${#XR_FROZEN_PREFIXES[@]}" "${#XR_FROZEN_FILES[@]}"
