#!/usr/bin/env bash
# validate-render-deploy-target.sh — main deploys only to the declared Render workspace (CLM-0501 · INC-0005).
#
# Fails when:
#   1. infra/render/deploy-target.json is invalid: mode not frozen|deploy; frozen with an owner;
#      deploy without a well-formed owner, or with a frozen owner;
#   2. scripts/deploy/render-sync.py carries a workspace id (tea-…) or does not read the target file;
#   3. .github/workflows/render-deploy.yml does not run render-sync.py;
#   4. in frozen mode render-sync.py touches the network (run without RENDER_API_KEY: must exit 0, FROZEN).
#   CLM-0632 (owner decision 2026-10-19 — Render is a TEST environment only, no production deploy):
#   5. the target lacks environment=test or production_database_refs; deploy-mode render-sync.py
#      starts without them (behavioural, no network);
#   6. render-deploy.yml has any trigger but workflow_dispatch, or lacks the required sha/purpose/confirm
#      inputs and the `test-only` gate, or render-sync.py deploys without RENDER_DEPLOY_INTENT=test-only
#      (behavioural, no network);
#   7. the isolation preflight misses a production-named env group or a production DATABASE_URL
#      (unit fixtures), leaks a value into a finding, or is not on the deploy path (fake Render API:
#      a finding must stop the run before any POST).
# Then mutates a copy of the tree for each rule and requires a failure (self-test).
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json, os, re, shutil, subprocess, sys, tempfile
import importlib.util, contextlib, io

def wf_triggers(wf):
    m = re.search(r"^on:[ \t]*\n((?:[ \t][^\n]*\n|\n)*)", wf, re.M)
    if not m: return None
    return [k for k in re.findall(r"^  ([a-z_]+):", m.group(1), re.M)]

def load_sync(root, target_override=None, env=None):
    """Import a copy of render-sync.py with an optional target file; returns (module|None, exit text)."""
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "scripts/deploy")); os.makedirs(os.path.join(d, "infra/render"))
        shutil.copy(os.path.join(root, "scripts/deploy/render-sync.py"), os.path.join(d, "scripts/deploy/render-sync.py"))
        t = json.load(open(os.path.join(root, "infra/render/deploy-target.json")))
        if target_override: t.update(target_override)
        json.dump(t, open(os.path.join(d, "infra/render/deploy-target.json"), "w"))
        spec = importlib.util.spec_from_file_location("rs_under_test", os.path.join(d, "scripts/deploy/render-sync.py"))
        mod = importlib.util.module_from_spec(spec)
        old_env = dict(os.environ)
        try:
            for k in ("RENDER_API_KEY", "RENDER_DEPLOY_INTENT", "RENDER_DEPLOY_PURPOSE"): os.environ.pop(k, None)
            os.environ.update(env or {})
            spec.loader.exec_module(mod)
            return mod, ""
        except SystemExit as e:
            return None, str(e.code)
        finally:
            os.environ.clear(); os.environ.update(old_env)
    finally: shutil.rmtree(d)

DEPLOY = {"mode": "deploy", "owner_id": "tea-testworkspace01"}
PROD = "abcdefghijklmnopqrst"
SECRET = "s3cr3t-value-must-not-leak"

def run_main(mod, argv, env, api):
    calls = []
    def fake(method, path, body=None):
        calls.append((method, path)); return api(method, path)
    mod.call = fake
    old_env, old_argv = dict(os.environ), sys.argv
    out = io.StringIO()
    try:
        os.environ.update(env); sys.argv = ["render-sync.py"] + argv
        with contextlib.redirect_stdout(out):
            try: rc = mod.main(); msg = ""
            except SystemExit as e: rc, msg = 1, str(e.code)
            except Exception as e: rc, msg = 1, f"crashed past the guard: {e!r}"
    finally:
        os.environ.clear(); os.environ.update(old_env); sys.argv = old_argv
    return rc, msg, out.getvalue(), calls

