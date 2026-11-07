"""Systematic (tool-generated) mutation testing for the backend, using standard AST operators.

Unlike tools/mutants.json (37 hand-written faults), these mutants are not chosen by a person:
every eligible site in backend/app/**/*.py is enumerated with classic mutation operators, and
a fixed-seed random sample is run. The app is frozen, so the same seed always yields the same
mutants, and every round of the test suite is measured against the identical sample.

Operators: comparison swap (== / !=, < / <=, in / not in, is / is not ...), and/or swap,
`not` removal, if/while condition negation, arithmetic swap (+ / -, * / /), constant change
(int n -> n+1, True <-> False, short string -> ""), return value -> None, and call statement
-> pass. Docstrings, logging calls and type annotations are not mutated.

Odd-indexed sampled mutants are "visible" (may be shown to the agent); even ones are
"held-out" and never shown.

Usage (from repo root):
    backend/.venv/Scripts/python.exe tools/ast_mutation.py --out docs/hw2/evidence/round0 [--n 100]
    backend/.venv/Scripts/python.exe tools/ast_mutation.py --list   # print all sampled mutants
"""

import argparse
import ast
import json
import random
import sys
from pathlib import Path

import fault_injection as fi

APP = fi.ROOT / "backend" / "app"
SEED = 593
CMP_SWAP = {ast.Eq: ast.NotEq, ast.NotEq: ast.Eq, ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE,
            ast.GtE: ast.Gt, ast.In: ast.NotIn, ast.NotIn: ast.In, ast.Is: ast.IsNot, ast.IsNot: ast.Is}
BIN_SWAP = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div, ast.Div: ast.Mult}


def annotate(tree: ast.AST) -> None:
    """Attach .parent and .field to every node so exclusions can look at ancestors."""
    for node in ast.walk(tree):
        for field, value in ast.iter_fields(node):
            for child in value if isinstance(value, list) else [value]:
                if isinstance(child, ast.AST):
                    child.parent, child.field = node, field


def is_log_call(node: ast.AST) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name) and node.func.value.id in ("log", "logging"))


def excluded(node: ast.AST) -> bool:
    if isinstance(node, ast.Expr) and is_log_call(node.value):
        return True
    n = node
    while (parent := getattr(n, "parent", None)) is not None:
        if getattr(n, "field", None) in ("annotation", "returns"):
            return True
        if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Attribute) \
                and isinstance(parent.func.value, ast.Name) and parent.func.value.id in ("log", "logging"):
            return True
        n = parent
    return False


