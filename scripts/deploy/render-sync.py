#!/usr/bin/env python3
"""render-sync.py — deploy an exact main commit to every WASLA Render service
and prove, per service, that the live deploy carries that commit.

Why this exists (CLM-0401 · M6-18B · 2026-09-29):
  Every Render service was created from the *public repository URL*, not
  through a connected Git provider. Render's own build log says so on every
  build: "It looks like we don't have access to your repo, but we'll try to
  clone it anyway." Render does not support auto-deploys for services linked
  that way (https://render.com/docs/web-services), so `autoDeploy: yes` on all
  24 services was inert: across every recorded deploy the trigger is `api` or
  `manual` — never `new_commit` — and production drifted 195 commits behind
  main (last live commit 4894f39, 2026-09-21).

What it does:
  1. Lists the owner's services whose name starts with `wasla-`.
  2. Triggers `POST /services/{id}/deploys` with `commitId=<target sha>`.
  3. Polls each deploy to a terminal state.
  4. Re-reads the *latest live* deploy per service and compares its commit to
     the target. The verdict is the comparison, not the trigger response.
  5. Writes a JSON evidence file; exits non-zero if any service is not live
     on the target commit. No partial success is reported as success.

Deploy target (CLM-0501 · INC-0005):
  The workspace is NOT a default in this file. It comes from
  infra/render/deploy-target.json:
    mode "frozen" → nothing is listed or deployed; a FROZEN report is written, exit 0
    mode "deploy" → owner_id is required, must not be a frozen owner, and every
                    service deployed must carry that ownerId.
  The old built-in default (the legacy workspace) made the first code merge of
  the blue/green window queue 24 deploys on the frozen legacy stack (INC-0005).

Selective deploy (CLM-0626 · RISK-0068):
  Only services whose build inputs differ between their *live* commit and the
  target are deployed; see scripts/deploy/render_plan.py for the rule. A
  service skipped as `runtime-equivalent` passes only because `git diff live
  target -- <runtime inputs>` is empty (runtime-input, not image-byte,
  equivalence — CLM-0628) — the evidence file records the live commit and inputs.
  `--all` restores the fleet deploy; `--plan-only` measures and deploys nothing.

Usage:
  RENDER_API_KEY=... python3 scripts/deploy/render-sync.py <sha> [--only a,b] \
      [--verify-only] [--plan-only] [--all] [--out path.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
TARGET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "infra", "render", "deploy-target.json")


def load_target() -> dict:
    with open(TARGET_FILE, encoding="utf-8") as f:
        t = json.load(f)
    mode = t.get("mode")
    if mode == "frozen":
        return t
    if mode != "deploy":
        sys.exit(f"deploy-target.json: mode must be 'frozen' or 'deploy' (got {mode!r})")
    owner = t.get("owner_id") or ""
    if not owner.startswith("tea-") or owner in (t.get("frozen_owners") or []):
        sys.exit(f"deploy-target.json: owner_id {owner!r} is missing, malformed or frozen — refusing to deploy")
    return t


TARGET = load_target()
OWNER = TARGET.get("owner_id")
TERMINAL_OK = {"live"}
TERMINAL_BAD = {"build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"}


def call(method: str, path: str, body: dict | None = None) -> object:
    key = os.environ.get("RENDER_API_KEY", "")
    if not key:
        sys.exit("RENDER_API_KEY is not set — refusing to report a verdict without measuring.")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"{method} {path} -> {e.code}: {e.read()[:300]!r}") from e
    raise RuntimeError("unreachable")


def services() -> list[dict]:
    rows = call("GET", f"/services?ownerId={OWNER}&limit=100")
    out = [r["service"] for r in rows if r["service"]["name"].startswith("wasla-")]
    return sorted(out, key=lambda s: s["name"])


def latest_live(sid: str) -> dict | None:
    for row in call("GET", f"/services/{sid}/deploys?limit=20"):
        d = row["deploy"]
        if d.get("status") == "live":
            return d
    return None


def wasla_service(sid: str) -> str | None:
    """Read the single env var WASLA_SERVICE by key — never the whole env list (secrets)."""
    try:
        return (call("GET", f"/services/{sid}/env-vars/WASLA_SERVICE") or {}).get("value")
    except RuntimeError as e:
        if "-> 404" in str(e):
            return None
        raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sha")
    ap.add_argument("--only", default="")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    if TARGET["mode"] == "frozen":
        report = {"target_commit": a.sha, "verdict": "FROZEN", "deployed": 0,
                  "reason": TARGET.get("reason", ""), "since": TARGET.get("since"),
                  "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"::notice::Render deploy target is FROZEN since {TARGET.get('since')} — nothing deployed. {TARGET.get('reason', '')}")
        return 0

    svcs = services()
    if not svcs:
        sys.exit(f"no wasla- services visible for owner {OWNER} with this key — refusing to report a verdict")
    foreign = [s["name"] for s in svcs if s.get("ownerId") != OWNER]
    if foreign:
        sys.exit(f"services outside the declared owner {OWNER}: {foreign} — refusing to deploy")
    if a.only:
        wanted = set(a.only.split(","))
        svcs = [s for s in svcs if s["name"] in wanted]
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    pending: dict[str, dict] = {}

    # CLM-0626: plan per service from live commit → target, not from the last push.
    import render_plan  # lazy: the frozen path above must not need the repo
    repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    full = render_plan.git(repo, "rev-parse", "--verify", f"{a.sha}^{{commit}}")
    if full.returncode != 0:
        sys.exit(f"target {a.sha} is not a commit in this checkout (fetch-depth 0 required) — refusing to plan")
    target = full.stdout.strip()
    pkgs = render_plan.workspace_packages(repo, target)
    reg_path = os.path.join(repo, render_plan.REGISTRY_PATH)
    registry, reg_how = render_plan.registry_for_target(repo, target, open(reg_path, encoding="utf-8").read() if os.path.isfile(reg_path) else None)
    print(f"plan: {reg_how}", flush=True)
    plan: dict[str, dict] = {}
    for s in svcs:
        live0 = latest_live(s["id"])
        live0_sha = (live0 or {}).get("commit", {}).get("id", "")
        env = (s.get("serviceDetails") or {}).get("envSpecificDetails") or {}
        ws = wasla_service(s["id"]) if s["type"] != "static_site" and render_plan._norm(env.get("dockerContext")) in ("", ".") else None
        inputs, how = render_plan.inputs_for(repo, target, s, ws, pkgs, registry)
        plan[s["id"]] = {"live_before": live0_sha, "inputs_from": how, "inputs": inputs,
                         **render_plan.decide(repo, live0_sha, target, inputs, force=a.all)}
        print(f"plan {s['name']:24} {plan[s['id']]['decision']:18} live={live0_sha[:7] or '—':7} {plan[s['id']]['reason']}", flush=True)
    to_deploy = [s for s in svcs if plan[s["id"]]["decision"] == "deploy"]
    print(f"plan: deploy {len(to_deploy)}/{len(svcs)} (target {target[:8]})", flush=True)

    if a.plan_only:
        report = {"target_commit": target, "verdict": "PLAN", "deployed": 0, "started_at": started, "registry": reg_how,
                  "services": [{"service": s["name"], "id": s["id"], **plan[s["id"]]} for s in svcs]}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
        return 0

    if not a.verify_only:
        for s in to_deploy:
            d = call("POST", f"/services/{s['id']}/deploys", {"commitId": target, "clearCache": "do_not_clear"})
            pending[s["id"]] = {"name": s["name"], "deploy_id": d["id"], "status": d.get("status")}
            print(f"triggered {s['name']:24} {d['id']}", flush=True)
            time.sleep(1)

        deadline = time.time() + a.timeout_min * 60
        while time.time() < deadline and any(
            p["status"] not in TERMINAL_OK | TERMINAL_BAD for p in pending.values()
        ):
            time.sleep(20)
            for sid, p in pending.items():
                if p["status"] in TERMINAL_OK | TERMINAL_BAD:
                    continue
                p["status"] = call("GET", f"/services/{sid}/deploys/{p['deploy_id']}")["status"]
            done = sum(p["status"] in TERMINAL_OK | TERMINAL_BAD for p in pending.values())
            print(f"  … {done}/{len(pending)} terminal", flush=True)

    results = []
    for s in svcs:
        live = latest_live(s["id"])
        live_sha = (live or {}).get("commit", {}).get("id", "")
        p = plan[s["id"]]
        on_target = bool(live_sha) and (live_sha.startswith(target) or target.startswith(live_sha))
        # `runtime-equivalent` holds only while the live commit is the one the plan diffed.
        equivalent = p["decision"] == "runtime-equivalent" and live_sha == p["live_before"]
        results.append({
            "service": s["name"],
            "id": s["id"],
            "type": s["type"],
            "triggered_deploy": pending.get(s["id"], {}).get("deploy_id"),
            "triggered_status": pending.get(s["id"], {}).get("status"),
            "live_commit": live_sha,
            "live_finished_at": (live or {}).get("finishedAt"),
            "decision": p["decision"],
            "reason": p["reason"],
            "inputs_from": p["inputs_from"],
            "changed": p.get("changed", []),
            "matches_target": on_target or equivalent,
        })

    ok = all(r["matches_target"] for r in results)
    report = {
        "target_commit": target,
        "deployed": len(to_deploy) if not a.verify_only else 0,
        "policy": "runtime-input equivalence (CLM-0628); image bytes not compared",
        "registry": reg_how,
        "started_at": started,
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "verdict": "PASS" if ok else "FAIL",
        "services": results,
    }
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text + "\n")
    for r in results:
        mark = "✓" if r["matches_target"] else "✗"
        print(f"{mark} {r['service']:24} live={r['live_commit'][:7] or '—':7} {r['decision']:18} triggered={r['triggered_status']}")
    print(f"verdict: {report['verdict']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
