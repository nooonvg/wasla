#!/usr/bin/env bash
# validate-render-deploy-plan.sh — selective Render deploy decides from the LIVE
# commit of each service, not from the last push (CLM-0626), under a declared
# runtime-input-equivalence policy (CLM-0628 · RISK-0068 · M6-18B).
#
# Policy (CLM-0628): the shared image is `COPY . .`, so image bytes are NOT
# compared. A service is `runtime-equivalent` only when everything its process
# can load or read is identical between its live commit and the target: its
# workspace closure, root install files, every workspace manifest, the
# container scripts and the runtime reads declared in
# scripts/deploy/runtime-reads.json — which is audited against the code.
#
# Proves, on a throw-away git repository with a real pnpm-workspace layout:
#   1. a docs-only target still deploys a service whose earlier code change never
#      went live (the #772-behind-#773 case), and only that service;
#   2. REGRESSION (CLM-0628): a change outside a service's closure but inside the
#      Docker build context (another service's source) leaves it
#      `runtime-equivalent`; another package's manifest or a declared runtime
#      read outside the closure deploys it;
#   3. transitive dependencies, the lockfile and the Docker context are inputs;
#   4. every ambiguity deploys: no live deploy, live commit not in history,
#      inputs not derivable, no registry, a registry that does not describe the
#      target (unregistered fs use, changed fs usage, uncovered out-of-package
#      path), --all;
#   5. on the real repository: the registry audit passes, no package imports an
#      @wasla/* package it does not declare, render-sync.py deploys only `deploy`
#      decisions, render-deploy.yml fetches full history on every push to main.
# Then mutates render_plan.py / runtime_reads.py / the wiring; every mutation
# must be caught.
#
# Mandatory in scripts/verify.sh. Reference: docs/12-testing/ci-evidence/
# 2026-10-19T120000Z-clm-0626-render-selective-deploy/README.md and
# 2026-10-19T140000Z-clm-0628-deploy-runtime-closure/README.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import importlib.util, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.getcwd()
PLAN = os.path.join(ROOT, "scripts/deploy/render_plan.py")
RR = os.path.join(ROOT, "scripts/deploy/runtime_reads.py")
REG = os.path.join(ROOT, "scripts/deploy/runtime-reads.json")
SYNC = os.path.join(ROOT, "scripts/deploy/render-sync.py")
WF = os.path.join(ROOT, ".github/workflows/render-deploy.yml")
_n = [0]


def load(plan_path, rr_path):
    """Fresh (render_plan, runtime_reads) pair; render_plan imports runtime_reads by name."""
    _n[0] += 1
    spec = importlib.util.spec_from_file_location(f"rr_{_n[0]}", rr_path)
    rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
    sys.modules["runtime_reads"] = rr
    spec = importlib.util.spec_from_file_location(f"rp_{_n[0]}", plan_path)
    rp = importlib.util.module_from_spec(spec); spec.loader.exec_module(rp)
    return rp, rr


def sh(repo, *a):
    subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True)


