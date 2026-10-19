#!/usr/bin/env python3
"""runtime_reads.py — what a deployed service can read beyond its module closure (CLM-0628).

Why:
  The shared image is `COPY . .` + `pnpm install` of the whole workspace, so an
  image's bytes change with any file in the build context. The selective
  planner (render_plan.py) therefore does NOT claim byte-for-byte build-input
  equivalence. It claims *runtime-input* equivalence: the service process only
  loads (a) its workspace dependency closure, (b) node_modules, determined by
  the lockfile and every workspace manifest, (c) scripts/container/, which reads
  every workspace manifest to resolve WASLA_SERVICE, and (d) files it reads from
  disk. (d) is the part a module closure cannot see. Measured counterexample:
  services/observability/src/config.ts reads infra/observability/targets/,
  outside its closure.

The registry (scripts/deploy/runtime-reads.json) declares (d) per source file;
`audit()` fails closed in CI when runtime code
  - imports a file-system module in a file that is not registered, or whose
    file-system usage (imported names and call counts) no longer matches the
    registration (a re-review is forced);
  - contains a path literal that leaves its package (`../` past the package
    root, a cwd-relative repo path such as `packages/...`, or join/resolve with
    more `..` segments than the file's depth) not covered by the file's reads;
  - imports a module through a relative path that leaves its package;
  - uses a non-literal dynamic import/require, require.resolve,
    import.meta.resolve or import.meta.glob;
  - registers a file that no longer exists or no longer needs registering, or a
    read path that does not exist.
The planner adds the declared reads of every registered file inside a
service's closure to that service's inputs.

Declared limit: values computed at runtime from environment variables or
network input are not paths in source and cannot be seen here; the registry
records them in `why`, and `full=true` remains the fleet override.
"""
from __future__ import annotations

import json
import os
import re

FS_MODULES = ("fs", "node:fs", "fs/promises", "node:fs/promises")
REPO_TOPS = ("packages/", "services/", "apps/", "bots/", "infra/", "scripts/", "docs/")
TEST = re.compile(r"(__tests__/|/test/|/tests/|\.test\.|\.spec\.|vitest\.config|vite\.config|/fixtures?/)")
SRC_EXT = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx")
SKIP_DIRS = {"node_modules", "dist", "coverage", ".turbo"}

