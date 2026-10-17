# ADR-071: Reviewer Approval Is Not a Required Merge Condition

**Status:** Accepted
**Date:** 2026-10-17
**Decider:** Program Owner (written decision relayed to the agent — quoted in §Decision)
**Supersedes:** The approval requirement in ADR-0494 §6.1/§6.2 practice (CLM-0493/CLM-0559) — not the decisions' other content
**Related:** RISK-0064 (single-reviewer dependency), CLM-0559 §7.3 (`merge-on-approved-head.sh`), ADR-061 (STATE-SYNC), M6-19B

## Context

The repository runs with a single reviewer (`xuuux-voox`) and an agent that authors and merges as the owner account (`skyosv10-art`). RISK-0064 measured this single-reviewer dependency: bus factor 1, merge capacity bounded entirely by one reviewer's availability, 15/60 then 7/58 merges on a non-head approval. The owner decided 2026-10-08 (CLM-0494) to keep that reviewer as the only CODEOWNER reviewer and deferred alternative E (protection-side enforcement). The behavioural guard `scripts/ops/merge-on-approved-head.sh` (CLM-0559) was the agent's only merge path: it refused to merge unless the required reviewer's newest review was APPROVED on the exact current head.

The cost of that policy, measured in this repository: every merge — including security fixes — waits for one person's availability, and that person's absence freezes all merges (RISK-0064 impact).

## Decision

The program owner's written decision (2026-10-17), recorded verbatim:

> «اعتمد أن موافقة المراجع ليست شرطًا مطلوبًا لدمج PR مستقبلًا. راجع إعدادات حماية main الفعلية، وحارس scripts/ops/merge-on-approved-head.sh، واختبارات الطفرة، وCODEOWNERS، وقواعد الحوكمة والوثائق وRISK-0064. أنشئ ADR وسجل قرار المالك، ثم عدّل التنفيذ والاختبارات والوثائق لإزالة الاعتماد الإلزامي على موافقة xuuux-voox أو أي موافقة أخرى. أبقِ فحوص CI الإلزامية، والتحقق من أحدث SHA باستخدام --match-head-commit، وضوابط الحالة وتنظيف الفروع. لا تستخدم --admin ولا تتجاوز مسار الدمج المصرح به. لا تغيّر صلاحيات تعاون أي شخص أو دوره في المستودع حتى يُحدد المالك نطاق سحب تلك الصلاحيات.»

Consequences of the decision:

1. **A reviewer approval is no longer a required condition to merge a PR.** Approvals remain possible and welcome (advisory feedback), but their absence, staleness, or presence on an older commit no longer blocks a merge.
2. **`CHANGES_REQUESTED` on the current head still blocks the merge.** This is not an approval condition — it is an explicit objection. Respecting it preserves human feedback without restoring the single-reviewer bottleneck. (Kept deliberately; if the owner wants this removed too, that is a separate written decision.)
3. **Branch protection on `main` is updated to match the decision** (executed only after this ADR merges via the sanctioned path): `required_approving_review_count: 1 → 0` and `require_code_owner_reviews: true → false`. Everything else is kept: strict required status checks (41 contexts), `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`, `dismiss_stale_reviews`/`require_last_push_approval` unchanged (moot without a required approval).
4. **CODEOWNERS is kept as-is** (ownership map and auto-review requests stay; they become advisory). No collaborator's role or permission is changed by this ADR — the owner explicitly reserved revocation scope to a separate decision.

## What is NOT changed

- **The sanctioned merge path**: the agent merges only via `scripts/ops/merge-on-approved-head.sh` (renamed semantics: merge on the *verified* head). `--admin` remains forbidden. Direct `gh pr merge` by the agent remains a violation of the operating rules.
- **`--match-head-commit <head>`** — the merge still pins the exact head read at decision time, so any push between read and merge fails the merge.
- **Mandatory CI**: strict required status checks on `main` still gate every merge (41 contexts).
- **State guards**: checks 26/27 (`validate-state-sync`, `validate-merged-branches`) still run in every PR and every push to `main` (ADR-061).
- **Branch cleanup**: `delete_branch_on_merge` + `merged-branch-cleanup.yml` + check 27 still enforce merged-branch hygiene.
- **RISK-0064 status and the #734 deviation record are not auto-closed by this ADR.** The decision removes the merge-freeze impact, but review effectiveness remains unproven and the risk's closure is the owner's call at its scheduled review (2026-11-08) or an explicit decision. The #734 deviation (a merge on a stale approval under the then-applicable rule) remains recorded as history; its *enforcement rationale* is superseded by this ADR.

## Effect on the guard and its tests

- `scripts/ops/merge-on-approved-head.sh`: the required-reviewer approval checks are removed. The guard still refuses unless: the PR is open, the head is read now, no `CHANGES_REQUESTED` on that head, every check run on that head is completed with none failed and at least one success — then merges with `--match-head-commit <head>`, never `--admin`.
- `scripts/checks/lib/gov-cases-merge-guard.sh`: mutation cases rewritten — merging with **no approval at all** and with a **stale approval** (the exact #734 shape) now pass (policy change), while failed/pending checks, closed PRs, `CHANGES_REQUESTED` on head, and `--admin` still refuse.
- The historical replay `docs/12-testing/ci-evidence/2026-10-17T030000Z-clm-0582-m0-52-gate-and-734-incident/reproduce-734-stale-approval.sh` documented the **pre-ADR-071** guard; a dated notice is added to it so it is not mistaken for current behaviour.

## Sequencing (recorded for the audit trail)

The policy takes effect only through the sanctioned path: this ADR + code/test/doc changes merge as one PR (itself merged under the still-current approval policy), and only then is the branch-protection setting updated and re-measured live. Until that merge, no merge may rely on the new policy.