def write(repo, path, text):
    p = os.path.join(repo, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(text)


def commit(repo, msg):
    sh(repo, "add", "-A"); sh(repo, "commit", "-qm", msg)
    return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


OBS_SRC = ('import { readFileSync } from "node:fs";\n'
           "export const DIR = new URL('../../../infra/targets/', import.meta.url);\n"
           "export const load = (n: string) => readFileSync(`${DIR.pathname}${n}.targets`, 'utf8');\n")
FIX_REG = {"files": {"services/o2/src/config.ts": {"fs": {"readFileSync": 1}, "reads": ["infra/targets/"],
                                                    "why": "fixture: reads infra/targets/ outside its package"}}}


def fixture():
    r = tempfile.mkdtemp()
    sh(r, "init", "-q"); sh(r, "config", "user.email", "t@t"); sh(r, "config", "user.name", "t")
    write(r, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "services/*"\n  - "apps/*"\n')
    for f in ("package.json", "pnpm-lock.yaml", "tsconfig.json", "Dockerfile", ".dockerignore", "scripts/container/entrypoint.sh"):
        write(r, f, "v1\n")
    pk = lambda n, deps=None: json.dumps({"name": n, "dependencies": deps or {}})
    write(r, "packages/y/package.json", pk("@t/y")); write(r, "packages/y/src/y.ts", "export const y = 1;\n")
    write(r, "packages/x/package.json", pk("@t/x", {"@t/y": "workspace:*"})); write(r, "packages/x/src/x.ts", "export const x = 1;\n")
    write(r, "services/a/package.json", pk("@t/a", {"@t/x": "workspace:*"})); write(r, "services/a/src/a.ts", "export const a = 1;\n")
    write(r, "services/b/package.json", pk("@t/b")); write(r, "services/b/src/b.ts", "export const b = 1;\n")
    write(r, "services/o2/package.json", pk("@t/o2")); write(r, "services/o2/src/config.ts", OBS_SRC)
    write(r, "apps/web/package.json", pk("@t/web")); write(r, "apps/web/src/w.ts", "export const w = 1;\n")
    write(r, "infra/obs/Dockerfile.p", "1\n"); write(r, "infra/obs/config.yml", "1\n")
    write(r, "infra/targets/prod.targets", "1\n"); write(r, "docs/readme.md", "1\n")
    write(r, "scripts/deploy/runtime-reads.json", json.dumps(FIX_REG))
    c = {"c1": commit(r, "base")}
    write(r, "packages/y/src/y.ts", "export const y = 2;\n"); c["c2"] = commit(r, "transitive code change (the #772)")
    write(r, "docs/readme.md", "2\n"); c["c3"] = commit(r, "docs only (the #773)")
    write(r, "pnpm-lock.yaml", "v2\n"); c["c4"] = commit(r, "lockfile")
    write(r, "infra/obs/config.yml", "2\n"); c["c5"] = commit(r, "observability context")
    write(r, "services/b/src/b.ts", "export const b = 2;\n"); c["c6"] = commit(r, "outside A's closure, inside the Docker context")
    write(r, "infra/targets/prod.targets", "2\n"); c["c7"] = commit(r, "declared runtime read outside o2's closure")
    write(r, "services/b/package.json", json.dumps({"name": "@t/b", "version": "2.0.0"})); c["c8"] = commit(r, "another package's manifest")
    write(r, "services/o2/src/config.ts", OBS_SRC + "export const again = () => readFileSync('/etc/hostname', 'utf8');\n")
    c["c9"] = commit(r, "fs usage changed without re-registration")
    write(r, "services/o2/src/config.ts", OBS_SRC); write(r, "services/b/src/io.ts", 'import { readdirSync } from "node:fs";\nexport const ls = () => readdirSync(".");\n')
    c["c10"] = commit(r, "new unregistered fs use")
    sh(r, "rm", "-q", "services/b/src/io.ts")
    write(r, "services/o2/src/config.ts", OBS_SRC + "export const OTHER = new URL('../../../infra/other/', import.meta.url);\n")
    write(r, "infra/other/x", "1\n"); c["c11"] = commit(r, "out-of-package path not covered by the registration")
    return r, c


def img(ctx=".", df="Dockerfile"):
    return {"type": "web_service", "serviceDetails": {"envSpecificDetails": {"dockerfilePath": df, "dockerContext": ctx}}}


SVC = {
    "A": (img(), "@t/a"),
    "B": (img("./", "./Dockerfile"), "@t/b"),
    "O2": (img(), "@t/o2"),
    "W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm install && pnpm --filter @t/web build"}}, None),
    "O": (img("infra/obs", "infra/obs/Dockerfile.p"), None),
}
ALL = tuple(SVC)


def plan(rp, repo, live, target, names=ALL, ws_override=None, svc_override=None, force=False, registry="audit"):
    pkgs = rp.workspace_packages(repo, target)
    if registry == "audit":
        registry, _ = rp.registry_for_target(repo, target, None)
    out = {}
    for n in names:
        svc, ws = (svc_override or {}).get(n, SVC[n])
        if ws_override and n in ws_override: ws = ws_override[n]
        inputs, _ = rp.inputs_for(repo, target, svc, ws, pkgs, registry)
        out[n] = rp.decide(repo, live, target, inputs, force=force)
    return out


RE = "runtime-equivalent"


