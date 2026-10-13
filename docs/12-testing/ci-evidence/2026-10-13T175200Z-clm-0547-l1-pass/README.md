# CLM-0547 — L1 isolated-load measurement PASS (RISK-0067)

**Date:** 2026-10-13 · **Run:** [38442183818](https://github.com/skyosv10-art/wasla/actions/runs/38442183818) · **Status:** PASS
**Commit:** 2a5f6c31 (main, post-merge of PR #704)

## Measured (throwaway postgres:17, max_connections=40, 17 real services, WASLA_PG_POOL_MAX absent ⇒ default 2)

- **Peak `pg_stat_activity` = 21** ≤ 34 (theoretical worst case 17 × 2) and ≤ 40 (simulated Supavisor ceiling).
- **`53300 too_many_connections` = 0** across all steps.
- **5xx = 0** · **timeouts = 0** across all steps.
- **p95 ≤ 80 ms** (SLO ≤ 500 ms, M4-03).
- **17/17 services started** (after two prior failures; see TASK_LOG CLM-0547).
- **Recovery after `pg_terminate_backend` = 17/17** alive.

Per-step (60 s each):

| conc | total req | 5xx | timeouts | 53300 | p95 | peak |
|------|-----------|-----|----------|-------|-----|------|
| 10   | 181,040   | 0   | 0        | 0     | 6 ms | 21   |
| 50   | 188,391   | 0   | 0        | 0     | 21 ms | 21 |
| 100  | (see run) | 0   | 0        | 0     | 21 ms | 21 |
| 200  | (see run) | 0   | 0        | 0     | 80 ms | 21 |

## Post-merge CI on main (2a5f6c31)

- WASLA CI: **success**
- Roadmap freshness: **success**
- Render deploy: **success** (commit-pinned, 24/24 live on 2a5f6c31 per its log)

## What this proves and what it does NOT prove (from the matrix §5)

**Proves:** with a fixed `max_connections=40` on a throwaway container, 17 real services — each started from its own `src/http/server.ts` with the shipped `withPgPoolDefaults` (`max` default 2) — hold their connections under graduated load 10→50→100→200 per 60 s step, peak `pg_stat_activity` ≤ 34, no `53300`, no 5xx, no timeouts, p95 ≤ 500 ms, and the fleet recovers after `pg_terminate_backend`.

**Does NOT prove:** Supavisor's own behaviour (`EMAXCONNSESSION`). That is the L2 layer / a live measurement, gated on an owner-approved isolated project (§5, RISK-0067 closure condition unchanged).

## Status

RISK-0067 stays `mitigating` (closure needs a live load measurement with no `EMAXCONNSESSION`, not L1). M6-18B stays `Blocked` (RISK-0058/0066/0067). Release verdict NO-GO. The two failed runs (38422802830 · 38435893220) are recorded and not erased; this PASS is the third run and the first with 17/17.

## Sources

- [Run 38442183818 — PASS](https://github.com/skyosv10-art/wasla/actions/runs/38442183818)
- [Run 38465371715 — PASS (confirmation re-run on main 31bd06bf, post-merge of the evidence PR #705)](https://github.com/skyosv10-art/wasla/actions/runs/38465371715): peak 21 ≤ 34 · 53300=0 · 5xx=0 · timeouts=0 · p95 ≤ 88 ms · 17/17 · recovery 17/17 · VERDICT: PASS
- [docs/12-testing/ENGINEERING_COMPLETION_MATRIX.md §5](../../../ENGINEERING_COMPLETION_MATRIX.md)
- [docs/12-testing/M6-18B_RISK_0067_LOAD_MEASUREMENT_PLAN.md](../../M6-18B_RISK-0067_LOAD_MEASUREMENT_PLAN.md)
- [docs/16-progress/TASK_LOG.md (CLM-0547)](../../../16-progress/TASK_LOG.md)
