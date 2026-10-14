# CLM-0551 — RISK-0067 stage 0 evidence completeness: pool-map + fresh Supabase connector readings (read-only)

**Status:** read-only. **No load, no write, no config change.**
**Collected:** 2026-10-14T02:35Z – 03:00:35Z (UTC).
**Claim:** `CLM-0551` (branch `docs/clm-0551-risk-0067-stage0-pool-map-correction`).
**Scope:** stage 0 evidence completeness — no change to the plan file `M6-18B_RISK-0067_LOAD_MEASUREMENT_PLAN.md` (that is a separate owner-gated claim per the roadmap).
**State change:** none. `RISK-0067` stays `mitigating` · `M6-18B` stays `Blocked` · `NO-GO`.

## 1. What this adds (fresh evidence, timestamped)

1. A complete **pool-map** linking every Render web service to its package, `creates_pg_pool` status, and `WASLA_PG_POOL_MAX` in env-vars — all measured from Render API on 2026-10-14T03:00:35Z. [pool-map.md](pool-map.md)
2. Fresh **Supabase connector readings** for production and DR on 2026-10-14T02:35Z–02:42Z — pg_stat_activity, max_connections, supavisor_logs coverage, EMAXCONNSESSION count in requested window, DR project status. [supabase-connector-readings-2026-10-14.md](supabase-connector-readings-2026-10-14.md)
3. A dated correction of the 2026-10-13 CLM-0545 "theoretical overflow 42 > 40" conclusion — by addition, not deletion.

## 2. The key correction (by addition)

The 2026-10-13 CLM-0545 README §1.3 applied «كل خدمات الـDB تُنشئ `pg.Pool`» to all 21 Render web services. That is over-counted. The measured pool-map shows:

- 21 Render web services = **14 DB-pool services** + **7 non-DB services** (3 bots + otel-collector + observability + alertmanager + prometheus).
- 17 L1 harness services = **14 deployed on Render** + **3 code-only** (billing·partners·support — these are repo packages, not Render deployments).
- **Theoretical worst case for the Render fleet = 14 × 1 × 2 = 28 ≤ 40 Supavisor session slots** (not 42 > 40 as CLM-0545 concluded).
- The "overflow" concern at the theoretical level is **resolved for the Render fleet**.

## 3. What stays NOT measured (with the exact source needed)

| Missing | Why | Source needed |
|---|---|---|
| `default_pool_size` (Supavisor) | no admin endpoint in the Supabase MCP connector; `pg_settings` does not expose Supavisor | Supabase dashboard or management API token (owner) |
| Continuous production coverage window for EMAXCONNSESSION | the requested 24h window returned only 164 lines spanning 2026-10-13T14:18:19Z → 23:06:10Z | a defined continuous monitoring window (owner defines the window) |
| Live capacity under load | no load was run | an L2/isolated environment or an owner-approved production load |

## 4. Verdict

**HOLD** — the DR calibration remains blocked on the same owner-gated preconditions already recorded in plan §8.5 (DR project restart, default_pool_size measurement via dashboard/management API, owner approval of the calibration workflow, RISK-0066 resolution before 2026-10-15). This stage 0 evidence adds completeness; it does not change the plan and does not authorize any load.

`RISK-0067` = `mitigating` · `M6-18B` = `Blocked` · `NO-GO` · no load was run · no plan was modified.

## تصحيحٌ بالإضافة — 2026-10-14 (CLM-0554)

الحدُّ النظريُّ «28 ≤ 40» في هذا الملفِّ وفي `pool-map.md` **مُصحَّحٌ إلى 104** (البوتاتُ مربوطةٌ بمجموعةِ البيئة `wasla-prod-db`، ومجمعُ `service-auth-replay` `max: 4` في كلِّ عملية). النصُّ الأصليُّ محفوظ. التفصيل: [`../2026-10-14T064600Z-clm-0554-risk-0067-stage0-full-pool-inventory/README.md`](../2026-10-14T064600Z-clm-0554-risk-0067-stage0-full-pool-inventory/README.md).
