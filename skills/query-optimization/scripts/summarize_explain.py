#!/usr/bin/env python3
"""Summarize psql output produced by a build_explain.py script.

Input: the psql output, with marker lines `@@ <pass> <version> <label> <i>`,
each followed by one EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) result.

Prints Markdown tables:
  1. per-statement: planning/execution ms, shared hit/read buffers, scans, rows
  2. totals per pass x version (and per label with --by-label)
  3. old vs new over the kept passes (the first --discard passes are cold)
  4. top exclusive-time plan nodes for chosen statements

Usage:
    summarize_explain.py explain.out [--discard 1] [--by-label] [--top 8] \\
        [--detail new:getStats:0] [--detail-pass 3]

Without --detail, it shows nodes for the slowest old and new statements in the
last pass. Exclusive time is total*loops minus the children's total*loops.
It is approximate for parallel plans and InitPlans.
"""
import argparse
import json
import re
import sys
from collections import OrderedDict, defaultdict

MARK = re.compile(r"^@@ (\d+) (\S+) (\S+) (\d+)\s*$")
INDEX_NODES = {"Index Scan", "Index Only Scan", "Bitmap Index Scan"}


def parse(path):
    blocks, meta, cur = [], [], None
    with open(path) as f:
        for line in f:
            m = MARK.match(line)
            if m:
                cur = {"pass": int(m.group(1)), "ver": m.group(2), "label": m.group(3),
                       "i": int(m.group(4)), "text": []}
                blocks.append(cur)
            elif line.startswith("@@meta"):
                meta.append(line[6:].strip())
            elif cur is not None:
                cur["text"].append(line)
    out = []
    dec = json.JSONDecoder()
    for b in blocks:
        text = "".join(b.pop("text"))
        start = text.find("[")
        if start < 0:
            print("warning: no EXPLAIN JSON after @@ %(pass)s %(ver)s %(label)s %(i)s" % b, file=sys.stderr)
            continue
        data, _ = dec.raw_decode(text[start:])
        b["explain"] = data[0]
        out.append(b)
    return out, meta


def walk(node, depth=0):
    yield node, depth
    for child in node.get("Plans", []) or []:
        yield from walk(child, depth + 1)


def node_total(n):
    return float(n.get("Actual Total Time", 0.0)) * float(n.get("Actual Loops", 0) or 0)


def node_label(n):
    parts = [n.get("Node Type", "?")]
    if n.get("Relation Name"):
        parts.append("on " + n["Relation Name"])
    if n.get("Index Name"):
        parts.append("using " + n["Index Name"])
    if n.get("Subplan Name"):
        parts.append("[" + n["Subplan Name"] + "]")
    return " ".join(parts)


def metrics(b):
    e = b["explain"]
    plan = e["Plan"]
    seq, idx, seq_rels = 0, 0, []
    for n, _ in walk(plan):
        t = n.get("Node Type")
        if t == "Seq Scan":
            seq += 1
            seq_rels.append(n.get("Relation Name", "?"))
        elif t in INDEX_NODES:
            idx += 1
    return {
        "plan_ms": float(e.get("Planning Time", 0.0)),
        "exec_ms": float(e.get("Execution Time", 0.0)),
        "hit": int(plan.get("Shared Hit Blocks", 0)),
        "read": int(plan.get("Shared Read Blocks", 0)),
        "temp": int(plan.get("Temp Read Blocks", 0)) + int(plan.get("Temp Written Blocks", 0)),
        "seq": seq, "idx": idx, "seq_rels": seq_rels,
        "rows": plan.get("Actual Rows", 0),
    }


def top_nodes(b, k):
    rows = []
    for n, depth in walk(b["explain"]["Plan"]):
        total = node_total(n)
        child = sum(node_total(c) for c in n.get("Plans", []) or [])
        rows.append((max(0.0, total - child), total, n.get("Actual Loops", 0),
                     n.get("Actual Rows", 0), depth, node_label(n),
                     n.get("Shared Hit Blocks", 0), n.get("Shared Read Blocks", 0)))
    rows.sort(key=lambda r: r[0], reverse=True)
    return rows[:k]


def fmt(x):
    return "%.3f" % x