def test_only_rules(root, t):
    errs = []
    if t.get("environment") != "test": errs.append("deploy-target.json must declare environment=test (Render is a test environment only — CLM-0632)")
    refs = t.get("production_database_refs")
    if not isinstance(refs, list) or not refs: errs.append("deploy-target.json must list production_database_refs (isolation rule)")
    wf = open(os.path.join(root, ".github/workflows/render-deploy.yml")).read()
    trig = wf_triggers(wf)
    if trig != ["workflow_dispatch"]: errs.append(f"render-deploy.yml must trigger on workflow_dispatch only (got {trig})")
    for inp in ("sha", "purpose", "confirm"):
        if not re.search(rf"^      {inp}:\n(?:        .*\n)*?        required: true", wf, re.M): errs.append(f"render-deploy.yml input {inp} must be required")
    if '"${RENDER_DEPLOY_CONFIRM}" != "test-only"' not in wf or "RENDER_DEPLOY_INTENT=test-only" not in wf:
        errs.append("render-deploy.yml must gate on confirm=test-only and pass RENDER_DEPLOY_INTENT")
    if "github.sha" in wf.split("env:", 1)[-1].split("steps:", 1)[0]: errs.append("render-deploy.yml must not default the target to the pushed commit")
    # 5 — deploy mode without the test-only fields must not start
    for drop in ("environment", "production_database_refs"):
        mod, msg = load_sync(root, {**DEPLOY, drop: None})
        if mod is not None: errs.append(f"render-sync.py starts in deploy mode without {drop}")
    mod, msg = load_sync(root, {**DEPLOY, "environment": "production"})
    if mod is not None: errs.append("render-sync.py starts in deploy mode with environment=production")
    mod, msg = load_sync(root, {**DEPLOY, "environment": "test", "production_database_refs": [PROD]})
    if mod is None: errs.append(f"render-sync.py does not load a valid test-only deploy target: {msg[:160]}"); return errs
    if not hasattr(mod, "isolation_findings"): errs.append("render-sync.py has no isolation_findings"); return errs
    # 7 — unit fixtures
    F = mod.isolation_findings
    cases = [
        ("production-named group linked", [{"name": "wasla-prod-db", "linked": ["wasla-orders"], "vars": {}}], {}, True),
        ("group DATABASE_URL on the production project", [{"name": "shared", "linked": ["wasla-orders"], "vars": {"DATABASE_URL": f"postgresql://postgres.{PROD}:{SECRET}@x/postgres"}}], {}, True),
        ("service DATABASE_URL on the production project", [], {"wasla-orders": {"ORDER_DATABASE_URL": f"postgres://u:{SECRET}@db.{PROD}.supabase.co/postgres"}}, True),
        ("isolated test project", [{"name": "wasla-test-db", "linked": ["wasla-orders"], "vars": {"DATABASE_URL": f"postgresql://postgres.zyxwvutsrqponmlkjihg:{SECRET}@x/postgres"}}], {"wasla-orders": {"DATABASE_URL": "postgres://u:p@localhost/test"}}, False),
        ("production-named group not linked", [{"name": "wasla-prod-db", "linked": [], "vars": {}}], {}, False),
    ]
    for desc, g, sv, want in cases:
        got = F(g, sv, [PROD])
        if bool(got) != want: errs.append(f"isolation_findings wrong for '{desc}': {got}")
        if any(SECRET in x or PROD in x for x in got): errs.append(f"isolation finding leaks a value for '{desc}'")
    # 6 — deploy without intent refused before any Render call
    def api_prod(method, path):
        if path.startswith("/services?"): return [{"service": {"id": "srv-1", "name": "wasla-orders", "type": "web_service", "ownerId": "tea-testworkspace01"}}]
        if path.startswith("/env-groups?"): return [{"envGroup": {"id": "evg-1", "name": "wasla-prod-db", "serviceLinks": [{"id": "srv-1"}]}}]
        if path.startswith("/env-groups/"): return {"envVars": [{"key": "DATABASE_URL", "value": f"postgresql://postgres.{PROD}:{SECRET}@x/postgres"}]}
        if "/env-vars/" in path: raise RuntimeError(f"GET {path} -> 404: b''")
        return []
    rc, msg, out, calls = run_main(mod, ["0" * 40], {"RENDER_API_KEY": "k"}, api_prod)
    if rc == 0 or calls or "RENDER_DEPLOY_INTENT" not in msg: errs.append(f"render-sync.py deploys without RENDER_DEPLOY_INTENT=test-only (rc={rc}, calls={len(calls)}, {msg[:120]})")
    # 7 — isolation finding stops the deploy before any POST and before planning
    rc, msg, out, calls = run_main(mod, ["0" * 40], {"RENDER_API_KEY": "k", "RENDER_DEPLOY_INTENT": "test-only", "RENDER_DEPLOY_PURPOSE": "T1"}, api_prod)
    if rc == 0 or any(m == "POST" for m, _ in calls) or "isolation" not in msg: errs.append(f"isolation preflight not on the deploy path (rc={rc}, {msg[:120]})")
    if SECRET in out + msg or PROD in out + msg: errs.append("render-sync.py prints a database value during the isolation preflight")
    if any(re.search(r"/services/[^/]+/env-vars(\?|$)", p) for _, p in calls): errs.append("isolation preflight reads the env-var list instead of keys")
    return errs

