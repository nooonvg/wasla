# Render plan decision pack — 2026-10-08 (CLM-0508)

**Status:** decision pack, **waiting for owner approval before any billing change**. The executor has not made, and will not make, any plan or billing change.
**Workspace:** Render Singapore `tea-db0vtkpsrm7s739dm5c0`. **Risk:** RISK-0066.

## 1. Owner operational decision (recorded 2026-10-08)

> **The free plan is NOT approved for a field trial or for real operation of critical webhook-driven services.**

This decision sets the policy and leaves the current state unchanged. All 21 web services are on `free`, measured 2026-10-08T18:45Z. The 3 static sites are free by design, and that is correct for them.

## 2. Measured facts

| Fact | Value | Source |
|---|---|---|
| Web services | 21, all `plan=free` | Render API, 2026-10-08T18:45Z |
| Free spin-down | after 15 min with no inbound traffic; about 1 min cold start | [Render docs: Free instances](https://render.com/docs/free) |
| Free instance hours | **750 per workspace per calendar month**; when they run out, **every free web service in the workspace is suspended until the 1st of the next month** | [Render docs: Free instances](https://render.com/docs/free) |
| Render's own guidance | "Do not use [Free instances] for production applications" | [Render docs: Free instances](https://render.com/docs/free) |
| Prometheus scrape | 15 targets every 30 s (`infra/observability/prometheus.yml`). Scraped targets never go idle, so they never spin down | repo |
| Paid compute | 512 MB / <1 CPU = **$7/month**; 2 GB / 1 CPU = $25/month; Hobby workspace $0 + compute | [Render pricing](https://render.com/pricing) |

**Consequence (estimated, not measured; the Render API does not expose free-hour usage):**
- About 17 services stay permanently awake: the 15 scraped targets plus Prometheus and Alertmanager. That uses about 17 free-hours per hour, so 750 hours last about 44 hours of wall time.
- Once the hours run out, **every free service, including the 3 bots, Prometheus and Alertmanager, is suspended for the rest of the month.** That means no bot traffic and no paging.
- How many hours have been used so far this month is **unknown**. The owner can see it in the Render dashboard → Billing → Free usage.

## 3. Critical services

| Tier | Services | Why |
|---|---|---|
| C1: webhook ingress | wasla-partner-bot, wasla-driver-bot, wasla-customer-bot | Telegram delivers webhooks. A cold start of about 1 min risks Telegram delivery timeouts, which leads to retries and backlog, and a suspension means a total outage |
| C1: bot request path | wasla-identity, wasla-observability | read from every bot's env (measured) |
| C1: paging | wasla-prometheus, wasla-alertmanager | if they go down, nobody is paged during the outage |
| C2: domain backends | orders, dispatch, matching, delivery, drivers, customers, marketplace, negotiations, geography, search, reputation, subscriptions, audit | reached through the business flows. Cold starts add up along the call chain |
| C3: collector | wasla-otel-collector | telemetry only |

## 4. Options (monthly compute; prices from Render pricing, 2026-10-08)

| Option | Footprint | Monthly cost | Availability consequence |
|---|---|---|---|
| A: stay free (status quo) | 0 paid | $0 | **Rejected by the owner's decision (§1).** The hours run out in about 2 days at the current scrape rate, and then everything is suspended |
| **B: minimum paid (recommended for the field trial)** | C1 (7 services) + C2 (13) on $7 instances = 20; the otel-collector stays free or is stopped | **20 × $7 = $140** | No spin-down on the critical path. The free-hour pool only covers the collector |
| C: full paid | all 21 on $7 | 21 × $7 = $147 | Same as B, and the collector is always on too |
| D: C1 only | 7 × $7 | $49 | Bots and paging stay up. The C2 backends still spin down and use free hours, so they can be suspended. **Not sufficient** for real business flows |

The recommended minimum paid footprint is **option B ($140/month)**. A Pro workspace ($25/month) is **not** required for the instance upgrade; it is a separate choice about seats and features.

## 5. What happens after approval (not before)

1. The owner approves an option in writing and adds a payment method in Render.
2. The executor changes each instance type with the Render API, one service at a time, C1 first, under a new claim. Each change is followed by a health check and `render-deploy` parity.
3. RISK-0066 closes once all C1 and C2 services in the approved option are measured on a paid plan.

**No billing change happens until §5.1 is done.**

## 6. Dated addendum — 2026-10-14 (CLM-0557), for the RISK-0066 review due 2026-10-15

This section adds to §1–§5 and changes none of them. **The executor has not chosen an option and has not changed any plan, instance type or billing setting.**

### 6.1 Re-measured state

| Fact | Value | Source |
|---|---|---|
| Web services | 21, all `plan=free`, all `not_suspended` | Render API `GET /v1/services`, 2026-10-14T07:30:47Z |
| Static sites | 3, `not_suspended` | same |
| Free-hour usage this month | **not measured** — the Render API does not expose it | owner: Render dashboard → Billing → Free usage |
| Free-plan side effect seen today | the main deploy of `79729e07` failed on `wasla-search` (`update_failed`): the container started 14.5 min after "Deploying…" and the 15-min deploy timeout expired 28 s after it began listening. Re-running the pinned deploy job made it `live` at 06:47:35Z. No code fault | Render deploy log `dep-db7ht3mq1p3s73cip4v0` · CLM-0554 evidence §6 |

### 6.2 Why RISK-0067 now depends on this decision

- The RISK-0067 production load step (plan §4 stage 2, §9) keeps the target services awake and adds instance hours. On `free`, that spends the shared 750-hour pool, and running out suspends **every** web service, including the 3 bots and paging, until the 1st of next month.
- A cold start (~1 min) or a scheduling delay during a load step would show up as errors or p95 outliers that come from the platform, not from database capacity. The plan's PASS/HOLD/FAIL rules (§8.2) would then return HOLD for reasons that have nothing to do with the thing being measured.
- So the plan treats an unresolved RISK-0066 as a blocker for the production load step (plan §9.5 row 6).

### 6.3 The decision needed from the owner (nothing is assumed)

1. **Which option (§4: B, C, D, or another written choice), or keep `free` and accept that no production load step runs.** The executor does not pick one.
2. If you pick a paid option: add a payment method in Render, then give written approval with the option letter. §5 then runs under a new claim.
3. If you keep `free`: say so in writing. RISK-0066 stays `open` with a new review date that you choose, and the RISK-0067 production load step stays HOLD.

RISK-0066 status is unchanged (`open`, review 2026-10-15).

## 7. Dated addendum — 2026-10-14T22:05Z (CLM-0564), RISK-0066 review

This section adds to §1–§6 and changes none of them. **The executor has still not chosen an option and has not changed any plan, instance type, service or billing setting.**

### 7.1 Re-measured state (Render API, read-only, 2026-10-14T21:58:17Z)

21 web services, all `plan=free`, `numInstances=1`, `not_suspended`; 3 static sites. Free-hour usage this month: **not measured** (not exposed by the API; source: Render dashboard → Billing → Free usage).

### 7.2 New free-plan symptoms measured today

| Fact | Source |
|---|---|
| Scheduled service-health run FAILED: 13/14 answered 200 after cold starts of 23.5–85.4 s; **identity answered 502 in 0.2 s on all 3 attempts**. No identity log line between 21:16:37Z and 21:49:02Z, then a new instance started — the probe did not wake it. Issue #689 opened by the workflow. | run 38642657952 · Render logs API |
| **Paging path not delivering:** Prometheus logged 24 `Error sending alert … bad response status 502 Bad Gateway` (21:04:18Z–21:16:48Z) before it slept. | Render logs API, `wasla-prometheus` |
| Prometheus and Alertmanager (both `oregon`) answer **502 with `x-render-routing: no-deploy`** at 21:55–22:03Z although the API lists a `live` deploy for each; singapore services answer 200. | HTTP GET `/`, response headers |
| Render status page: incident "Builds, deploys, and queued deploys are not starting in all regions" since 19:32Z; deploys to free services paused (updates 20:41Z, 21:43Z). | [status.render.com](https://status.render.com/) |

The link between these symptoms and Render's incident is a **hypothesis** (timing and the routing header support it; Render has not confirmed it). The measured fact is that, on `free`, the platform today produced failures unrelated to the code and stopped the alert path itself.

### 7.3 Decision still needed

Unchanged from §6.3: an option (§4: B, C, D or another written choice), or a written decision to keep `free` with a review date you choose. Until then RISK-0066 stays `open` (next review 2026-10-22, set by the executor as the registered row owner; you may change it) and the RISK-0067 production load step stays HOLD. Evidence: [`CLM-0564 README`](../12-testing/ci-evidence/2026-10-14T220000Z-clm-0564-risk-reviews-due-2026-10-15-16/README.md).
