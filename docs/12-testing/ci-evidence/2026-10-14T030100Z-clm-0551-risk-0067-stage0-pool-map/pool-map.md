# CLM-0551 — pool-map: full mapping Render service ⇄ package ⇄ creates pg.Pool (read-only)

**Collected at:** 2026-10-14T03:00:35Z (UTC) · read-only.
**Source:** Render API `/v1/services?limit=100` + `/v1/services/{id}/env-vars` + live deploy pin per service.
**Scope:** stage 0 evidence completeness. **No load, no write, no config change.**

## 1. The L1 harness list (17 services) vs Render fleet (21 web services) — the measured map

L1 harness (l1-isolated-load.mts SERVICES) is the exact 17 repo services that create a `pg.Pool` via `withPgPoolDefaults` (per CLM-0510 + grep of `services/*/src/` for `withPgPoolDefaults|guardPgPool` on main `84ae243d`).

| L1 harness service (creates pg.Pool in code) | Render web service (deployed)? | WASLA_PG_POOL_MAX in Render env-vars | Effective per-pool max (if deployed) | Region |
|---|---|---|---|---|
| audit | wasla-audit (YES) | absent | 2 | singapore |
| billing | **NO — not deployed on Render** | n/a | n/a (code-only) | — |
| customers | wasla-customers (YES) | absent | 2 | singapore |
| delivery | wasla-delivery (YES) | absent | 2 | singapore |
| dispatch | wasla-dispatch (YES) | absent | 2 | singapore |
| drivers | wasla-drivers (YES) | absent | 2 | singapore |
| geography | wasla-geography (YES) | absent | 2 | singapore |
| identity | wasla-identity (YES) | absent | 2 | singapore |
| marketplace | wasla-marketplace (YES) | absent | 2 | singapore |
| matching | wasla-matching (YES) | absent | 2 | singapore |
| negotiations | wasla-negotiations (YES) | absent | 2 | singapore |
| orders | wasla-orders (YES) | absent | 2 | singapore |
| partners | **NO — not deployed on Render** | n/a | n/a (code-only) | — |
| reputation | wasla-reputation (YES) | absent | 2 | singapore |
| search | wasla-search (YES) | absent | 2 | singapore |
| subscriptions | wasla-subscriptions (YES) | absent | 2 | singapore |
| support | **NO — not deployed on Render** | n/a | n/a (code-only) | — |

**Render web services that do NOT create pg.Pool (7 of 21):**

| Render service | Deploy context | Creates pg.Pool | Reason |
|---|---|---|---|
| wasla-alertmanager | `infra/observability/Dockerfile.alertmanager` | no | Prometheus Alertmanager binary, no DB |
| wasla-prometheus | `infra/observability/Dockerfile.prometheus` | no | Prometheus binary, no DB |
| wasla-partner-bot | `.` | no | Telegram bot; DB access via HTTP to services, not direct pg.Pool |
| wasla-driver-bot | `.` | no | Telegram bot; same |
| wasla-customer-bot | `.` | no | Telegram bot; same |
| wasla-otel-collector | `infra/observability` | no | OTLP collector, no DB |
| wasla-observability | `.` | no | scraper; no direct pg.Pool in this service |

## 2. Corrected theoretical worst case for the Render fleet

With `numInstances=1` and `WASLA_PG_POOL_MAX` absent (measured from env-vars of every one of the 21 web services on 2026-10-14), and with 3 of the 17 L1 pool services (billing·partners·support) NOT deployed on Render:

| Term | Value |
|---|---|
| L1 harness list (creates pg.Pool) | 17 |
| Of those, deployed on Render | 14 |
| Of those, code-only (no Render service) | 3 (billing·partners·support) |
| `numInstances` per Render service | 1 (all 21, measured) |
| `WASLA_PG_POOL_MAX` | absent on all 21 (measured) → effective per-pool max = default 2 |
| **Theoretical worst case for Render fleet** | **14 × 1 × 2 = 28** (not 34, not 42) |
| vs Supavisor session slots (per 2026-10-08 owner-set pool_size = 40, session mode) | 28 ≤ 40 — fits within the measured pool_size with headroom 12 |

## 3. Correction of the 2026-10-13 CLM-0545 conclusion (by addition, not deletion)