def cases(rp, rr, repo, c):
    errs = []
    def expect(desc, got, want, reason_has=None):
        for n, w in want.items():
            if got[n]["decision"] != w:
                errs.append(f"{desc}: {n} = {got[n]['decision']} ({got[n]['reason']}), want {w}")
            elif reason_has and n in reason_has and reason_has[n] not in got[n]["reason"]:
                errs.append(f"{desc}: {n} reason {got[n]['reason']!r} lacks {reason_has[n]!r}")
    def run(desc, *a, want, reason_has=None, **k):
        try:
            expect(desc, plan(rp, repo, *a, **k), want, reason_has)
        except Exception as e:  # a crash is a failed case, not a pass
            errs.append(f"{desc}: raised {type(e).__name__}: {e}")
    run("docs-only target behind an undeployed code change (c1 → c3)", c["c1"], c["c3"],
        want={"A": "deploy", "B": RE, "O2": RE, "W": RE, "O": RE})
    run("live already carries the code change (c2 → c3)", c["c2"], c["c3"], want={"A": RE})
    run("live is the target", c["c3"], c["c3"], want={"A": "current", "O": "current"})
    run("lockfile change (c3 → c4)", c["c3"], c["c4"], want={"A": "deploy", "B": "deploy", "W": "deploy", "O": RE})
    run("Docker context change (c4 → c5)", c["c4"], c["c5"], want={"A": RE, "W": RE, "O": "deploy"})
    run("REGRESSION: outside A's closure, inside the Docker build context (c5 → c6)", c["c5"], c["c6"],
        want={"A": RE, "B": "deploy", "O2": RE, "W": RE, "O": RE}, reason_has={"A": "image bytes not compared"})
    run("declared runtime read outside the closure (c6 → c7)", c["c6"], c["c7"], want={"O2": "deploy", "A": RE, "B": RE})
    run("another package's manifest (c7 → c8)", c["c7"], c["c8"], want={"A": "deploy", "O2": "deploy", "W": "deploy", "O": RE})
    run("fs usage changed without re-registration (c8 → c9)", c["c8"], c["c9"], want={"A": "deploy", "W": "deploy", "O": RE},
        reason_has={"A": "not derivable"})
    run("new unregistered fs use (c9 → c10)", c["c9"], c["c10"], want={"A": "deploy"}, reason_has={"A": "not derivable"})
    run("uncovered out-of-package path (c10 → c11)", c["c10"], c["c11"], want={"A": "deploy"}, reason_has={"A": "not derivable"})
    run("no registry at all", c["c2"], c["c3"], registry=None, want={"A": "deploy", "W": "deploy", "O": RE}, reason_has={"A": "not derivable"})
    run("live commit not in history", "d" * 40, c["c3"], want={"A": "deploy", "O": "deploy"}, reason_has={"A": "not in history"})
    run("no live deploy", "", c["c3"], want={"A": "deploy"}, reason_has={"A": "no live deploy"})
    run("WASLA_SERVICE unknown", c["c2"], c["c3"], ws_override={"A": None}, want={"A": "deploy"}, reason_has={"A": "not derivable"})
    two = {"W": ({"type": "static_site", "serviceDetails": {"buildCommand": "pnpm --filter @t/web --filter @t/b build"}}, None)}
    run("static build command ambiguous", c["c2"], c["c3"], svc_override=two, want={"W": "deploy"}, reason_has={"W": "not derivable"})
    run("--all", c["c2"], c["c3"], force=True, want={n: "deploy" for n in ALL})
    return errs


