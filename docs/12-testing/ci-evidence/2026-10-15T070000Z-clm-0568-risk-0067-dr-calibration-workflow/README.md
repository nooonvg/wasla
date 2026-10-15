# CLM-0568 — RISK-0067: DR-only Supavisor calibration workflow (preparation; nothing run)

- **Claim:** CLM-0568 · branch `feat/clm-0568-risk-0067-dr-calibration-workflow` · item `M6-18B` · base main `a93b8286`.
- **Authority:** owner's written decision 2026-10-15, part B (summary in plan §12.1): DR calibration preparation authorized; production load stays prohibited; dedicated workflow restricted to `DR_REPLACEMENT_DB_URL` and the DR project; CODEOWNERS review and full CI; derived S/E formulas; tagged sessions; explicit stop conditions; cleanup verification; `SELECT 1` only. DR restart authorized for calibration preparation and execution only.

## What this PR adds

| File | Purpose |
|---|---|
| `scripts/ops/risk-0067-dr-calibration/calibrate.mjs` | the single guard (`guard()`) + the read-only calibrator + the pure verdict (`judge()`) |
| `scripts/ops/risk-0067-dr-calibration/calibrate.test.mjs` | pure tests: guard (DR accepted; prod/retired/TEST refused by name, even inside parameters; direct; 6543; other ports and refs; localhost only in self-test), inputs, derivation, 10 FAIL shapes, HOLD precedence |
| `.github/workflows/risk-0067-dr-calibration.yml` | `selftest` on PR (no secret; throwaway postgres:17) · `calibrate` on dispatch from `main` only |
| `scripts/checks/validate-workflow-supply-chain.sh` | inventory declaration (secrets **yes** — `DR_REPLACEMENT_DB_URL` only; write **no**) |
| plan §12 | the decision, what was built, the calibration-day protocol, and the status of each condition |

## Evidence

- [`raw-local-pure-tests.txt`](raw-local-pure-tests.txt) — 9/9 pure tests pass locally. The full self-test (cases A–C on postgres:17) runs in this PR's CI; its run ID is recorded at merge.
- [`raw-dr-secret-shape.txt`](raw-dr-secret-shape.txt) — the existing secret is the DR session pooler (ref `pvyuhjadrygqqdoczmnd`, `supavisor-session`, 5432), from past guard output; no secret value seen.
- Supavisor's documented session-mode rejection: `XX000 (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: N` ([Supabase Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)) — the reason `judge()` also requires N = S.

## Not done (and why)

- **S — production measured, DR not.** Owner delivered a narrowly scoped Management API token through the secure vault (never in chat/Git/logs). Read 2026-10-15T06:43Z ([`raw-pooler-config-2026-10-15.json`](raw-pooler-config-2026-10-15.json)): production `default_pool_size = 60`, `pool_mode = transaction` (value for this day only; production stays HOLD). DR returned an **empty list** while `INACTIVE` ⇒ DR S is **unmeasured**; it is re-read after the authorized restart on the calibration day, and the run is HOLD without it.
- **DR not restarted** — the restart is coordinated with the calibration window, after this PR is merged.
- No load, no write, no settings change, no production connection.

## States

RISK-0067 `mitigating` · RISK-0066 `open` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 unchanged. A DR PASS will not move production out of HOLD.
