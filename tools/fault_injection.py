"""Seeded-fault (mutation) harness: measures how many hand-written faults the test suites detect.

Each mutant in tools/mutants.json is a single source edit that introduces a plausible bug.
The harness copies backend/ and frontend/ into a temp directory, applies one mutant at a
time *to the copy*, runs the matching unit-test suite there, and records whether any test
failed ("killed") or everything still passed ("survived"). The real app is never modified.

Mutants with an odd number (B01, B03, ..., F01, ...) are "visible": their survival may be
reported back to the coding agent. Even-numbered mutants are "held-out" and never shown to
the agent, so the held-out kill rate is an unbiased fault-detection measure across rounds.

Usage (from repo root):
    backend/.venv/Scripts/python.exe tools/fault_injection.py --out docs/hw2/evidence/round0
    ... [--suite backend|frontend] [--ids B01,F03]
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MUTANTS = json.loads((ROOT / "tools" / "mutants.json").read_text(encoding="utf-8"))
TIMEOUT_S = 600

BACKEND_IGNORE = shutil.ignore_patterns(
    ".venv", "data", "htmlcov", ".pytest_cache", "__pycache__", ".coverage", "coverage.json"
)
FRONTEND_IGNORE = shutil.ignore_patterns(
    "node_modules", "dist", "coverage", "playwright-report", "test-results"
)


def visibility(mutant_id: str) -> str:
    return "visible" if int(mutant_id[1:]) % 2 == 1 else "held-out"


def link_dir(target: Path, link: Path) -> None:
    if os.name == "nt":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


def make_copy() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="ra-mutants-"))
    shutil.copytree(ROOT / "backend", tmp / "backend", ignore=BACKEND_IGNORE)
    shutil.copytree(ROOT / "frontend", tmp / "frontend", ignore=FRONTEND_IGNORE)
    link_dir(ROOT / "frontend" / "node_modules", tmp / "frontend" / "node_modules")
    return tmp


def remove_copy(tmp: Path) -> None:
    nm = tmp / "frontend" / "node_modules"
    if nm.exists():
        os.rmdir(nm) if os.name == "nt" else nm.unlink()  # remove the link, not its target
    shutil.rmtree(tmp, ignore_errors=True)


def suite_cmd(suite: str, tmp: Path) -> tuple[list[str], Path]:
    if suite == "backend":
        py = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        return [str(py), "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", "-p", "no:randomly", "--no-header"], tmp / "backend"
    vitest = ROOT / "frontend" / "node_modules" / "vitest" / "vitest.mjs"
    return ["node", str(vitest), "run", "--bail=1"], tmp / "frontend"


def run_suite(suite: str, tmp: Path) -> tuple[int | None, str, float]:
    cmd, cwd = suite_cmd(suite, tmp)
    start = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=TIMEOUT_S)
        return p.returncode, p.stdout + p.stderr, time.time() - start
    except subprocess.TimeoutExpired:
        return None, "TIMEOUT", time.time() - start


def failing_tests(suite: str, output: str) -> list[str]:
    if suite == "backend":
        names = re.findall(r"^(?:FAILED|ERROR) (\S+)", output, re.MULTILINE)
    else:
        names = re.findall(r"^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?$", output, re.MULTILINE)
    return [n.strip() for n in names][:5]


def apply(tmp: Path, mutant: dict) -> tuple[Path, bytes]:
    path = tmp / mutant["file"]
    original = path.read_bytes()
    text = original.decode("utf-8")
    old, new = mutant["old"], mutant["new"]
    if "\r\n" in text:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{mutant['id']}: expected exactly 1 match in {mutant['file']}, found {count}")
    path.write_bytes(text.replace(old, new).encode("utf-8"))
    return path, original


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--suite", choices=["backend", "frontend"])
    ap.add_argument("--ids", help="comma-separated mutant ids to run")
    args = ap.parse_args()

    mutants = [m for m in MUTANTS if not args.suite or m["suite"] == args.suite]
    if args.ids:
        wanted = set(args.ids.split(","))
        mutants = [m for m in mutants if m["id"] in wanted]

    tmp = make_copy()
    results = []
    try:
        for suite in sorted({m["suite"] for m in mutants}):
            code, out, _ = run_suite(suite, tmp)
            if code != 0:
                print(out[-3000:])
                raise SystemExit(f"Baseline {suite} suite does not pass on unmutated code; aborting.")
            print(f"baseline {suite}: OK")

        for m in mutants:
            path, original = apply(tmp, m)
            try:
                code, out, secs = run_suite(m["suite"], tmp)
            finally:
                path.write_bytes(original)
            status = "timeout" if code is None else "survived" if code == 0 else "killed"
            row = {
                "id": m["id"], "suite": m["suite"], "visibility": visibility(m["id"]),
                "file": m["file"], "desc": m["desc"], "status": status,
                "killed_by": failing_tests(m["suite"], out) if status == "killed" else [],
                "seconds": round(secs, 1),
            }
            results.append(row)
            print(f"{m['id']:4} {row['visibility']:9} {status:9} {m['desc']}")
    finally:
        remove_copy(tmp)

    summary = {}
    for vis in ("visible", "held-out", "all"):
        rows = [r for r in results if vis == "all" or r["visibility"] == vis]
        killed = sum(r["status"] != "survived" for r in rows)
        summary[vis] = {"killed": killed, "total": len(rows),
                        "score": round(100 * killed / len(rows), 1) if rows else None}
    for suite in ("backend", "frontend"):
        rows = [r for r in results if r["suite"] == suite]
        if rows:
            killed = sum(r["status"] != "survived" for r in rows)
            summary[suite] = {"killed": killed, "total": len(rows),
                              "score": round(100 * killed / len(rows), 1)}

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "mutation.json").write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    lines = ["| ID | Suite | Set | Fault | Result | Detected by |", "|---|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['id']} | {r['suite']} | {r['visibility']} | {r['desc']} | {r['status']} | "
                     f"{'<br>'.join(r['killed_by'])} |")
    lines.append("")
    for k, v in summary.items():
        lines.append(f"- **{k}**: {v['killed']}/{v['total']} killed ({v['score']}%)")
    (args.out / "mutation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    sys.exit(main())