def table(headers, rows):
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join("---" for _ in headers) + "|")
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")
    print()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--discard", type=int, default=None, help="cold passes to drop (default 1 if >1 pass)")
    ap.add_argument("--by-label", action="store_true", help="also print totals per label")
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--detail", action="append", default=[], help="VERSION:LABEL:I, repeatable")
    ap.add_argument("--detail-pass", type=int, help="pass for --detail (default: last)")
    a = ap.parse_args()

    blocks, meta = parse(a.input)
    if not blocks:
        sys.exit("no EXPLAIN blocks found in %s" % a.input)
    for m in meta:
        print("_Server: %s_\n" % m)
    for b in blocks:
        b["m"] = metrics(b)
    passes = sorted({b["pass"] for b in blocks})
    discard = a.discard if a.discard is not None else (1 if len(passes) > 1 else 0)
    kept = [p for p in passes if p > passes[0] - 1 + discard]

    print("## Per statement\n")
    table(["pass", "ver", "label", "i", "plan ms", "exec ms", "hit", "read", "temp", "seq", "idx", "rows", "seq scans on"],
          [(b["pass"], b["ver"], b["label"], b["i"], fmt(b["m"]["plan_ms"]), fmt(b["m"]["exec_ms"]),
            b["m"]["hit"], b["m"]["read"], b["m"]["temp"], b["m"]["seq"], b["m"]["idx"], b["m"]["rows"],
            ",".join(b["m"]["seq_rels"]) or "-") for b in blocks])

    def totals(keyf):
        agg = OrderedDict()
        for b in blocks:
            k = keyf(b)
            t = agg.setdefault(k, defaultdict(float))
            t["n"] += 1
            for f in ("plan_ms", "exec_ms", "hit", "read", "temp", "seq", "idx"):
                t[f] += b["m"][f]
        return agg

    print("## Totals per pass and version\n")
    tot = totals(lambda b: (b["pass"], b["ver"]))
    table(["pass", "ver", "stmts", "plan ms", "exec ms", "hit", "read", "temp", "seq", "idx"],
          [(p, v, int(t["n"]), fmt(t["plan_ms"]), fmt(t["exec_ms"]), int(t["hit"]), int(t["read"]),
            int(t["temp"]), int(t["seq"]), int(t["idx"])) for (p, v), t in tot.items()])

    if a.by_label:
        print("## Totals per pass, version and label\n")
        tl = totals(lambda b: (b["pass"], b["ver"], b["label"]))
        table(["pass", "ver", "label", "stmts", "plan ms", "exec ms", "hit", "read"],
              [(p, v, l, int(t["n"]), fmt(t["plan_ms"]), fmt(t["exec_ms"]), int(t["hit"]), int(t["read"]))
               for (p, v, l), t in tl.items()])

    if kept:
        print("## Old vs new, mean over kept passes %s (discarded %d cold)\n" % (kept, discard))
        rows, means = [], {}
        for v in ("old", "new"):
            ts = [tot[(p, v)] for p in kept if (p, v) in tot]
            if not ts:
                continue
            means[v] = {f: sum(t[f] for t in ts) / len(ts) for f in ("n", "plan_ms", "exec_ms", "hit", "read")}
        for v, m in means.items():
            rows.append((v, int(m["n"]), fmt(m["plan_ms"]), fmt(m["exec_ms"]),
                         fmt(m["plan_ms"] + m["exec_ms"]), int(m["hit"]), int(m["read"])))
        if "old" in means and "new" in means:
            o, n = means["old"], means["new"]
            rows.append(("delta", int(n["n"] - o["n"]), fmt(n["plan_ms"] - o["plan_ms"]),
                         fmt(n["exec_ms"] - o["exec_ms"]),
                         fmt(n["plan_ms"] + n["exec_ms"] - o["plan_ms"] - o["exec_ms"]),
                         int(n["hit"] - o["hit"]), int(n["read"] - o["read"])))
        table(["ver", "stmts", "plan ms", "exec ms", "plan+exec ms", "hit", "read"], rows)
        print("_EXPLAIN excludes network round trips; deltas under ~1 ms are noise._\n")

    dpass = a.detail_pass or passes[-1]
    targets = []
    if a.detail:
        for d in a.detail:
            try:
                v, l, i = d.rsplit(":", 2)
                targets.append((v, l, int(i)))
            except ValueError:
                sys.exit("--detail must be VERSION:LABEL:I, got %r" % d)
    else:
        for v in ("old", "new"):
            cands = [b for b in blocks if b["pass"] == dpass and b["ver"] == v]
            if cands:
                s = max(cands, key=lambda b: b["m"]["exec_ms"])
                targets.append((v, s["label"], s["i"]))
    for v, l, i in targets:
        match = [b for b in blocks if (b["pass"], b["ver"], b["label"], b["i"]) == (dpass, v, l, i)]
        if not match:
            print("_No statement %s:%s:%d in pass %d._\n" % (v, l, i, dpass))
            continue
        print("## Top %d exclusive-time nodes: pass %d %s %s #%d\n" % (a.top, dpass, v, l, i))
        table(["excl ms", "total ms", "loops", "rows", "depth", "node", "hit", "read"],
              [(fmt(r[0]), fmt(r[1]), r[2], r[3], r[4], r[5], r[6], r[7]) for r in top_nodes(match[0], a.top)])


if __name__ == "__main__":
    main()