def repo_checks(sync_src, wf_src):
    errs = []
    if "import render_plan" not in sync_src: errs.append("render-sync.py does not use render_plan")
    if 'plan[s["id"]]["decision"] == "deploy"' not in sync_src: errs.append("render-sync.py does not deploy only `deploy` decisions")
    if "for s in to_deploy:" not in sync_src: errs.append("render-sync.py triggers deploys outside the plan")
    if "registry_for_target(" not in sync_src: errs.append("render-sync.py does not audit the runtime-read registry against the target")
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
    rp, rr = load(PLAN, RR)
    errs = cases(rp, rr, repo, c)
    errs += [f"runtime-reads: {e}" for e in rr.audit(ROOT, rr.load_registry(open(REG).read()))]
    errs += repo_checks(open(SYNC).read(), open(WF).read())
    errs += undeclared_imports()
    if errs:
        for e in errs: print(f"  ✗ {e}")
        sys.exit(1)
    nreg = len(json.load(open(REG))["files"])
    print(f"  ✓ plan: live→target · runtime-input equivalence (image bytes not compared) · outside-closure/inside-context regression · ambiguity deploys · registry audit {nreg} files clean · closure premise holds")

    PLAN_MUT = [
        ("diff from the last push instead of the live commit", '"diff", "--name-only", live, target', '"diff", "--name-only", target + "~1", target'),
        ("history check removed", 'if git(repo, "cat-file", "-e", f"{live}^{{commit}}").returncode != 0:', "if False:"),
        ("unknown inputs treated as equivalent", 'return {"decision": "deploy", "reason": "build inputs not derivable"}', 'return {"decision": "runtime-equivalent", "reason": "build inputs not derivable"}'),
        ("closure not transitive", "                    todo.append(dep)", "                    seen.add(dep)"),
        ("lockfile not an input", '"pnpm-lock.yaml", ', ""),
        ("Docker context not an input", 'return sorted({ctx + "/", dockerfile})', "return [dockerfile]"),
        ("always deploy (no saving)", "    if changed:\n", "    if True:\n"),
        ("workspace manifests not inputs", "list(ROOT_COMMON) + manifests + ", "list(ROOT_COMMON) + "),
        ("declared runtime reads not inputs", " + runtime_reads.extra_inputs(registry, cl)", ""),
        ("registry not audited on the target", "errs = runtime_reads.audit(tmp, reg)", "errs = []"),
    ]
    RR_MUT = [
        ("unregistered fs use ignored", "            if entry is None:\n                errs.append(", "            if entry is None:\n                continue\n                errs.append("),
        ("fs fingerprint not compared", 'if entry.get("fs", {}) != fp:', "if False:"),
        ("out-of-package path coverage not checked", "if not _covered(p, reads):", "if False:"),
        ("../ literals not seen", 'if "../" in s or s == "..":', "if False:"),
    ]
    caught, total = 0, 0
    for target_path, muts in ((PLAN, PLAN_MUT), (RR, RR_MUT)):
        src = open(target_path).read()
        for desc, a, b in muts:
            total += 1
            assert a in src, f"self-test anchor missing: {desc}"
            d = tempfile.mkdtemp()
            try:
                pp, rp_ = os.path.join(d, "render_plan.py"), os.path.join(d, "runtime_reads.py")
                shutil.copy(PLAN, pp); shutil.copy(RR, rp_)
                open(os.path.join(d, os.path.basename(target_path)), "w").write(src.replace(a, b, 1))
                mp, mr = load(pp, rp_)
                if cases(mp, mr, repo, c): caught += 1
                else: print(f"  ✗ self-test: mutation not caught — {desc}")
            finally: shutil.rmtree(d)
    sync, wf = open(SYNC).read(), open(WF).read()
    WIRE_MUT = [
        ("render-sync deploys every service", sync.replace('plan[s["id"]]["decision"] == "deploy"', "True"), wf),
        ("render-sync reads the whole env list", sync.replace('f"/services/{sid}/env-vars/WASLA_SERVICE"', 'f"/services/{sid}/env-vars?limit=100"'), wf),
        ("render-sync skips the registry audit", sync.replace("registry_for_target(", "registry_unchecked("), wf),
        ("workflow shallow clone", sync, re.sub(r"fetch-depth:\s*0", "fetch-depth: 1", wf)),
        ("workflow ignores docs-only pushes", sync, wf.replace("    branches: [main]\n", '    branches: [main]\n    paths-ignore:\n      - "docs/**"\n', 1)),
    ]
    for desc, s2, w2 in WIRE_MUT:
        total += 1
        if repo_checks(s2, w2): caught += 1
        else: print(f"  ✗ self-test: mutation not caught — {desc}")
    if caught != total: sys.exit(1)
    print(f"  ✓ self-test: {caught}/{total} mutations caught")
finally:
    shutil.rmtree(repo)
PY