def check(root):
    errs = []
    t = json.load(open(os.path.join(root, "infra/render/deploy-target.json")))
    mode, owner, frozen = t.get("mode"), t.get("owner_id"), t.get("frozen_owners") or []
    if mode not in ("frozen", "deploy"): errs.append(f"mode {mode!r} is not frozen|deploy")
    if mode == "frozen" and owner: errs.append("frozen mode must not name an owner_id")
    if mode == "deploy" and (not isinstance(owner, str) or not re.fullmatch(r"tea-[a-z0-9]+", owner)): errs.append("deploy mode needs owner_id tea-…")
    if mode == "deploy" and owner in frozen: errs.append(f"owner_id {owner} is frozen")
    rs = open(os.path.join(root, "scripts/deploy/render-sync.py")).read()
    if re.search(r"tea-[a-z0-9]{6,}", rs): errs.append("render-sync.py hard-codes a workspace id")
    if "deploy-target.json" not in rs: errs.append("render-sync.py does not read deploy-target.json")
    wf = open(os.path.join(root, ".github/workflows/render-deploy.yml")).read()
    if "scripts/deploy/render-sync.py" not in wf: errs.append("render-deploy.yml does not run render-sync.py")
    errs += test_only_rules(root, t)
    if mode == "frozen":
        env = {k: v for k, v in os.environ.items() if k != "RENDER_API_KEY"}
        r = subprocess.run([sys.executable, os.path.join(root, "scripts/deploy/render-sync.py"), "0" * 40], capture_output=True, text=True, env=env)
        if r.returncode != 0 or "FROZEN" not in r.stdout: errs.append(f"frozen render-sync.py did not skip cleanly: rc={r.returncode} {r.stderr.strip()[:160]}")
    return errs

errs = check(".")
for e in errs: print("  ✗", e)
if errs: sys.exit(1)
mode = json.load(open("infra/render/deploy-target.json"))["mode"]
print(f"  ✓ Render deploy target declared ({mode}, environment=test); render-sync.py has no built-in workspace; frozen mode deploys nothing without network")
print("  ✓ test-only: workflow_dispatch only (sha/purpose/confirm=test-only), deploy intent required, isolation preflight blocks production data before any deploy")

def mutate(desc, edits):
    """edits: list of (path, anchor, replacement) applied in order; all anchors must exist."""
    d = tempfile.mkdtemp()
    try:
        for p in ("infra/render/deploy-target.json", "scripts/deploy/render-sync.py", ".github/workflows/render-deploy.yml"):
            os.makedirs(os.path.dirname(os.path.join(d, p)), exist_ok=True); shutil.copy(p, os.path.join(d, p))
        for path, a, b in edits:
            q = os.path.join(d, path); s = open(q).read(); assert a in s, (path, a); open(q, "w").write(s.replace(a, b, 1))
        e = check(d)
        if not e: print(f"  ✗ self-test: mutation not caught — {desc}"); return False
        print(f"    ✓ {desc}\n        caught by: {e[0][:170]}")
        return True
    finally: shutil.rmtree(d)

# CLM-0503: the self-test must be state-independent — the target file is legitimately
# frozen OR deploy (STEP B flips it), so every deploy-target mutation is anchored on
# the CURRENT file content, not on a hard-coded frozen-state literal. The caught rules
# are the same in both states: frozen owner refused (deploy), frozen naming an owner
# refused (frozen), unknown mode refused (both).
cur = json.load(open("infra/render/deploy-target.json"))
cur_mode, cur_owner = cur["mode"], cur.get("owner_id")
frozen_legacy = (cur.get("frozen_owners") or ["tea-damm8atbedkc73ca3ahg"])[0]
mode_anchor = f'"mode": "{cur_mode}"'
owner_anchor = '"owner_id": ' + ("null" if cur_owner is None else json.dumps(cur_owner))
T, R, W = "infra/render/deploy-target.json", "scripts/deploy/render-sync.py", ".github/workflows/render-deploy.yml"
if cur_mode == "frozen":
    mut_owner = [(T, mode_anchor + ",\n  " + owner_anchor, f'"mode": "deploy",\n  "owner_id": {json.dumps(frozen_legacy)}')]
    mut_freeze = [(T, owner_anchor, f'"owner_id": {json.dumps(cur.get("legacy_owner") or "tea-db0vtkpsrm7s739dm5c0")}')]
