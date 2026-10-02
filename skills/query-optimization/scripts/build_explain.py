#!/usr/bin/env python3
"""Build a read-only psql script that EXPLAINs captured old vs new SQL.

Input files are JSON arrays of captured statements, in execution order:

    [{"label": "getStats", "sql": "select ... where org_id = $1", "params": ["o1"]},
     {"label": "getStats", "sql": "...", "params": [...], "types": ["uuid"]}]

`types` is optional. Use it when PREPARE cannot infer a parameter type
(for example `$1 is null`); it becomes `PREPARE q(uuid, ...)`.
Placeholders must be Postgres-style `$1..$n`. Convert `%s`/`?` first.

Output layout:

    \\set ON_ERROR_STOP 1
    BEGIN READ ONLY;  SET LOCAL statement_timeout = ...;  (aborts if not read-only)
    for each pass: old then new on odd passes, new then old on even passes
        \\echo '@@ <pass> <version> <label> <i>'
        PREPARE qN AS <sql>;
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE qN(<literals>);
        DEALLOCATE qN;
    ROLLBACK;

Usage:
    build_explain.py --old old.json --new new.json [--passes 3] \\
        [--timeout 30s] [--plan-cache-mode auto|force_custom_plan|force_generic_plan] \\
        [--only-label getStats] -o explain.sql

Then run, for example:
    psql -X -v ON_ERROR_STOP=1 -f explain.sql "$URL" > explain.out 2>&1
and summarize with summarize_explain.py.
"""
import argparse
import json
import math
import re
import sys


def quote_text(s):
    return "'" + s.replace("'", "''") + "'"


def array_text(items):
    """Postgres array text format, for example {"a","b",NULL}."""
    out = []
    for v in items:
        if v is None:
            out.append("NULL")
        elif isinstance(v, list):
            out.append(array_text(v))
        elif isinstance(v, bool):
            out.append("true" if v else "false")
        elif isinstance(v, (int, float)):
            out.append(repr(v))
        else:
            s = v if isinstance(v, str) else json.dumps(v)
            out.append('"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"')
    return "{" + ",".join(out) + "}"


def literal(v):
    """Render one bind parameter as a SQL literal.

    Strings stay untyped ('...'), so Postgres coerces them to the type it
    inferred for that parameter during PREPARE (uuid, timestamptz, ...).
    """
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return quote_text(str(v).replace("inf", "Infinity").replace("nan", "NaN"))
        return repr(v)
    if isinstance(v, str):
        return quote_text(v)
    if isinstance(v, list):
        return quote_text(array_text(v))
    if isinstance(v, dict):
        return quote_text(json.dumps(v, separators=(",", ":")))
    raise TypeError("unsupported param type: %r" % type(v))


def load(path, only):
    with open(path) as f:
        stmts = json.load(f)
    if not isinstance(stmts, list):
        sys.exit("%s: expected a JSON array" % path)
    counters = {}
    out = []
    for n, s in enumerate(stmts):
        for key in ("label", "sql"):
            if key not in s:
                sys.exit("%s[%d]: missing %r" % (path, n, key))
        label = re.sub(r"[^\w.:-]+", "_", str(s["label"]).strip()) or "unlabeled"
        if only and label not in only:
            continue
        i = counters.get(label, 0)
        counters[label] = i + 1
        sql = s["sql"].strip().rstrip(";").strip()
        if re.search(r"(?<!%)%s|%\(\w+\)s", sql):
            print("warning: %s[%d]: looks like DBAPI placeholders (%%s); convert to $1..$n"
                  % (path, n), file=sys.stderr)
        out.append({"label": label, "i": i, "sql": sql,
                    "params": s.get("params") or [], "types": s.get("types")})
    return out


def emit(stmt, pass_no, version, seq):
    name = "q_%d_%s_%d" % (pass_no, version, seq)
    types = ""
    if stmt["types"]:
        types = "(" + ", ".join(stmt["types"]) + ")"
    args = ""
    if stmt["params"]:
        args = "(" + ", ".join(literal(p) for p in stmt["params"]) + ")"
    return "\n".join([
        "\\echo '@@ %d %s %s %d'" % (pass_no, version, stmt["label"], stmt["i"]),
        "PREPARE %s%s AS\n%s;" % (name, types, stmt["sql"]),
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE %s%s;" % (name, args),
        "DEALLOCATE %s;" % name,
        "",
    ])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--passes", type=int, default=3, help="default 3; pass 1 is the cold pass")
    ap.add_argument("--timeout", default="30s", help="statement_timeout, default 30s")
    ap.add_argument("--plan-cache-mode", choices=["auto", "force_custom_plan", "force_generic_plan"],
                    help="set to force_generic_plan to mimic a driver that reuses prepared statements")
    ap.add_argument("--only-label", action="append", help="repeatable; restrict to these labels")
    ap.add_argument("-o", "--output", default="-")
    a = ap.parse_args()
    if a.passes < 1:
        sys.exit("--passes must be >= 1")

    versions = {"old": load(a.old, a.only_label), "new": load(a.new, a.only_label)}
    lines = [
        "-- generated by build_explain.py; read-only, rolled back",
        "\\set ON_ERROR_STOP 1",
        "\\set QUIET 1",
        "\\pset pager off",
        "\\pset format unaligned",
        "\\pset tuples_only on",
        "BEGIN READ ONLY;",
        "SET LOCAL statement_timeout = %s;" % quote_text(a.timeout),
    ]
    if a.plan_cache_mode:
        lines.append("SET LOCAL plan_cache_mode = %s;" % a.plan_cache_mode)
    lines += [
        "SELECT current_setting('transaction_read_only') = 'on' AS qo_is_ro \\gset",
        "\\if :qo_is_ro",
        "\\else",
        "  \\echo 'ABORT: transaction is not read-only'",
        "  \\quit",
        "\\endif",
        "SELECT '@@meta ' || version();",
        "",
    ]
    seq = 0
    for p in range(1, a.passes + 1):
        order = ["old", "new"] if p % 2 == 1 else ["new", "old"]
        lines.append("-- pass %d: %s" % (p, " then ".join(order)))
        for v in order:
            for stmt in versions[v]:
                seq += 1
                lines.append(emit(stmt, p, v, seq))
    lines.append("ROLLBACK;")
    text = "\n".join(lines) + "\n"
    if a.output == "-":
        sys.stdout.write(text)
    else:
        with open(a.output, "w") as f:
            f.write(text)
        print("wrote %s (%d old, %d new statements x %d passes)" % (
            a.output, len(versions["old"]), len(versions["new"]), a.passes), file=sys.stderr)


if __name__ == "__main__":
    main()
