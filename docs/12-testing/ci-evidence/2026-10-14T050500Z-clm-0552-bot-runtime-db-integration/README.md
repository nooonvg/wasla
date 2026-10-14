# CLM-0552 — the required check `db-integration (bot-runtime, …)` had no producer: root cause and fix

**Measured:** 2026-10-14T05:05:53Z (UTC) · **Claim:** `CLM-0552` (branch `ci/clm-0552-bot-runtime-db-integration`) · **Work item:** M0-25 (merge-blocking guard).
**State change:** none to any risk or launch gate. `RISK-0067` stays `mitigating` · `M6-18B` stays `Blocked` · `NO-GO` · R-02 · R-07 · P-03 · P-04 · P-05 stay as they are.

## 1. Symptom

PR #708 (CLM-0551, head `9d5610b`) had every check it produced green (41/41 check-runs `success`) and two approvals, yet
`mergeable_state` stayed `blocked`. The merge — including the owner-authorised `gh pr merge 708 --admin --squash`
(authorised in-session 2026-10-14T04:58Z) — was rejected by GitHub with:

```
GraphQL: Required status check "db-integration (bot-runtime, @wasla/bot-runtime, wasla_bot_runtime_test)" is expected. (mergePullRequest)
```

`enforce_admins` is `true`, so `--admin` cannot bypass a required check — and it should not.

## 2. Root cause (measured, not inferred)

| Reading | Value | Raw |
| --- | --- | --- |
| Live required contexts on `main` | **41** · `strict: true` · `enforce_admins: true` | [raw-branch-protection.json](raw-branch-protection.json) · [required-contexts-live.txt](required-contexts-live.txt) |
| Check-runs produced on PR #708 head `9d5610b` | 41 (`per_page=100`, `total_count` 41) | [pr-708-head-9d5610b-check-runs.txt](pr-708-head-9d5610b-check-runs.txt) |
| Required but **never produced** | `db-integration (bot-runtime, @wasla/bot-runtime, wasla_bot_runtime_test)` | [required-without-producer.txt](required-without-producer.txt) |
| PR #707 head check-runs (merged 2026-10-13T22:51:17Z) | 42 = the same set + `cleanup` — **no bot-runtime either** | [pr-707-head-check-runs.txt](pr-707-head-check-runs.txt) |
| `bot-runtime` / `wasla_bot_runtime_test` in `.github/workflows/ci.yml` on `main` 84ae243 | **absent** (`git grep` → 0 hits) | — |
| `docs/12-testing/MERGE_BLOCKING.json` snapshot | 40 contexts (2026-09-28) — **did not list it** | — |
| `@wasla/bot-runtime` `test:integration` script | **did not exist** | — |

So the protection on `main` requires a context that no workflow job emits. Since #705–#707 merged without it, the
context was added to the protection **after 2026-10-13T22:51:17Z**. Who added it and why is **not measured**: a
user-owned repository exposes no audit-log API to this agent. It is recorded as unknown, not assumed.

Consequence: **every** PR to `main` is blocked, not only #708. `validate-merge-blocking.sh` (M0-25) would also have
flagged the drift if run live (snapshot 40 ≠ live 41).

## 3. Fix — at the source, not at the gate

The gate is not weakened: the context stays required, nothing is removed from the protection, nothing is skipped.
The missing **producer** is added, and it tests something real:

1. `packages/bot-runtime/src/__tests__/postgres-persistence.integration.test.ts` — the composed bot built from env
   (`DATABASE_URL`, no `stores` override) on a live Postgres:
   - an end-to-end `/start` is persisted to `channel_updates` / `channel_deliveries` / `channel_outbox`;
   - **de-duplication survives a process restart** (second process, same DB, same `update_id` → `duplicate`, no identity
     call, no reply, no new rows) — the guarantee the in-memory path loses (runtime.ts, MR 5);
   - de-duplication is scoped per bot (same `update_id` on two bots = two updates).
2. `packages/bot-runtime/src/__tests__/database-health.integration.test.ts` — `/health` probes the pool the bot really
   builds: reachable DB → 200 `x-wasla-database: up`; unreachable DB → 503 `down` (RISK-0058 · ADR-059).
3. `packages/bot-runtime/src/__tests__/pg-harness.ts` — applies the canonical `packages/channel-core/contracts/schema.sql`
   (never a copy); the admin pool comes from `createChannelDb`, so no new dependency and no lockfile change.
4. `packages/bot-runtime/{vitest.config.ts,vitest.integration.config.ts,package.json}` — `test:integration`; the default
   `pnpm -r test` excludes `*.integration.test.ts` (same pattern as `@wasla/channel-postgres`).
5. `.github/workflows/ci.yml` — the `db-integration` matrix gains `leg: bot-runtime · pkg: @wasla/bot-runtime ·
   db: wasla_bot_runtime_test`, which renders exactly the required context name.
6. `docs/12-testing/MERGE_BLOCKING.json` — the context is added to the snapshot and a new `live_checks` entry records this
   measurement (the 2026-09-28 entry stays as history).

## 4. Local proof (advisory — CI is the verdict)

Local Postgres 18 (CI runs `postgres:17`), DB `wasla_bot_runtime_test`:

| Command | Result |
| --- | --- |
| `pnpm --filter @wasla/bot-runtime test:integration` | 2 files · **5/5 pass** |
| Same, with `buildStoreSet` temporarily forced to in-memory (mutation, reverted) | **5/5 fail** — the tests detect the defect they guard |
| `pnpm --filter @wasla/bot-runtime test` (unit) | 208/208 pass (integration files excluded) |
| `pnpm --filter @wasla/bot-runtime typecheck` | clean |
| `WASLA_PROTECTION_JSON=raw-branch-protection.json bash scripts/checks/validate-merge-blocking.sh` | rc=0 · 41 contexts match the jobs letter for letter |

## 5. What this does NOT prove

- Any production behaviour of the Render bot services (no deployment, no production write).
- Supavisor behaviour (`EMAXCONNSESSION`) — RISK-0067 is untouched.
- Why the context was added to the protection — not measurable from here (§2).

## 6. Merge order

This PR produces the bot-runtime check on its own head, so it can satisfy the protection itself. After it merges,
PR #708 is rebased onto the new `main` so its CI also produces the context; then it merges normally.
