#!/usr/bin/env bash
# validate-render-deploy-plan.sh — selective Render deploy decides from the LIVE
# commit of each service, not from the last push (CLM-0626 · RISK-0068 · M6-18B).
#
# Proves, on a throw-away git repository with a real pnpm-workspace layout:
#   1. a docs-only target still deploys a service whose earlier code change never
#      went live (the #772-behind-#773 case), and only that service;
#   2. transitive workspace dependencies, the lockfile and the Docker context are inputs;
#   3. every ambiguity deploys: no live deploy, live commit not in history,
#      inputs not derivable, --all;
#   4. on the real repository: no package imports an @wasla/* package it does not
#      declare (the closure's premise), render-sync.py deploys only `deploy`
#      decisions, and render-deploy.yml fetches full history on every push to main.
# Then mutates render_plan.py / the wiring and requires every mutation to be caught.
#
# Mandatory in scripts/verify.sh. Reference: docs/12-testing/ci-evidence/
# 2026-10-19T120000Z-clm-0626-render-selective-deploy/README.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import importlib.util, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
PLAN = os.path.join(ROOT, "scripts/deploy/render_plan.py")
SYNC = os.path.join(ROOT, "scripts/deploy/render-sync.py")
WF = os.path.join(ROOT, ".github/workflows/render-deploy.yml")


def load(path):
    spec = importlib.util.spec_from_file_location("rp_under_test", path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def sh(repo, *a):
    subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True)


def write(repo, path, text):
    p = os.path.join(repo, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(text)


def commit(repo, msg):
    sh(repo, "add", "-A"); sh(repo, "commit", "-qm", msg)
    return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def fixture():
    r = tempfile.mkdtemp()
    sh(r, "init", "-q"); sh(r, "config", "user.email", "t@t"); sh(r, "config", "user.name", "t")
    write(r, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "services/*"\n  - "apps/*"\n')
    for f in ("package.json", "pnpm-lock.yaml", "tsconfig.json", "Dockerfile", ".dockerignore", "scripts/container/entrypoint.sh"):
        write(r, f, "v1\n")
    pk = lambda n, deps=None: json.dumps({"name": n, "dependencies": deps or {}})
    write(r, "packages/y/package.json", pk("@t/y")); write(r, "packages/y/src.ts", "1\n")
    write(r, "packages/x/package.json", pk("@t/x", {"@t/y": "workspace:*"})); write(r, "packages/x/src.ts", "1\n")
    write(r, "services/a/package.json", pk("@t/a", {"@t/x": "workspace:*"})); write(r, "services/a/src.ts", "1\n")
    write(r, "services/b/package.json", pk("@t/b")); write(r, "services/b/src.ts", "1\n")
    write(r, "apps/web/package.json", pk("@t/web")); write(r, "apps/web/src.ts", "1\n")
    write(r, "infra/obs/Dockerfile.p", "1\n"); write(r, "infra/obs/config.yml", "1\n"); write(r, "docs/readme.md", "1\n")
    c = {"c1": commit(r, "base")}
    write(r, "packages/y/src.ts", "2\n"); c["c2"] = commit(r, "transitive code change (the #772)")
    write(r, "docs/readme.md", "2\n"); c["c3"] = commit(r, "docs only (the #773)")
    write(r, "pnpm-lock.yaml", "v2\n"); c["c4"] = commit(r, "lockfile")
    write(r, "infra/obs/config.yml", "2\n"); c["c5"] = commit(r, "observability context")
    return r, c


def img(ctx=".", df="Dockerfile"):
    return {"type": "web_service", "serviceDetails": {"envSpecificDetails": {"dockerfilePath": df, "dockerContext": ctx}}}


SVC = {
    "A": (img(), "@t/a"),
    "B": (img("./", "./Dockerfile"), "@t/b"),
    "W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm install && pnpm --filter @t/web build"}}, None),
    "O": (img("infra/obs", "infra/obs/Dockerfile.p"), None),
}


def plan(rp, repo, live, target, names=("A", "B", "W", "O"), ws_override=None, svc_override=None, force=False):
    pkgs = rp.workspace_packages(repo, target)
    out = {}
    for n in names:
        svc, ws = (svc_override or {}).get(n, SVC[n])
        if ws_override and n in ws_override: ws = ws_override[n]
        inputs, _ = rp.inputs_for(repo, target, svc, ws, pkgs)
        out[n] = rp.decide(repo, live, target, inputs, force=force)
    return out


def cases(rp, repo, c):
    errs = []
    def expect(desc, got, want, reason_has=None):
        for n, w in want.items():
            if got[n]["decision"] != w:
                errs.append(f"{desc}: {n} = {got[n]['decision']} ({got[n]['reason']}), want {w}")
            elif reason_has and n in reason_has and reason_has[n] not in got[n]["reason"]:
                errs.append(f"{desc}: {n} reason {got[n]['reason']!r} lacks {reason_has[n]!r}")
    expect("docs-only target behind an undeployed code change (live c1 → c3)",
           plan(rp, repo, c["c1"], c["c3"]), {"A": "deploy", "B": "equivalent", "W": "equivalent", "O": "equivalent"})
    expect("live already carries the code change (c2 → c3)", plan(rp, repo, c["c2"], c["c3"]), {"A": "equivalent"})
    expect("live is the target", plan(rp, repo, c["c3"], c["c3"]), {"A": "current", "O": "current"})
    expect("lockfile change (c3 → c4)", plan(rp, repo, c["c3"], c["c4"]), {"A": "deploy", "B": "deploy", "W": "deploy", "O": "equivalent"})
    expect("Docker context change (c4 → c5)", plan(rp, repo, c["c4"], c["c5"]), {"A": "equivalent", "W": "equivalent", "O": "deploy"})
    expect("live commit not in history", plan(rp, repo, "d" * 40, c["c3"]), {"A": "deploy", "O": "deploy"}, {"A": "not in history"})
    expect("no live deploy", plan(rp, repo, "", c["c3"]), {"A": "deploy"}, {"A": "no live deploy"})
    expect("WASLA_SERVICE unknown", plan(rp, repo, c["c2"], c["c3"], ws_override={"A": None}), {"A": "deploy"}, {"A": "not derivable"})
    two = {"W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm --filter @t/web --filter @t/b build"}}, None)}
    expect("static build command ambiguous", plan(rp, repo, c["c2"], c["c3"], svc_override=two), {"W": "deploy"}, {"W": "not derivable"})
    expect("--all", plan(rp, repo, c["c2"], c["c3"], force=True), {"A": "deploy", "B": "deploy", "W": "deploy", "O": "deploy"})
    return errs


