#!/usr/bin/env python3
"""baseline_commit.py — one source for "does BASELINE.repo.commit exist?" (RISK-0028, CLM-0538)

Why this file exists
--------------------
Gate 4(b) of `validate-baseline.sh` requires `repo.commit` to resolve. The
baseline is measured on a branch, so `repo.commit` is a branch commit. The
repository merges with squash and deletes the branch, so after the merge the
recorded commit is no longer reachable from any branch that `actions/checkout`
fetches (`refs/heads/*` + tags). Measured: PR #688 and PR #691 each left
`main` red on gate 4(b) and each needed a second docs-only PR (CLM-0533,
CLM-0536) that re-snapshotted the baseline. This happens for every PR that
touches BASELINE.json.

The commit was never gone. GitHub keeps the head of every pull request under
`refs/pull/<N>/head` for good, and lets a client fetch any commit reachable
from a ref by its full SHA. So the honest question is "does this commit exist
in the repository of record", and the local checkout is just a cache of that
repository. When the commit is missing from the cache, this module fetches
exactly that commit from `origin` by SHA and checks again.

What it does not relax
----------------------
- A SHA that exists nowhere is still rejected: the server answers
  "not our ref" and the gate fails.
- A shallow checkout is reported as unmeasured, same as before.
- No remote, no network, or a timeout means "missing". The gate fails rather
  than guessing.
- Only a 40-hex SHA is passed to git, never as an option, never a ref name.

Usage
-----
    python3 baseline_commit.py <root> <sha>   # prints one status line
    exit 0 = resolves (local | fetched) · 1 = missing · 2 = shallow/not-git

Status words: local · fetched · missing · shallow · not-git · invalid
"""

from __future__ import annotations

import re
import subprocess
import sys

_SHA = re.compile(r"^[0-9a-f]{40}$")
FETCH_TIMEOUT_S = 120


def _git(root: str, *args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", root, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _has_commit(root: str, sha: str) -> bool:
    try:
        return _git(root, "cat-file", "-e", sha + "^{commit}").returncode == 0
    except Exception:
        return False


def ensure(root: str, sha: str) -> tuple[str, str]:
    """Return (status, detail). Status: local | fetched | missing | shallow | not-git | invalid."""
    sha = (sha or "").strip().lower()
    if not _SHA.match(sha):
        return "invalid", "repo.commit is not a 40-hex SHA"
    try:
        shallow = _git(root, "rev-parse", "--is-shallow-repository").stdout.strip()
    except Exception:
        shallow = ""
    if shallow == "true":
        return "shallow", "shallow checkout: commit resolution not measured here"
    if shallow != "false":
        return "not-git", "root is not a git checkout"
    if _has_commit(root, sha):
        return "local", "present in the local checkout"
    try:
        remote = _git(root, "remote", "get-url", "origin").stdout.strip()
    except Exception:
        remote = ""
    if not remote:
        return "missing", "not in the local checkout and no `origin` remote to retrieve it from"
    try:
        res = _git(
            root,
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "origin",
            sha,
            timeout=FETCH_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return "missing", "retrieval from origin timed out after %ds" % FETCH_TIMEOUT_S
    except Exception as exc:  # pragma: no cover - environment failure
        return "missing", "retrieval from origin failed: %s" % exc
    if res.returncode == 0 and _has_commit(root, sha):
        return "fetched", "absent locally; retrieved from origin by SHA (e.g. a squash-merged PR head kept under refs/pull/N/head)"
    err = (res.stderr or "").strip().splitlines()
    return "missing", "not in the local checkout, and origin does not have it (%s)" % (err[-1] if err else "rc=%d" % res.returncode)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: baseline_commit.py <root> <sha>", file=sys.stderr)
        return 2
    status, detail = ensure(argv[1], argv[2])
    print("%s|%s" % (status, detail))
    if status in ("local", "fetched"):
        return 0
    if status == "missing" or status == "invalid":
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