def is_docstring(node: ast.AST) -> bool:
    expr = node if isinstance(node, ast.Expr) else getattr(node, "parent", None)
    return (isinstance(expr, ast.Expr) and isinstance(expr.value, ast.Constant)
            and isinstance(expr.value.value, str)
            and isinstance(getattr(expr, "parent", None), (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            and expr.parent.body[0] is expr)


def sites(tree: ast.AST) -> list[tuple[int, str, int]]:
    """(node index in ast.walk order, operator kind, variant) for every mutable site."""
    out = []
    for i, node in enumerate(ast.walk(tree)):
        if excluded(node) or is_docstring(node):
            continue
        if isinstance(node, ast.Compare):
            out += [(i, "compare", j) for j, op in enumerate(node.ops) if type(op) in CMP_SWAP]
        elif isinstance(node, ast.BoolOp):
            out.append((i, "boolop", 0))
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            out.append((i, "drop_not", 0))
        elif isinstance(node, (ast.If, ast.While, ast.IfExp)):
            out.append((i, "negate_cond", 0))
        elif isinstance(node, ast.BinOp) and type(node.op) in BIN_SWAP:
            out.append((i, "binop", 0))
        elif isinstance(node, ast.Constant):
            v = node.value
            if isinstance(v, bool) or (isinstance(v, int) and not isinstance(v, bool)) \
                    or (isinstance(v, str) and 0 < len(v) <= 60 and not isinstance(node.parent, ast.JoinedStr)):
                out.append((i, "constant", 0))
        elif isinstance(node, ast.Return) and node.value is not None \
                and not (isinstance(node.value, ast.Constant) and node.value.value is None):
            out.append((i, "return_none", 0))
        elif isinstance(node, ast.Expr) and isinstance(node.value, (ast.Call, ast.Await)):
            out.append((i, "stmt_to_pass", 0))
    return out


def replace(node: ast.AST, new: ast.AST) -> None:
    parent, field = node.parent, node.field
    value = getattr(parent, field)
    if isinstance(value, list):
        value[value.index(node)] = new
    else:
        setattr(parent, field, new)


def mutate(source: str, index: int, kind: str, variant: int) -> tuple[str, int, str, str]:
    """Return (mutated source, line, before snippet, after snippet)."""
    tree = ast.parse(source)
    annotate(tree)
    node = list(ast.walk(tree))[index]
    line = node.lineno
    before = ast.unparse(node).splitlines()[0][:90]
    if kind == "compare":
        node.ops[variant] = CMP_SWAP[type(node.ops[variant])]()
        target = node
    elif kind == "boolop":
        node.op = ast.Or() if isinstance(node.op, ast.And) else ast.And()
        target = node
    elif kind == "drop_not":
        replace(node, target := node.operand)
    elif kind == "negate_cond":
        node.test = ast.UnaryOp(op=ast.Not(), operand=node.test)
        target = node
    elif kind == "binop":
        node.op = BIN_SWAP[type(node.op)]()
        target = node
    elif kind == "constant":
        v = node.value
        node.value = (not v) if isinstance(v, bool) else v + 1 if isinstance(v, int) else ""
        target = node
    elif kind == "return_none":
        node.value = ast.Constant(value=None)
        target = node
    elif kind == "stmt_to_pass":
        replace(node, target := ast.Pass())
    else:
        raise ValueError(kind)
    after = ast.unparse(target).splitlines()[0][:90]
    if kind == "constant" and isinstance(node.value, str):
        after = '""'
    return ast.unparse(ast.fix_missing_locations(tree)), line, before, after


def sample(n: int) -> list[dict]:
    candidates = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        annotate(tree)
        rel = path.relative_to(fi.ROOT).as_posix()
        candidates += [{"file": rel, "index": i, "kind": k, "variant": v} for i, k, v in sites(tree)]
    chosen = random.Random(SEED).sample(candidates, min(n, len(candidates)))
    chosen.sort(key=lambda m: (m["file"], m["index"], m["variant"]))
    for num, m in enumerate(chosen, 1):
        m["id"] = f"A{num:03d}"
        m["visibility"] = "visible" if num % 2 == 1 else "held-out"
        src = (fi.ROOT / m["file"]).read_text(encoding="utf-8")
        _, m["line"], m["before"], m["after"] = mutate(src, m["index"], m["kind"], m["variant"])
    return chosen, len(candidates)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--timeout", type=int, default=180)
    args = ap.parse_args()

    mutants, population = sample(args.n)
    if args.list or not args.out:
        print(f"{len(mutants)} sampled from {population} candidate sites (seed {SEED})")
        for m in mutants:
            print(f"{m['id']} {m['visibility']:8} {m['file']}:{m['line']} {m['kind']}: {m['before']}  ->  {m['after']}")
        return

    fi.TIMEOUT_S = args.timeout
    tmp = fi.make_copy()
    results = []
    try:
        # Round-trip baseline: every app module re-emitted by ast.unparse must still pass,
        # so a mutant's only behavioral change is the mutation itself.
        originals = {}
        for path in sorted((tmp / "backend" / "app").rglob("*.py")):
            originals[path] = path.read_bytes()
            path.write_text(ast.unparse(ast.parse(originals[path].decode("utf-8"))), encoding="utf-8")
        code, out, _ = fi.run_suite("backend", tmp)
        for path, data in originals.items():
            path.write_bytes(data)
        if code != 0:
            print(out[-3000:])
            raise SystemExit("Round-trip baseline failed; aborting.")
        print(f"baseline (unparsed app) OK; running {len(mutants)} mutants of {population} sites", flush=True)

        for m in mutants:
            path = tmp / m["file"]
            original = path.read_bytes()
            mutated, *_ = mutate(original.decode("utf-8"), m["index"], m["kind"], m["variant"])
            path.write_text(mutated, encoding="utf-8")
            try:
                code, out, secs = fi.run_suite("backend", tmp)
            finally:
                path.write_bytes(original)
            status = "timeout" if code is None else "survived" if code == 0 else "killed"
            results.append({**{k: m[k] for k in ("id", "visibility", "file", "line", "kind", "before", "after")},
                            "status": status, "killed_by": fi.failing_tests("backend", out) if status == "killed" else [],
                            "seconds": round(secs, 1)})
            print(f"{m['id']} {m['visibility']:8} {status:8} {m['file']}:{m['line']} {m['kind']}", flush=True)
    finally:
        fi.remove_copy(tmp)

    summary = {"seed": SEED, "population": population, "sampled": len(results)}
    for vis in ("visible", "held-out", "all"):
        rows = [r for r in results if vis == "all" or r["visibility"] == vis]
        killed = sum(r["status"] != "survived" for r in rows)
        summary[vis] = {"killed": killed, "total": len(rows), "score": round(100 * killed / len(rows), 1) if rows else None}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "mutation-ast.json").write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    lines = ["| ID | Set | Location | Operator | Original → Mutant | Result | Detected by |", "|---|---|---|---|---|---|---|"]
    esc = lambda s: s.replace("|", "\\|")  # noqa: E731
    for r in results:
        lines.append(f"| {r['id']} | {r['visibility']} | {r['file'].removeprefix('backend/')}:{r['line']} | {r['kind']} | "
                     f"`{esc(r['before'])}` → `{esc(r['after'])}` | {r['status']} | {'<br>'.join(r['killed_by'][:2])} |")
    lines.append("")
    for k in ("visible", "held-out", "all"):
        v = summary[k]
        lines.append(f"- **{k}**: {v['killed']}/{v['total']} killed ({v['score']}%)")
    (args.out / "mutation-ast.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    sys.exit(main())