def repo_checks(sync_src, wf_src):
    errs = []
    if "import render_plan" not in sync_src: errs.append("render-sync.py does not use render_plan")
    if 'plan[s["id"]]["decision"] == "deploy"' not in sync_src: errs.append("render-sync.py does not deploy only `deploy` decisions")
    if "for s in to_deploy:" not in sync_src: errs.append("render-sync.py triggers deploys outside the plan")
    if "/env-vars/WASLA_SERVICE" not in sync_src or re.search(r"/env-vars\?", sync_src):
        errs.append("render-sync.py must read WASLA_SERVICE by key, never the env-var list")
    if not re.search(r"fetch-depth:\s*0\b", wf_src): errs.append("render-deploy.yml must fetch full history (fetch-depth: 0)")
    if "paths-ignore" in wf_src: errs.append("render-deploy.yml must run on every push to main (docs-only pushes converge too)")
    return errs


def undeclared_imports():
    pk = {}
    for base in ("packages", "services", "apps", "bots", "packages/contracts"):
        if not os.path.isdir(base): continue
        for d in sorted(os.listdir(base)):
            f = os.path.join(base, d, "package.json")
            if os.path.isfile(f):
                m = json.load(open(f))
                if m.get("name"): pk[m["name"]] = (os.path.join(base, d), m)
    bad = []
    rx = re.compile(r"""(?:from|import\()\s*["'](@wasla/[a-z0-9-]+)""")
    for name, (d, m) in pk.items():
        declared = set()
        for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            declared |= set((m.get(k) or {}).keys())
        for dirpath, dirs, files in os.walk(os.path.join(d, "src")):
            dirs[:] = [x for x in dirs if x != "node_modules"]
            for fn in files:
                if not fn.endswith((".ts", ".tsx", ".js", ".mjs")): continue
                for imp in rx.findall(open(os.path.join(dirpath, fn), encoding="utf-8").read()):
                    if imp in pk and imp != name and imp not in declared:
                        bad.append(f"{name} imports {imp} without declaring it ({os.path.join(dirpath, fn)})")
    return sorted(set(bad))


repo, c = fixture()
try:
    errs = cases(load(PLAN), repo, c)
    errs += repo_checks(open(SYNC).read(), open(WF).read())
    errs += undeclared_imports()
    if errs:
        for e in errs: print(f"  ✗ {e}")
        sys.exit(1)
    print("  ✓ plan: live→target per service · docs-only target still deploys the undeployed change · ambiguity deploys · closure premise holds")

    PLAN_MUT = [
        ("diff from the last push instead of the live commit", '"diff", "--name-only", live, target', '"diff", "--name-only", target + "~1", target'),
        ("history check removed", 'if git(repo, "cat-file", "-e", f"{live}^{{commit}}").returncode != 0:', "if False:"),
        ("unknown inputs treated as equivalent", 'return {"decision": "deploy", "reason": "build inputs not derivable"}', 'return {"decision": "equivalent", "reason": "build inputs not derivable"}'),
        ("closure not transitive", "                    todo.append(dep)", "                    seen.add(dep)"),
        ("lockfile not an input", '"pnpm-lock.yaml", ', ""),
        ("Docker context not an input", 'return sorted({ctx + "/", dockerfile})', "return [dockerfile]"),
        ("always deploy (no saving)", "    if changed:\n", "    if True:\n"),
    ]
    caught = 0
    src = open(PLAN).read()
    for desc, a, b in PLAN_MUT:
        assert a in src, f"self-test anchor missing: {desc}"
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, "render_plan.py"); open(p, "w").write(src.replace(a, b, 1))
            if cases(load(p), repo, c): caught += 1
            else: print(f"  ✗ self-test: mutation not caught — {desc}")
        finally: shutil.rmtree(d)
    sync, wf = open(SYNC).read(), open(WF).read()
    WIRE_MUT = [
        ("render-sync deploys every service", sync.replace('plan[s["id"]]["decision"] == "deploy"', "True"), wf),
        ("render-sync reads the whole env list", sync.replace('f"/services/{sid}/env-vars/WASLA_SERVICE"', 'f"/services/{sid}/env-vars?limit=100"'), wf),
        ("workflow shallow clone", sync, re.sub(r"fetch-depth:\s*0", "fetch-depth: 1", wf)),
        ("workflow ignores docs-only pushes", sync, wf.replace("    branches: [main]\n", '    branches: [main]\n    paths-ignore:\n      - "docs/**"\n', 1)),
    ]
    for desc, s2, w2 in WIRE_MUT:
        if repo_checks(s2, w2): caught += 1
        else: print(f"  ✗ self-test: mutation not caught — {desc}")
    total = len(PLAN_MUT) + len(WIRE_MUT)
    if caught != total: sys.exit(1)
    print(f"  ✓ self-test: {caught}/{total} mutations caught")
finally:
    shutil.rmtree(repo)
PY