else:
    mut_owner = [(T, owner_anchor, f'"owner_id": {json.dumps(frozen_legacy)}')]
    mut_freeze = [(T, mode_anchor, '"mode": "frozen"')]

# rule 4 (frozen must not reach the network) is tested on a copy forced into the
# frozen state, whatever the current file is — the forced edits are no-ops when
# the file is already frozen.
force_frozen = [(T, mode_anchor, '"mode": "frozen"'), (T, owner_anchor, '"owner_id": null')]
cases = [
    ("deploy to the frozen legacy owner", mut_owner),
    ("frozen but naming an owner", mut_freeze),
    ("unknown mode", [(T, mode_anchor, '"mode": "auto"')]),
    ("built-in workspace default returns", [(R, 'OWNER = TARGET.get("owner_id")', 'OWNER = TARGET.get("owner_id") or "tea-damm8atbedkc73ca3ahg"')]),
    ("frozen check removed (would reach Render)", force_frozen + [(R, 'if TARGET["mode"] == "frozen":\n        report', 'if False:\n        report')]),
    ("workflow stops using render-sync.py", [(".github/workflows/render-deploy.yml", "scripts/deploy/render-sync.py", "scripts/deploy/other.py")]),
    # CLM-0632 — test-only rules
    ("target loses environment=test", [(T, '"environment": "test"', '"environment": "production"')]),
    ("target loses production_database_refs", [(T, '"production_database_refs": [', '"production_database_refs_off": [')]),
    ("workflow regains a push trigger", [(W, "on:\n  workflow_dispatch:", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:")]),
    ("workflow gains a schedule", [(W, "on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: '0 * * * *'\n  workflow_dispatch:")]),
    ("workflow confirm gate removed", [(W, '"${RENDER_DEPLOY_CONFIRM}" != "test-only"', '"${RENDER_DEPLOY_CONFIRM}" = "never"')]),
    ("workflow purpose optional", [(W, "(e.g. T1), see RENDER_TEST_ENVIRONMENT_PLAN.md\"\n        required: true", "(e.g. T1), see RENDER_TEST_ENVIRONMENT_PLAN.md\"\n        required: false")]),
    ("workflow target defaults to the pushed commit", [(W, "TARGET_SHA: ${{ github.event.inputs.sha }}", "TARGET_SHA: ${{ github.event.inputs.sha || github.sha }}")]),
    ("render-sync accepts environment=production", [(R, 'if t.get("environment") != "test":', 'if t.get("environment") not in ("test", "production"):')]),
    ("render-sync deploy intent check removed", [(R, 'if deploying and (os.environ.get("RENDER_DEPLOY_INTENT") != "test-only"', 'if False and (os.environ.get("RENDER_DEPLOY_INTENT") != "test-only"')]),
    ("isolation ignores production-named groups", [(R, "if PROD_NAME.search(g.get(\"name\", \"\")):", "if False:")]),
    ("isolation ignores service DATABASE_URLs", [(R, "    for name, kv in sorted(service_db.items()):", "    for name, kv in []:")]),
    ("isolation finding prints the value", [(R, 'out.append(f"service {name} key {k} points at a production database")', 'out.append(f"service {name} key {k}={v} points at a production database")')]),
    ("isolation findings do not stop the deploy", [(R, "if iso and deploying:", "if iso and False:")]),
    ("isolation preflight dropped from the deploy path", [(R, 'iso = isolation_findings(*collect_isolation(svcs), TARGET["production_database_refs"])', "iso = []")]),
    ("isolation reads the env-var list", [(R, 'call("GET", f"/services/{sid}/env-vars/{key}")', 'call("GET", f"/services/{sid}/env-vars?limit=100")')]),
]
ok = all([mutate(*c) for c in cases])
if not ok: sys.exit(1)
print(f"  ✓ self-test: {len(cases)}/{len(cases)} mutations caught")
PY
