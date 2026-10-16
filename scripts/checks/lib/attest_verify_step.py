#!/usr/bin/env python3
"""CLM-0576 — يقيسُ خطوةَ التحقّقِ الموجبةَ في وظيفةِ image-supply-chain من ci.yml.

لا يكفي ظهورُ اسمِ السكربتِ في الملفّ: تعليقُ YAML، أو تعليقُ shell داخلَ run:،
أو اسمُ خطوة، أو نصٌّ داخلَ echo — كلُّها ليست استدعاءً. يُعَدُّ الاستدعاءُ تنفيذيًّا
فقط إن كان **أمرًا** في كتلةِ run: لخطوةٍ من الوظيفة: سطرٌ منطقيٌّ (بعدَ حذفِ تعليقاتِ
shell وضمِّ الأسطرِ المستمرّةِ بـ\\) يبدأُ بـ `[bash ]scripts/ci/verify-sbom-attestations.sh`
— في أوّلِ السطرِ أو بعدَ `;` أو `&&`.

الاستعمال: attest_verify_step.py <ci.yml>
المخرَج (سطرٌ لكلِّ خطوةٍ فيها استدعاءٌ تنفيذيّ، ثمّ ملخّص):
  STEP <idx> token=<0|1> args=<قائمةُ الناقصِ أو -> mask=<0|1>
  CALLS <n>
"""
import re
import sys

SCRIPT = "scripts/ci/verify-sbom-attestations.sh"
CALL_RE = re.compile(r"(?:^|;|&&)\s*(?:bash\s+)?(?:\./)?" + re.escape(SCRIPT) + r"(?=\s|$)")
TOKEN_RE = re.compile(r"^GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}\s*$")
NEEDS = ("artifacts/sbom/pass1.cdx.json", "artifacts/sbom/pass2.cdx.json", ".github/workflows/ci.yml")


def indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def strip_shell_comment(line: str) -> str:
    """يحذفُ تعليقَ shell: سطرٌ يبدأُ بـ# أو ` #` خارجَ علاماتِ الاقتباس."""
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            if ch == q:
                q = None
        elif ch in ("'", '"'):
            q = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def logical_lines(run_lines):
    buf = ""
    for raw in run_lines:
        s = raw.strip()
        if not s or s.startswith("#"):
            # سطرُ تعليقٍ لا يُكمِلُ ولا يُستكمَل
            if buf:
                yield buf
                buf = ""
            continue
        s = strip_shell_comment(s)
        if s.endswith("\\"):
            buf += s[:-1] + " "
            continue
        yield buf + s
        buf = ""
    if buf:
        yield buf


def job_lines(text: str, job: str):
    lines = text.splitlines()
    on, out = False, []
    for ln in lines:
        if re.match(r"^  " + re.escape(job) + r":\s*$", ln):
            on = True
            continue
        if on and re.match(r"^  [A-Za-z0-9_-]+:\s*$", ln):
            break
        if on and re.match(r"^\S", ln):
            break
        if on:
            out.append(ln)
    return out


def steps(lines):
    cur = None
    for ln in lines:
        if re.match(r"^      - ", ln):
            if cur is not None:
                yield cur
            cur = [ln]
        elif cur is not None:
            cur.append(ln)
    if cur is not None:
        yield cur


def analyse(step):
    """يعيدُ (أسطرُ run، أسطرُ env) للخطوة — بلا تعليقاتِ YAML خارجَ كتلةِ run."""
    # أوّلُ سطرٍ "      - key: v" ⇒ مفاتيحُ الخطوةِ على عمقِ 8
    first = step[0]
    norm = ["        " + first[8:]] + step[1:]
    run, env = [], []
    mode, block_indent = None, None
    for ln in norm:
        if mode == "run":
            if ln.strip() == "" or indent(ln) > 8:
                run.append(ln)
                continue
            mode = None
        if mode == "env":
            if ln.strip() == "" or ln.lstrip().startswith("#"):
                continue
            if indent(ln) > 8:
                env.append(ln.strip())
                continue
            mode = None
        if ln.lstrip().startswith("#"):
            continue  # تعليقُ YAML على مستوى الخطوة
        m = re.match(r"^        run:\s*(.*)$", ln)
        if m:
            v = m.group(1).strip()
            if re.match(r"^[|>][-+]?\s*(#.*)?$", v):
                mode = "run"
            elif v and not v.startswith("#"):
                run.append(v.strip("'\"") if (v[:1] in "'\"" and v[-1:] == v[:1]) else v)
            continue
        if re.match(r"^        env:\s*(#.*)?$", ln):
            mode = "env"
            continue
    return run, env


def main() -> int:
    text = open(sys.argv[1], encoding="utf-8").read()
    calls = 0
    for idx, step in enumerate(steps(job_lines(text, "image-supply-chain"))):
        run, env = analyse(step)
        hits = [l for l in logical_lines(run) if CALL_RE.search(l)]
        if not hits:
            continue
        calls += 1
        token = int(any(TOKEN_RE.match(e) for e in env))
        joined = " ".join(hits)
        missing = [n for n in NEEDS if n not in joined]
        mask = int(any(re.search(re.escape(SCRIPT) + r".*\|\|", h) for h in hits))
        print(f"STEP {idx} token={token} args={','.join(missing) or '-'} mask={mask}")
    print(f"CALLS {calls}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
