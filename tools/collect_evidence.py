"""Run every test suite + coverage + flakiness checks + fault injection for one round.

All outputs land in docs/hw2/evidence/<round>/ so each round is measured identically.

Usage (from repo root):
    backend/.venv/Scripts/python.exe tools/collect_evidence.py round0 [--skip-mutation] [--skip-e2e]
"""

import argparse
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
NODE_BIN = FRONTEND / "node_modules"
VITEST = ["node", str(NODE_BIN / "vitest" / "vitest.mjs")]
PLAYWRIGHT = ["node", str(NODE_BIN / "@playwright" / "test" / "cli.js")]


def run(cmd: list[str], cwd: Path, log: Path, env: dict | None = None) -> int:
    print(f"$ {' '.join(cmd)}  (cwd={cwd.relative_to(ROOT)})", flush=True)
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env={**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0", **(env or {})})
    log.write_text(f"$ {' '.join(cmd)}\nexit code: {p.returncode}\n\n{p.stdout}{p.stderr}", encoding="utf-8")
    print(f"  -> exit {p.returncode}, log: {log.relative_to(ROOT)}", flush=True)
    return p.returncode


def junit_counts(path: Path) -> dict:
    if not path.exists():
        return {}
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    total = failures = errors = skipped = 0
    xfailed = 0
    for s in suites:
        for case in s.iter("testcase"):
            total += 1
            if case.find("failure") is not None:
                failures += 1
            elif case.find("error") is not None:
                errors += 1
            elif (sk := case.find("skipped")) is not None:
                if "xfail" in (sk.get("type", "") + sk.get("message", "")).lower():
                    xfailed += 1
                else:
                    skipped += 1
    return {"total": total, "passed": total - failures - errors - skipped - xfailed,
            "failed": failures, "errors": errors, "skipped": skipped, "xfailed": xfailed}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("round")
    ap.add_argument("--skip-mutation", action="store_true")
    ap.add_argument("--skip-e2e", action="store_true")
    ap.add_argument("--flaky-runs", type=int, default=3)
    args = ap.parse_args()
    out = ROOT / "docs" / "hw2" / "evidence" / args.round
    out.mkdir(parents=True, exist_ok=True)
    summary: dict = {"round": args.round}

    # --- Backend: pytest + branch coverage (deterministic order) -------------------------------
    code = run([str(PY), "-m", "pytest", "-p", "no:randomly", "-p", "no:cacheprovider",
                "--cov", "--cov-branch", "--cov-report=term-missing",
                f"--cov-report=html:{out / 'backend-htmlcov'}",
                f"--cov-report=json:{out / 'backend-coverage.json'}",
                f"--junitxml={out / 'backend-junit.xml'}"],
               BACKEND, out / "backend-tests.txt")
    cov = json.loads((out / "backend-coverage.json").read_text())["totals"] \
        if (out / "backend-coverage.json").exists() else {}
    summary["backend"] = {
        "exit_code": code, **junit_counts(out / "backend-junit.xml"),
        "line_pct": round(100 * cov["covered_lines"] / cov["num_statements"], 1) if cov else None,
        "branch_pct": round(100 * cov["covered_branches"] / cov["num_branches"], 1)
        if cov.get("num_branches") else None,
        "combined_pct": round(cov["percent_covered"], 1) if cov else None,
    }

    # --- Frontend: vitest + v8 coverage ---------------------------------------------------------
    code = run([*VITEST, "run", "--coverage", f"--coverage.reportsDirectory={out / 'frontend-coverage'}",
                "--reporter=default", "--reporter=junit", f"--outputFile.junit={out / 'frontend-junit.xml'}"],
               FRONTEND, out / "frontend-tests.txt")
    fsum = out / "frontend-coverage" / "coverage-summary.json"
    ftot = json.loads(fsum.read_text())["total"] if fsum.exists() else {}
    summary["frontend"] = {
        "exit_code": code, **junit_counts(out / "frontend-junit.xml"),
        **({f"{k}_pct": ftot[k]["pct"] for k in ("lines", "branches", "functions", "statements")} if ftot else {}),
    }

    # --- E2E: Playwright ------------------------------------------------------------------------
    if not args.skip_e2e:
        code = run([*PLAYWRIGHT, "test", "--reporter=list,json,html"], FRONTEND, out / "e2e-tests.txt",
                   env={"PLAYWRIGHT_JSON_OUTPUT_NAME": str(out / "e2e-results.json"),
                        "PLAYWRIGHT_HTML_REPORT": str(out / "e2e-report"),
                        "PLAYWRIGHT_HTML_OPEN": "never"})
        stats = {}
        if (out / "e2e-results.json").exists():
            stats = json.loads((out / "e2e-results.json").read_text(encoding="utf-8")).get("stats", {})
        summary["e2e"] = {"exit_code": code, "passed": stats.get("expected"), "failed": stats.get("unexpected"),
                          "flaky": stats.get("flaky"), "skipped": stats.get("skipped")}

    # --- Flakiness: rerun unit suites in shuffled order with fixed seeds --------------------------
    flaky = {"backend": [], "frontend": []}
    for i in range(1, args.flaky_runs + 1):
        seed = str(1000 + i)
        flaky["backend"].append(run([str(PY), "-m", "pytest", "-q", "-p", "randomly", "-p", "no:cacheprovider",
                                     f"--randomly-seed={seed}"], BACKEND, out / f"flaky-backend-{seed}.txt"))
        flaky["frontend"].append(run([*VITEST, "run", "--sequence.shuffle", f"--sequence.seed={seed}"],
                                     FRONTEND, out / f"flaky-frontend-{seed}.txt"))
    summary["flakiness"] = {k: {"runs": len(v), "non_zero_exits": sum(c != 0 for c in v)} for k, v in flaky.items()}

    # --- Fault injection ------------------------------------------------------------------------
    if not args.skip_mutation:
        run([str(PY), str(ROOT / "tools" / "fault_injection.py"), "--out", str(out)], ROOT, out / "mutation-run.txt")
        mfile = out / "mutation.json"
        if mfile.exists():
            summary["mutation"] = json.loads(mfile.read_text())["summary"]

    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    sys.exit(main())
