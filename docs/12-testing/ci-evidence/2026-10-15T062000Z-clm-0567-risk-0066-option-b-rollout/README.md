# CLM-0567 — RISK-0066 Option B rollout: **HOLD — 0/20 changed** (Render API refuses free → paid)

- **Claim:** CLM-0567 · branch `infra/clm-0567-risk-0066-option-b-rollout` · item `M6-18C` · base main `a93b8286`.
- **Authority:** owner's written decision 2026-10-15 (recorded in the decision pack §8): Option B, 20 named services on the 0.5 CPU / 512 MB plan, $7 each, $140/month base; `wasla-otel-collector` stays free; no workspace upgrade, no add-ons, no payment-method change by the agent.

## 1. Pre-change checks (all passed)

| Check | Result | Source |
|---|---|---|
| Inventory | 21 web services, all `free`, `numInstances=1`, `not_suspended`; 3 static sites | [`raw-render-services-before.json`](raw-render-services-before.json) (06:20Z) |
| Approved footprint | the 20 web services other than `wasla-otel-collector` = decision pack §3 C1 (7) + C2 (13) — exact match | same + decision pack §3/§4 |
| Plan ID and price | `0.5c-512mb` (legacy `starter`) = 0.5 CPU / 512 MB / **$7/month**; Hobby workspace $0 + compute; prorated per second | [`raw-pricing-2026-10-15.md`](raw-pricing-2026-10-15.md) |
| Base total | 20 × $7 = **$140/month** = approved ceiling; no other service becomes paid | calculation |
| Payment method | **not readable** through the API (no billing endpoint); the first change was to act as the check — a rejection means stop | — |

## 2. What happened

1. **Step 1 (C1, first service in the decision-pack order): `wasla-partner-bot`.** `PATCH /v1/services/srv-db3nftbtqb8s73en7o20` `{"serviceDetails":{"plan":"starter"}}` at 06:23:47Z ⇒ **HTTP 400 `cannot change between free and paid plans`** — [`raw-step-1-…json`](raw-step-1-wasla-partner-bot-starter.json).
2. One retry with the new ID for the **same** approved plan (`0.5c-512mb`) at 06:24:15Z ⇒ same HTTP 400 — [`raw-step-1b-…txt`](raw-step-1b-wasla-partner-bot-0.5c-512mb.txt). No other variant was tried.
3. **Post-check 06:27:53Z:** 21/21 still `free`; partner-bot `updatedAt` unchanged (2026-10-14T17:58Z), no new deploy — [`raw-render-plans-after.txt`](raw-render-plans-after.txt).

**Stopped per the decision's stop rule.** No service changed, nothing billed, no deploy triggered. The other 19 services were not attempted.

## 3. Discrepancy to report

Render's docs say a plan can be changed through the API (`serviceDetails.plan` + a deploy), but for this workspace the API explicitly refuses the **free ↔ paid** transition. The only remaining routes are the Render **Dashboard** (service → Settings/Compute → Edit → `Starter` / `0.5c-512mb` → Save; Render then deploys automatically) or a Blueprint — and a Blueprint would add a second source of truth, which is not approved.

**What is needed from the owner:** either (a) make the 20 changes yourself in the Dashboard, one service at a time, in this order — C1: partner-bot, driver-bot, customer-bot, identity, observability, prometheus, alertmanager; C2: orders, dispatch, matching, delivery, drivers, customers, marketplace, negotiations, geography, search, reputation, subscriptions, audit — and the executor verifies each one by API (plan, `numInstances`, live commit, health) under a new claim; or (b) another written route. Note that each Dashboard change triggers a deploy; for `wasla-alertmanager` that deploy is the parity event for finding C (it must be read 21/21 afterwards, not inferred from health).

## 4. States

RISK-0066 `open` (Option B selected, **not live**) · RISK-0067 `mitigating` · M6-18B `Blocked` · NO-GO · R-02 · R-07 · P-03 · P-04 · P-05 unchanged. Alertmanager drift (20/21) still open.
