"""Cyclomatic complexity with lizard. Vue <script> blocks are extracted first; .tsx included.
Usage: python3 growth/complexity.py <structure.json> <app_dir> <out.json>"""
import json, os, subprocess, sys, tempfile, csv, io, re
struct, app, out = sys.argv[1], os.path.abspath(sys.argv[2]), sys.argv[3]
files = json.load(open(struct))["fileList"]
tmp = tempfile.mkdtemp()
for f in files:
    if not f.endswith((".ts", ".tsx", ".vue", ".js", ".mjs", ".kt")):
        continue
    text = open(os.path.join(app, f), encoding="utf8").read()
    if f.endswith(".vue"):
        text = "\n".join(re.findall(r"<script\b[^>]*>([\s\S]*?)</script>", text))
        f += ".ts"
    dst = os.path.join(tmp, f)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, "w", encoding="utf8").write(text)
res = subprocess.run([sys.executable, "-m", "lizard", tmp, "-l", "typescript", "-l", "tsx", "-l", "javascript", "-l", "kotlin", "--csv"], capture_output=True, text=True)
rows = [r for r in csv.reader(io.StringIO(res.stdout)) if len(r) > 7]
ccn = [int(r[1]) for r in rows]; nloc = [int(r[0]) for r in rows]
o = dict(functions=len(ccn), avg_ccn=round(sum(ccn) / max(1, len(ccn)), 2), max_ccn=max(ccn or [0]),
         fn_ccn_gt10=sum(c > 10 for c in ccn), fn_ccn_gt15=sum(c > 15 for c in ccn), fn_ccn_gt20=sum(c > 20 for c in ccn),
         avg_fn_nloc=round(sum(nloc) / max(1, len(nloc)), 1), fn_over_50_lines=sum(n > 50 for n in nloc),
         top=sorted([(int(r[1]), r[7], os.path.relpath(r[6], tmp)) for r in rows], reverse=True)[:5])
json.dump(o, open(out, "w"), indent=1)
print(os.path.basename(app), {k: v for k, v in o.items() if k != "top"})
