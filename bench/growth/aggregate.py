"""Collect growth-experiment results (iterations 0-5, five apps) into one JSON + CSV.
Usage: python3 growth/aggregate.py  (run from bench/)"""
import csv, glob, json, os, re

R = "results/growth"
APPS = ["nuxt", "next", "angular", "angular-kotlin", "kotlin"]
stats = json.load(open(f"{R}/agent-stats.json"))["iterations"]


def load(path, default=None):
    try:
        return json.load(open(path))
    except Exception:
        return default


def churn(path):
    files = added = removed = 0
    if not os.path.exists(path):
        return None
    for line in open(path):
        parts = line.split("\t")
        if len(parts) != 3 or parts[0] == "-":
            continue
        if re.search(r"\.md$|lock|package\.json|tests?/|Test|\.spec\.|\.test\.|jsTest", parts[2]):
            continue
        files += 1; added += int(parts[0]); removed += int(parts[1])
    return {"files": files, "added": added, "removed": removed}


store = {l.split()[0]: [int(x) for x in l.split()[1:]] for l in open(f"{R}/store-fanin.txt")}
rows = []
for a in APPS:
    for n in range(6):
        d = f"{R}/iter-{n}/{a}"
        if not os.path.isdir(d):
            continue
        loc = load(f"{d}/loc.json", {}).get("totals", {})
        st = load(f"{d}/structure.json", {})
        cx = load(f"{d}/complexity.json", {})
        q = load(f"{d}/quality.json", {})
        b = load(f"{d}/bundle.json", {})
        ttd = load(f"{d}/time-to-data.json", {})
        board = load(f"{d}/board.json", {})
        dup = load(f"{d}/jscpd/jscpd-report.json", {}).get("statistics", {}).get("total", {})
        ch = churn(f"{d}/churn.txt")
        ag = stats.get(str(n), {}).get(a, {})
        app_loc = sum(loc.get(k, 0) for k in ("styling", "templates", "logic"))
        rows.append({
            "app": a, "iter": n,
            "app_loc": app_loc, "styling": loc.get("styling"), "templates": loc.get("templates"), "logic": loc.get("logic"),
            "test_loc": loc.get("tests"),
            "files": st.get("files"), "max_file_loc": st.get("fileLoc", {}).get("max"), "files_over_300": st.get("fileLoc", {}).get("over300"),
            "import_edges": st.get("imports", {}).get("edges"), "max_fan_in": st.get("imports", {}).get("maxFanIn"),
            "cycles_files": st.get("imports", {}).get("filesInCycles"), "store_fanin": store[a][n],
            "functions": cx.get("functions"), "avg_ccn": cx.get("avg_ccn"), "fn_ccn_gt10": cx.get("fn_ccn_gt10"),
            "fn_ccn_gt20": cx.get("fn_ccn_gt20"), "avg_fn_nloc": cx.get("avg_fn_nloc"), "fn_over_50": cx.get("fn_over_50_lines"),
            "dup_pct": dup.get("percentage"),
            "tests": ag.get("tests", q.get("tests_passed")), "lint_ok": q.get("lint_rc") == 0, "test_ok": q.get("test_rc") == 0, "build_ok": q.get("build_rc") == 0,
            "build_s": round(float(q.get("build_s", 0)), 1) if q else None, "js_gz_kb": b.get("js_gz_kb"),
            "ttd_ms": ttd.get("dataVisibleMs"), "board_ms": board.get("boardMs"), "board_heap_mb": board.get("heapMB"),
            "churn_files": ch and ch["files"], "churn_added": ch and ch["added"], "churn_removed": ch and ch["removed"],
            "agent_min": round(ag["duration_s"] / 60, 1) if "duration_s" in ag else None,
            "agent_tool_uses": ag.get("tool_uses"),
            "agent_note": ag.get("note", ""),
        })

json.dump(rows, open(f"{R}/growth-summary.json", "w"), indent=1)
with open(f"{R}/growth-summary.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)
print(len(rows), "rows")
for a in APPS:
    first = next(r for r in rows if r["app"] == a and r["iter"] == 0)
    last = max((r for r in rows if r["app"] == a), key=lambda r: r["iter"])
    print(f"{a:15} loc {first['app_loc']}->{last['app_loc']} ccn {first['avg_ccn']}->{last['avg_ccn']} gt10 {first['fn_ccn_gt10']}->{last['fn_ccn_gt10']} "
          f"over50 {first['fn_over_50']}->{last['fn_over_50']} fanin {first['max_fan_in']}->{last['max_fan_in']} dup {first['dup_pct']}->{last['dup_pct']} tests {first['tests']}->{last['tests']}")
