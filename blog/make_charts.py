"""Charts. Static PNGs.
Palette: validated reference categorical slots 1-3 (all-pairs pass); every bar carries a direct value label
because slot 3 is below 3:1 contrast on the light surface."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SURFACE, INK, INK2, MUTED, AXIS, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#c3c2b7", "#ecebe7"
FW = ["Nuxt/Vue", "Next.js/React", "Angular"]
COL = {"Nuxt/Vue": "#2a78d6", "Next.js/React": "#eb6834", "Angular": "#1baf7a"}
OUT = "/home/user/aa_empty_claude_agent/blog/images/"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "text.color": INK, "axes.labelcolor": INK2,
                     "xtick.color": MUTED, "ytick.color": INK, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE})

def bars(ax, values, title, fmt, note=None, lower_better=True):
    y = range(len(FW))[::-1]
    best = min(values) if lower_better else max(values)
    ax.barh(list(y), values, height=0.56, color=[COL[f] for f in FW], edgecolor=SURFACE, linewidth=2)
    vmax = max(values)
    for yi, v in zip(y, values):
        ax.text(v + vmax * 0.02, yi, fmt(v), va="center", ha="left", fontsize=11,
                color=INK, fontweight="bold" if v == best else "normal")
    ax.set_yticks(list(y)); ax.set_yticklabels(FW)
    ax.set_xlim(0, vmax * 1.32); ax.set_xticks([])
    for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(AXIS)
    ax.tick_params(axis="y", length=0)
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=INK, pad=8)
    if note: ax.text(0, -0.9, note, transform=ax.get_yaxis_transform(), fontsize=9, color=MUTED, va="top")

# 1. Scorecard: what each framework delivered
panels = [
    ([28.2, 39.6, 28.0], "Build time for the AI (min)", lambda v: f"{v:.0f} min", "Next.js includes a container restart"),
    ([252, 282, 237], "Tokens used by the AI (k)", lambda v: f"{v:.0f}k", None),
    ([6312, 7141, 7577], "Lines of app code", lambda v: f"{v:,.0f}", "excludes tests, config, lockfiles"),
    ([124, 223, 142], "Client JavaScript, gzip (KB)", lambda v: f"{v:.0f} KB", None),
    ([86, 98, 87], "Mobile Lighthouse, as delivered", lambda v: f"{v:.0f}", "higher is better · Nuxt/Angular shipped uncompressed"),
    ([1.48, 1.53, 1.24], "Time until data shows, mobile (s)", lambda v: f"{v:.2f} s", "real 4x CPU + slow-network throttling"),
    ([2.80, 1.04, 1.83], "Render board, 5,000 cards (s)", lambda v: f"{v:.2f} s", None),
    ([87, 31, 50], "Memory while on that board (MB)", lambda v: f"{v:.0f} MB", "JS heap after garbage collection"),
]
fig, axes = plt.subplots(4, 2, figsize=(11, 11.5))
for ax, (vals, title, fmt, note) in zip(axes.flat, panels):
    bars(ax, vals, title, fmt, note, lower_better=("Lighthouse" not in title))
fig.suptitle("Same spec, same AI, three frameworks", x=0.02, ha="left", fontsize=16, fontweight="bold")
fig.text(0.02, 0.945, "Lower is better unless noted. Best value in bold.", fontsize=11, color=INK2)
fig.tight_layout(rect=(0, 0, 1, 0.94), h_pad=2.6, w_pad=3)
fig.savefig(OUT + "scorecard.png", dpi=160); plt.close(fig)

# 2. Lighthouse simulated vs real throttling (dashboard, mobile), FCP and LCP
data = {"First Contentful Paint": ([1.85, 0.91, 1.68], [1.32, 1.34, 0.73]),
        "Largest Contentful Paint": ([2.11, 2.30, 1.68], [4.16, 3.29, 0.73])}
fig, axes = plt.subplots(1, 2, figsize=(11, 3.9), sharey=True)
for ax, (metric, (sim, real)) in zip(axes, data.items()):
    y = list(range(3))[::-1]
    for yi, f, s_, r in zip(y, FW, sim, real):
        ax.plot([s_, r], [yi, yi], color=AXIS, linewidth=2, zorder=1)
        ax.scatter([s_], [yi], s=110, facecolor=SURFACE, edgecolor=COL[f], linewidth=2.5, zorder=2)
        ax.scatter([r], [yi], s=110, color=COL[f], edgecolor=SURFACE, linewidth=2, zorder=3)
        off = 0.3
        ax.text(s_, yi + off, f"{s_:.2f}", ha="center", fontsize=10, color=INK2)
        ax.text(r, yi - off - 0.12, f"{r:.2f}", ha="center", fontsize=10, color=INK, fontweight="bold")
    ax.set_yticks(y); ax.set_yticklabels(FW); ax.set_ylim(-0.75, 2.6); ax.set_xlim(0, 4.6)
    ax.set_xlabel("seconds")
    ax.grid(axis="x", color=GRID); ax.set_axisbelow(True)
    for sp in ["top", "right", "left"]: ax.spines[sp].set_visible(False)
    ax.spines["bottom"].set_color(AXIS); ax.tick_params(length=0)
    ax.set_title(metric, loc="left", fontsize=12, fontweight="bold")
axes[1].scatter([], [], s=90, facecolor=SURFACE, edgecolor=INK2, linewidth=2, label="Lighthouse default (simulated)")
axes[1].scatter([], [], s=90, color=INK2, label="Real throttling")
fig.legend(loc="upper right", frameon=False, fontsize=10, ncol=2, bbox_to_anchor=(0.99, 0.93))
fig.suptitle("Mobile dashboard: Lighthouse's estimate vs real throttling", x=0.01, ha="left", fontsize=14, fontweight="bold")
fig.tight_layout(rect=(0, 0, 1, 0.86), w_pad=3)
fig.savefig(OUT + "lighthouse-sim-vs-real.png", dpi=160); plt.close(fig)

# 3. Where the Nuxt board time goes
labels = ["Nuxt/Vue, as built", "…NuxtLink → plain <a>", "…and icons inlined", "Next.js/React, as built", "Angular, as built"]
ms = [2.70, 2.09, 1.44, 1.04, 1.83]; mb = [88, 41, 22, 31, 50]
cols = [COL["Nuxt/Vue"], COL["Nuxt/Vue"], COL["Nuxt/Vue"], COL["Next.js/React"], COL["Angular"]]
fig, ax = plt.subplots(figsize=(10, 3.9))
y = list(range(len(labels)))[::-1]
ax.barh(y, ms, height=0.56, color=cols, edgecolor=SURFACE, linewidth=2)
for i, (yi, v, m) in enumerate(zip(y, ms, mb)):
    if i in (1, 2): ax.barh([yi], [v], height=0.56, color="none", edgecolor=SURFACE, hatch="///", linewidth=0)
    ax.text(v + 0.05, yi, f"{v:.2f} s · {m} MB", va="center", fontsize=10.5, color=INK)
ax.set_yticks(y); ax.set_yticklabels(labels); ax.set_xlim(0, 3.4); ax.set_xticks([])
for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.set_title("Rendering 5,000 board cards: time and memory", loc="left", fontsize=14, fontweight="bold")
ax.text(0, -0.75, "Hatched bars are my experiments, not shipped code. Median of 5 runs.", transform=ax.get_yaxis_transform(), fontsize=9, color=MUTED, va="top")
fig.tight_layout(); fig.savefig(OUT + "nuxt-board.png", dpi=160); plt.close(fig)

# 4. Memory after leaving the board
labels = ["Nuxt/Vue", "Next.js/React", "Angular, as built", "Angular, incremental\nhydration off"]
mb = [8, 31, 45, 7]; cols = [COL["Nuxt/Vue"], COL["Next.js/React"], COL["Angular"], COL["Angular"]]
fig, ax = plt.subplots(figsize=(10, 3.4))
y = list(range(len(labels)))[::-1]
ax.barh(y, mb, height=0.56, color=cols, edgecolor=SURFACE, linewidth=2)
ax.barh([y[3]], [mb[3]], height=0.56, color="none", edgecolor=SURFACE, hatch="///", linewidth=0)
notes = ["released", "page kept mounted (hidden)", "51k detached elements", "leak gone"]
for yi, v, n in zip(y, mb, notes):
    ax.text(v + 0.8, yi, f"{v} MB · {n}", va="center", fontsize=10.5, color=INK)
ax.set_yticks(y); ax.set_yticklabels(labels); ax.set_xlim(0, 75); ax.set_xticks([])
for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.set_title("JS heap after leaving the 5,000-card board (after GC)", loc="left", fontsize=14, fontweight="bold")
fig.tight_layout(); fig.savefig(OUT + "memory-after-board.png", dpi=160); plt.close(fig)

# 5. Lines of code split
style = [2728, 2731, 2666]; rest = [3584, 4410, 4911]
fig, ax = plt.subplots(figsize=(10, 3.2))
y = list(range(3))[::-1]
ax.barh(y, style, height=0.56, color="#b8d1f0", edgecolor=SURFACE, linewidth=2, label="Styling")
ax.barh(y, rest, left=style, height=0.56, color="#2a5fa8", edgecolor=SURFACE, linewidth=2, label="Templates + logic")
for yi, s, r in zip(y, style, rest):
    ax.text(s / 2, yi, f"{s:,}", ha="center", va="center", fontsize=10, color=INK)
    ax.text(s + r / 2, yi, f"{r:,}", ha="center", va="center", fontsize=10, color="#ffffff")
    ax.text(s + r + 120, yi, f"{s + r:,}", va="center", fontsize=11, color=INK, fontweight="bold")
ax.set_yticks(y); ax.set_yticklabels(FW); ax.set_xlim(0, 8600); ax.set_xticks([])
for sp in ["top", "right", "bottom"]: ax.spines[sp].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.legend(loc="lower right", frameon=False, ncol=2, fontsize=10, bbox_to_anchor=(1, 1.0))
ax.set_title("Lines of app code (non-blank, non-comment)", loc="left", fontsize=14, fontweight="bold")
fig.tight_layout(); fig.savefig(OUT + "lines-of-code.png", dpi=160); plt.close(fig)
print("ok")