_IMPORT_FS = re.compile(
    r"""import\s+(?:(?P<default>[A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+(?P<ns>[A-Za-z_$][\w$]*)|\{(?P<named>[^}]*)\})?\s*from\s*["'](?P<mod>[^"']+)["']"""
)
_REQUIRE_FS = re.compile(r"""require\(\s*["'](?:node:)?fs(?:/promises)?["']\s*\)""")
_REL_SPEC = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+|\bexport\s+\*\s+from\s*)["'](\.{1,2}/[^"']*)["']""", re.M)
_DYNAMIC = re.compile(r"""\bimport\(\s*(?![\s"'`])|\brequire\(\s*(?![\s"'`])|\brequire\.resolve\(|\bimport\.meta\.resolve\(|\bimport\.meta\.glob\(""")
_STR = re.compile(r"""(?P<q>["'`])(?P<s>(?:\\.|(?!(?P=q)).)*?)(?P=q)""", re.S)


def workspace_dirs(root: str) -> list[str]:
    ws = open(os.path.join(root, "pnpm-workspace.yaml"), encoding="utf-8").read()
    out = []
    for g in re.findall(r'^\s*-\s*["\']?([^"\'\s]+)["\']?\s*$', ws, re.M):
        if g.endswith("/*"):
            parent = os.path.join(root, g[:-2])
            if os.path.isdir(parent):
                for n in sorted(os.listdir(parent)):
                    if os.path.isfile(os.path.join(parent, n, "package.json")):
                        out.append(f"{g[:-2]}/{n}")
        elif os.path.isfile(os.path.join(root, g, "package.json")):
            out.append(g)
    return out


def runtime_files(root: str, pkg: str):
    for dirpath, dirs, files in os.walk(os.path.join(root, pkg)):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for fn in sorted(files):
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
            if fn.endswith(SRC_EXT) and not TEST.search(rel) and not fn.endswith(".d.ts"):
                yield rel


def strip_comments(src: str) -> str:
    """Remove // and /* */ comments outside string literals (comments cite paths; code reads them)."""
    out, i, n, q = [], 0, len(src), None
    while i < n:
        c = src[i]
        if q:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == q:
                q = None
            i += 1
            continue
        if c in "\"'`":
            q = c; out.append(c); i += 1; continue
        if src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        out.append(c); i += 1
    return "".join(out)


def fs_fingerprint(src: str) -> dict[str, int]:
    """Imported file-system names → call count. Any change forces re-registration."""
    fp: dict[str, int] = {}
    for m in _IMPORT_FS.finditer(src):
        if m.group("mod") not in FS_MODULES:
            continue
        locals_: list[tuple[str, str]] = []
        for part in (m.group("named") or "").split(","):
            part = part.strip()
            if part and not part.startswith("type "):
                name, _, alias = part.partition(" as ")
                locals_.append((name.strip(), (alias or name).strip()))
        for imported, local in locals_:
            fp[imported] = fp.get(imported, 0) + len(re.findall(rf"(?<![\w$.]){re.escape(local)}\s*\(", src))
        for ns in (m.group("ns"), m.group("default")):
            if ns:
                for member in re.findall(rf"(?<![\w$.]){re.escape(ns)}\.(\w+)", src):
                    fp[f"{ns}.{member}"] = fp.get(f"{ns}.{member}", 0) + 1
                fp.setdefault(f"{ns}.*", 0)
    n = len(_REQUIRE_FS.findall(src))
    if n:
        fp["require(fs)"] = n
    return dict(sorted(fp.items()))


def _norm(p: str) -> str:
    return os.path.normpath(p).replace(os.sep, "/")


def _inside(path: str, pkg: str) -> bool:
    return path == pkg or path.startswith(pkg + "/")


def _join_escapes(src: str, file_dir: str, pkg: str) -> list[str]:
    """join(...)/resolve(...) whose literal '..' segments climb above the package."""
    out = []
    for m in re.finditer(r"\b(?:join|resolve)\(", src):
        i, depth = m.end(), 1
        while i < len(src) and depth:
            depth += {"(": 1, ")": -1}.get(src[i], 0)
            i += 1
        args = src[m.end(): i - 1]
        ups = len(re.findall(r"""["']\.\.["']""", args))
        if not ups:
            continue
        here = file_dir if "import.meta" in args or "__dirname" in args else pkg
        target = _norm(os.path.join(here, *([".."] * ups)))
        if not _inside(target, pkg):
            out.append(target + "/")
    return out


def out_of_package_paths(src: str, rel: str, pkg: str) -> list[list[str]]:
    """Each escaping path literal → its candidate repo paths (file-relative and package/cwd-relative)."""
    file_dir = os.path.dirname(rel)
    found = []
    for m in _STR.finditer(src):
        s = m.group("s").split("${", 1)[0]
        if not s or "\n" in s:
            continue
        if "../" in s or s == "..":
            rest = s[s.index(".."):] if ".." in s else s
            cands = [_norm(os.path.join(file_dir, rest)), _norm(os.path.join(pkg, rest))]
            outside = [c for c in cands if not _inside(c, pkg) and not c.startswith("..")]
            if outside and all(not _inside(c, pkg) for c in cands):
                found.append(outside)
        elif s.startswith(REPO_TOPS) and re.fullmatch(r"[\w./@-]+", s) and "/" in s.rstrip("/"):
            found.append([_norm(s)])
    for t in _join_escapes(src, file_dir, pkg):
        found.append([t.rstrip("/")])
    return found


def _covered(cands: list[str], reads: list[str]) -> bool:
    for c in cands:
        for r in reads:
            r0 = r.rstrip("/")
            if c == r0 or c.startswith(r0 + "/") or r0.startswith(c + "/"):
                return True
    return False


def load_registry(text: str | None) -> dict:
    if text is None:
        raise ValueError("runtime-reads.json missing")
    reg = json.loads(text)
    if not isinstance(reg.get("files"), dict):
        raise ValueError("runtime-reads.json has no `files` object")
    return reg


def audit(root: str, registry: dict) -> list[str]:
    errs: list[str] = []
    files = registry["files"]
    seen: set[str] = set()
    for pkg in workspace_dirs(root):
        for rel in runtime_files(root, pkg):
            src = strip_comments(open(os.path.join(root, rel), encoding="utf-8", errors="replace").read())
            for spec in _REL_SPEC.findall(src):
                if not _inside(_norm(os.path.join(os.path.dirname(rel), spec)), pkg):
                    errs.append(f"{rel}: relative import {spec!r} leaves package {pkg}")
            if _DYNAMIC.search(src):
                errs.append(f"{rel}: non-literal dynamic import/require or resolve/glob — the planner cannot see its target")
            fp = fs_fingerprint(src)
            paths = out_of_package_paths(src, rel, pkg)
            entry = files.get(rel)
            if not fp and not paths:
                if entry is not None:
                    errs.append(f"{rel}: registered in runtime-reads.json but no longer uses fs or out-of-package paths — remove the entry")
                continue
            seen.add(rel)
            if entry is None:
                errs.append(f"{rel}: runtime fs use {fp or '{}'} / out-of-package paths {[p[0] for p in paths]} not registered in scripts/deploy/runtime-reads.json")
                continue
            if entry.get("fs", {}) != fp:
                errs.append(f"{rel}: fs usage changed (registered {entry.get('fs')} · measured {fp}) — re-review its runtime reads")
            reads = entry.get("reads") or []
            for p in paths:
                if not _covered(p, reads):
                    errs.append(f"{rel}: out-of-package path {p[0]!r} not covered by registered reads {reads}")
            if not str(entry.get("why", "")).strip():
                errs.append(f"{rel}: registration has no `why`")
    for rel, entry in files.items():
        if rel not in seen and not os.path.isfile(os.path.join(root, rel)):
            errs.append(f"{rel}: registered file does not exist")
        for r in entry.get("reads") or []:
            if not os.path.exists(os.path.join(root, r.rstrip("/"))):
                errs.append(f"{rel}: registered read {r!r} does not exist")
    return errs


def extra_inputs(registry: dict, closure_dirs: list[str]) -> list[str]:
    """Declared runtime reads of every registered file inside the closure."""
    out: set[str] = set()
    for rel, entry in registry["files"].items():
        if any(rel.startswith(d if d.endswith("/") else d + "/") for d in closure_dirs):
            out.update(entry.get("reads") or [])
    return sorted(out)
