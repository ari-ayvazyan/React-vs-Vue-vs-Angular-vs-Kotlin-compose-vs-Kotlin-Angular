"""Growth charts (static PNGs). Validated categorical slots 1-5 (adjacent pairs pass);
three slots are below 3:1 contrast, so every line carries a direct end label and a distinct marker shape."""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SURFACE, INK, INK2, MUTED, AXIS, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#c3c2b7", "#ecebe7"
APPS = ["nuxt", "next", "angular", "angular-kotlin", "kotlin"]
NAME = {"nuxt": "Nuxt/Vue", "next": "Next.js/React", "angular": "Angular", "angular-kotlin": "Angular + Kotlin", "kotlin": "Kotlin Compose"}
COL = {"nuxt": "#2a78d6", "next": "#eb6834", "angular": "#1baf7a", "angular-kotlin": "#eda100", "kotlin": "#e87ba4"}
MARK = {"nuxt": "o", "next": "s", "angular": "^", "angular-kotlin": "D", "kotlin": "v"}
OUT = "results/growth/charts/"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10.5, "text.color": INK, "axes.labelcolor": INK2,
                     "xtick.color": MUTED, "ytick.color": MUTED, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE})
rows = json.load(open("results/growth/growth-summary.json"))
series = lambda app, key: [(r["iter"], float("nan") if r[key] is None else r[key]) for r in sorted((r for r in rows if r["app"] == app), key=lambda r: r["iter"])]


def panel(ax, key, title, fmt=lambda v: f"{v:,.0f}", start=0):
    ends = []
    for a in APPS:
        pts = [(x, y) for x, y in series(a, key) if x >= start]
        if not pts:
            continue
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color=COL[a], linewidth=2, marker=MARK[a], markersize=6, markeredgecolor=SURFACE, markeredgewidth=1)
        ends.append([ys[-1], ys[-1], a, xs[-1]])
        if key == "agent_min" and any(y != y for y in ys): pass
    # spread end labels so they don't collide
    ends.sort()
    lo, hi = ax.get_ylim(); gap = (hi - lo) * 0.075
    for i in range(1, len(ends)):
        if ends[i][1] - ends[i - 1][1] < gap:
            ends[i][1] = ends[i - 1][1] + gap
    for y, ly, a, x in ends:
        ax.annotate(f"{NAME[a]} {fmt(y)}", xy=(x, y), xytext=(x + 0.18, ly), fontsize=8.5, color=INK, va="center",
                    arrowprops=dict(arrowstyle="-", color=AXIS, lw=0.8) if abs(ly - y) > gap * 0.3 else None)
    ax.set_title(title, loc="left", fontsize=11.5, fontweight="bold", pad=8)
    ax.set_xticks(range(start, 6)); ax.set_xticklabels(["start" if i == 0 else f"R{i}" for i in range(start, 6)])
    ax.set_xlim(start - 0.2, 7.6)
    ax.grid(axis="y", color=GRID); ax.set_axisbelow(True)
    for s in ["top", "right", "left"]: ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(AXIS); ax.tick_params(length=0)


import os
os.makedirs(OUT, exist_ok=True)
panels = [("app_loc", "Lines of app code"), ("fn_ccn_gt10", "Functions with complexity > 10"),
          ("fn_over_50", "Functions longer than 50 lines"), ("store_fanin", "Files that use the central store"),
          ("avg_ccn", "Average cyclomatic complexity"), ("tests", "Unit tests")]
fig, axes = plt.subplots(3, 2, figsize=(12, 12.5))
for ax, (k, t) in zip(axes.flat, panels):
    panel(ax, k, t, fmt=(lambda v: f"{v:.2f}") if k == "avg_ccn" else (lambda v: f"{v:,.0f}"))
fig.suptitle("How five codebases grew over five feature requests", x=0.01, ha="left", fontsize=15, fontweight="bold")
fig.text(0.01, 0.955, "Same spec, same requests, same AI model. Start = initial build, R1–R5 = feature requests.", fontsize=10.5, color=INK2)
fig.tight_layout(rect=(0, 0, 1, 0.945), h_pad=3, w_pad=3)
fig.savefig(OUT + "growth-structure.png", dpi=150); plt.close(fig)

# Builder minutes per request (R1-R5); Kotlin R4 omitted (usage-limit interruption, unknown stop time)
fig, ax = plt.subplots(figsize=(11, 4.6))
panel(ax, "agent_min", "Minutes the AI needed per request", fmt=lambda v: f"{v:.0f} min", start=1)
ax.text(0.0, -0.17, "R4 for the two Kotlin apps is missing: an account usage limit interrupted them at an unknown time. "
        "R4–R5 for Nuxt/Next/Angular ran with 5 builders sharing 4 CPU cores.", transform=ax.transAxes, fontsize=8.5, color=MUTED)
fig.tight_layout(); fig.savefig(OUT + "builder-minutes.png", dpi=150); plt.close(fig)

# Final performance (quiet run): time to data (gzip) and 5k board
perf = json.load(open("results/growth/final-perf/summary.json"))
fig, axes = plt.subplots(1, 3, figsize=(13, 3.8))
for ax, (title, get, fmt) in zip(axes, [
    ("Time until data shows, mobile (gzip)", lambda p: p["ttd_gzip"] / 1000, lambda v: f"{v:.2f} s"),
    ("Render board, 5,000 cards", lambda p: p["board"]["boardMs"] / 1000, lambda v: f"{v:.1f} s"),
    ("JS heap while on that board", lambda p: p["board"]["heapMB"], lambda v: f"{v:.0f} MB")]):
    vals = [get(perf[a]) for a in APPS]
    y = list(range(len(APPS)))[::-1]
    ax.barh(y, vals, height=0.6, color=[COL[a] for a in APPS], edgecolor=SURFACE, linewidth=2)
    for yi, v in zip(y, vals):
        ax.text(v + max(vals) * 0.02, yi, fmt(v), va="center", fontsize=9.5, color=INK, fontweight="bold" if v == min(vals) else "normal")
    ax.set_yticks(y); ax.set_yticklabels([NAME[a] for a in APPS], color=INK); ax.set_xlim(0, max(vals) * 1.35); ax.set_xticks([])
    for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
    ax.set_title(title, loc="left", fontsize=11, fontweight="bold")
fig.suptitle("After five feature requests (quiet run, lower is better)", x=0.01, ha="left", fontsize=13, fontweight="bold")
fig.tight_layout(rect=(0, 0, 1, 0.9), w_pad=3)
fig.savefig(OUT + "final-perf.png", dpi=150); plt.close(fig)
print("ok")