The 2026-10-13 CLM-0545 README §1.3 stated «كل خدمات الـDB تُنشئ `pg.Pool`» applied to all 21 Render web services. That over-counted. The measured map above shows:

- 21 Render web services = **14 DB-pool services** + **7 non-DB services** (3 bots + otel-collector + observability + alertmanager + prometheus).
- 17 L1 harness services = **14 deployed on Render** + **3 code-only** (billing·partners·support — these are repo packages, not Render deployments).

So the "21 × 2 = 42 > 40 slots" conclusion in the 2026-10-13 CLM-0545 README §1.4 and §5 is **wrong**. The measured correct theoretical worst case for the Render fleet is **14 × 2 = 28 ≤ 40 slots** (no theoretical overflow).

This is a correction by addition: the 2026-10-13 evidence and its "42" conclusion are preserved as history, and superseded by the 2026-10-14 map above.

## 4. What this does NOT change

- The **L1 harness list of 17** services remains correct as the CI-only isolated-load scope (it measures the code-level worst case of every pg.Pool that exists in the repo, which is the right scope for a CI-only throwaway test).
- The **L1 PASS verdicts (runs 38442183818, 38465371715, 38477010128)** remain valid, with their scope limitation already recorded: peak pg_stat_activity 21 ≤ 34, 53300=0, 5xx=0, timeouts=0, p95 ≤ 88 ms, recovery 17/17 — **L1 does not prove Supavisor's `EMAXCONNSESSION`** (that is L2/live, owner-gated).
- **DR project status INACTIVE** (measured 2026-10-14T02:35Z via list_projects).
- **`default_pool_size` NOT measured** (no Supabase admin endpoint exposed by the MCP connector; `pg_settings` does not expose Supavisor).
- **RISK-0067 stays `mitigating`** · **M6-18B stays `Blocked`** · **NO-GO** · **no load was run**.

## 5. What this changes

- The 2026-10-13 "theoretical overflow of Supavisor 40 slots" concern is **resolved at the theoretical level** for the Render fleet (14×2=28 ≤ 40).
- The next step for closing RISK-0067 is unchanged: a live load measurement with no `EMAXCONNSESSION` on an L2/isolated environment, which requires owner-gated approvals (DR restart or new isolated Supabase project, workflow approval, RISK-0066 resolution).

## 6. Pool-map evidence files

- [`render-inventory-2026-10-14.json`](render-inventory-2026-10-14.json) — full Render inventory with per-service creates_pg_pool and WASLA_PG_POOL_MAX.
- [`supabase-connector-readings-2026-10-14.md`](supabase-connector-readings-2026-10-14.md) — production pg_stat_activity, max_connections, supavisor_logs coverage, EMAXCONNSESSION count in requested window, DR project status.

## تصحيحٌ بالإضافة — 2026-10-14 (CLM-0554)

> هذا القسمُ يُضافُ ولا يمحو ما فوقه. الاستنتاجُ أعلاه «14 × 1 × 2 = 28 ≤ 40» **خاطئٌ** لسببين مقيسين:
>
> 1. **البوتاتُ الثلاثةُ ليست «غيرَ DB»:** تصنيفُها اعتمدَ على env-vars الخدمةِ وحدَها، بينما `DATABASE_URL` و`CUSTOMER_DATABASE_URL` يأتيان من مجموعةِ البيئة `wasla-prod-db` (evg-db40ojmb7d7c739u51jg) المربوطةِ بـ17 خدمة بينها البوتاتُ الثلاثة. `bot-runtime` يُنشئُ مجمعَ `channel-postgres` (2)، وcustomer-bot مجمعَ customers (2).
> 2. **مجمعُ `service-auth-replay` غائبٌ عن الخريطة:** كلُّ عمليةٍ من الـ17 تُنشئُه بـ`max: 4` صريح (`packages/service-auth/src/replay-store.ts:104`)، و`WASLA_PG_POOL_MAX` لا يحكمُه.
>
> **الحدُّ المصحَّح = 104.** الجردُ الكاملُ ومصدرُ كلِّ قيمة: [`../2026-10-14T064600Z-clm-0554-risk-0067-stage0-full-pool-inventory/README.md`](../2026-10-14T064600Z-clm-0554-risk-0067-stage0-full-pool-inventory/README.md).
