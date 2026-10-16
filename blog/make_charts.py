"""Charts: all five variants, as first built (before any feature requests).
Static PNGs. Palette: validated reference categorical slots 1-5
(adjacent pairs pass); slots 3-5 are below 3:1 contrast on the light surface, so every bar carries a direct value label."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SURFACE, INK, INK2, MUTED, AXIS, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#c3c2b7", "#ecebe7"
FW = ["Nuxt/Vue", "Next.js/React", "Angular", "Angular + Kotlin", "Kotlin only"]
COL = dict(zip(FW, ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]))
OUT = "/home/user/aa_empty_claude_agent/blog/images/"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "text.color": INK, "axes.labelcolor": INK2,
                     "xtick.color": MUTED, "ytick.color": INK, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE})


def hbars(ax, labels, values, fmt, best=None, hatch=()):
    y = list(range(len(labels)))[::-1]
    ax.barh(y, values, height=0.6, color=[COL.get(l.split(",")[0].replace("…", "").strip(), COL.get(l, "#2a78d6")) for l in labels],
            edgecolor=SURFACE, linewidth=2)
    for i in hatch:
        ax.barh([y[i]], [values[i]], height=0.6, color="none", edgecolor=SURFACE, hatch="///", linewidth=0)
    vmax = max(values)
    for yi, v in zip(y, values):
        ax.text(v + vmax * 0.02, yi, fmt(v), va="center", ha="left", fontsize=10.5, color=INK, fontweight="bold" if v == best else "normal")
    ax.set_yticks(y); ax.set_yticklabels(labels)
    ax.set_xlim(0, vmax * 1.35); ax.set_xticks([])
    for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(AXIS); ax.tick_params(axis="y", length=0)


# 1. Scorecard: all five, as first built
panels = [
    ([28.2, 39.6, 28.0, 36.3, 39.3], "Build time for the AI (min)", lambda v: f"{v:.0f} min", "Next.js/React includes a restart; the Kotlin builds ran with 5 builders sharing 4 cores", True),
    ([252, 282, 237, 299, 302], "Tokens used by the AI (k)", lambda v: f"{v:.0f}k", None, True),
    ([6312, 7141, 7577, 7031, 5139], "Lines of app code", lambda v: f"{v:,.0f}", "excludes tests, config, lockfiles", True),
    ([124, 223, 142, 172, 286], "Client JavaScript, gzip (KB)", lambda v: f"{v:.0f} KB", None, True),
    ([86, 98, 87, 79, 75], "Mobile Lighthouse, as delivered", lambda v: f"{v:.0f}", "higher is better · Nuxt/Vue, Angular and Angular + Kotlin shipped uncompressed", False),
    ([1.48, 1.53, 1.24, 1.51, 2.21], "Time until data shows, mobile (s)", lambda v: f"{v:.2f} s", "real 4x CPU + slow network, with compression", True),
    ([2.80, 1.04, 1.83, 1.60, 9.80], "Render board, 5,000 cards (s)", lambda v: f"{v:.2f} s", None, True),
    ([87, 31, 50, 49, 118], "Memory while on that board (MB)", lambda v: f"{v:.0f} MB", "JS heap after garbage collection", True),
]
fig, axes = plt.subplots(4, 2, figsize=(12, 14.5))
for ax, (vals, title, fmt, note, low) in zip(axes.flat, panels):
    hbars(ax, FW, vals, fmt, best=min(vals) if low else max(vals))
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=INK, pad=8)
    if note: ax.text(0, -0.85, note, transform=ax.get_yaxis_transform(), fontsize=8.5, color=MUTED, va="top")
fig.suptitle("Same spec, same AI, five stacks", x=0.02, ha="left", fontsize=16, fontweight="bold")
fig.text(0.02, 0.955, "As first built, before any feature requests. Lower is better unless noted. Best value in bold.", fontsize=11, color=INK2)
fig.tight_layout(rect=(0, 0, 1, 0.95), h_pad=3.2, w_pad=3)
fig.savefig(OUT + "scorecard.png", dpi=150); plt.close(fig)

# 2. Lighthouse simulated vs real throttling (dashboard, mobile), FCP and LCP
data = {"First Contentful Paint": ([1.85, 0.91, 1.68, 3.81, 0.76], [1.32, 1.34, 0.73, 0.72, 4.13]),
        "Largest Contentful Paint": ([2.11, 2.30, 1.68, 3.81, 3.24], [4.16, 3.29, 0.73, 0.74, 4.13])}
fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), sharey=True)
for ax, (metric, (sim, real)) in zip(axes, data.items()):
    y = list(range(len(FW)))[::-1]
    for yi, f, s_, r in zip(y, FW, sim, real):
        ax.plot([s_, r], [yi, yi], color=AXIS, linewidth=2, zorder=1)
        ax.scatter([s_], [yi], s=100, facecolor=SURFACE, edgecolor=COL[f], linewidth=2.5, zorder=2)
        ax.scatter([r], [yi], s=100, color=COL[f], edgecolor=SURFACE, linewidth=2, zorder=3)
        ax.text(s_, yi + 0.27, f"{s_:.2f}", ha="center", fontsize=9, color=INK2)
        ax.text(r, yi - 0.42, f"{r:.2f}", ha="center", fontsize=9, color=INK, fontweight="bold")
    ax.set_yticks(y); ax.set_yticklabels(FW); ax.set_ylim(-0.8, len(FW) - 0.4); ax.set_xlim(0, 4.6)
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
fig.savefig(OUT + "lighthouse-sim-vs-real.png", dpi=150); plt.close(fig)

# 3. Rendering 5,000 board cards: the Nuxt experiments next to all five as built
labels = ["Nuxt/Vue, as built", "…NuxtLink → plain <a>", "…and icons inlined", "Next.js/React, as built", "Angular, as built",
          "Angular + Kotlin, as built", "Kotlin only, as built"]
ms = [2.70, 2.09, 1.44, 1.04, 1.83, 1.60, 9.80]; mb = [88, 41, 22, 31, 50, 49, 118]
cols = [COL["Nuxt/Vue"]] * 3 + [COL["Next.js/React"], COL["Angular"], COL["Angular + Kotlin"], COL["Kotlin only"]]
fig, ax = plt.subplots(figsize=(11, 4.9))
y = list(range(len(labels)))[::-1]
ax.barh(y, ms, height=0.6, color=cols, edgecolor=SURFACE, linewidth=2)
for i, (yi, v, m) in enumerate(zip(y, ms, mb)):
    if i in (1, 2): ax.barh([yi], [v], height=0.6, color="none", edgecolor=SURFACE, hatch="///", linewidth=0)
    ax.text(v + 0.12, yi, f"{v:.2f} s · {m} MB", va="center", fontsize=10, color=INK)
ax.set_yticks(y); ax.set_yticklabels(labels); ax.set_xlim(0, 12.5); ax.set_xticks([])
for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.set_title("Rendering 5,000 board cards: time and memory", loc="left", fontsize=14, fontweight="bold")
ax.text(0, -0.85, "Hatched bars are my experiments on the Nuxt/Vue card, not shipped code. Median of 5 runs.", transform=ax.get_yaxis_transform(), fontsize=9, color=MUTED, va="top")
fig.tight_layout(); fig.savefig(OUT + "nuxt-board.png", dpi=150); plt.close(fig)

# 4. Memory after leaving the board
labels = ["Nuxt/Vue", "Next.js/React", "Angular, as built", "Angular, incremental\nhydration off", "Angular + Kotlin, as built", "Kotlin only"]
mb = [8, 31, 45, 7, 44, 14]
cols = [COL["Nuxt/Vue"], COL["Next.js/React"], COL["Angular"], COL["Angular"], COL["Angular + Kotlin"], COL["Kotlin only"]]
notes = ["released", "page kept mounted (hidden)", "51k detached elements", "leak gone", "50k detached elements (same leak)", "released"]
fig, ax = plt.subplots(figsize=(11, 4.4))
y = list(range(len(labels)))[::-1]
ax.barh(y, mb, height=0.6, color=cols, edgecolor=SURFACE, linewidth=2)
ax.barh([y[3]], [mb[3]], height=0.6, color="none", edgecolor=SURFACE, hatch="///", linewidth=0)
for yi, v, n in zip(y, mb, notes):
    ax.text(v + 0.8, yi, f"{v} MB · {n}", va="center", fontsize=10, color=INK)
ax.set_yticks(y); ax.set_yticklabels(labels); ax.set_xlim(0, 80); ax.set_xticks([])
for s in ["top", "right", "bottom"]: ax.spines[s].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.set_title("JS heap after leaving the 5,000-card board (after GC)", loc="left", fontsize=14, fontweight="bold")
fig.tight_layout(); fig.savefig(OUT + "memory-after-board.png", dpi=150); plt.close(fig)

# 5. Lines of code split
style = [2728, 2731, 2666, 2156, 593]; rest = [3584, 4410, 4911, 4875, 4546]
fig, ax = plt.subplots(figsize=(11, 4.0))
y = list(range(len(FW)))[::-1]
ax.barh(y, style, height=0.6, color="#b8d1f0", edgecolor=SURFACE, linewidth=2, label="Styling")
ax.barh(y, rest, left=style, height=0.6, color="#2a5fa8", edgecolor=SURFACE, linewidth=2, label="Templates + logic")
for yi, s_, r in zip(y, style, rest):
    ax.text(s_ / 2, yi, f"{s_:,}", ha="center", va="center", fontsize=9.5, color=INK)
    ax.text(s_ + r / 2, yi, f"{r:,}", ha="center", va="center", fontsize=9.5, color="#ffffff")
    ax.text(s_ + r + 120, yi, f"{s_ + r:,}", va="center", fontsize=10.5, color=INK, fontweight="bold")
ax.set_yticks(y); ax.set_yticklabels(FW); ax.set_xlim(0, 8600); ax.set_xticks([])
for sp in ["top", "right", "bottom"]: ax.spines[sp].set_visible(False)
ax.spines["left"].set_color(AXIS); ax.tick_params(length=0)
ax.legend(loc="lower right", frameon=False, ncol=2, fontsize=10, bbox_to_anchor=(1, 1.0))
ax.set_title("Lines of app code, as first built (non-blank, non-comment)", loc="left", fontsize=14, fontweight="bold")
ax.text(0, -0.7, "React and Compose HTML put markup in code (JSX / Kotlin), so their templates count as logic.", transform=ax.get_yaxis_transform(), fontsize=9, color=MUTED, va="top")
fig.tight_layout(); fig.savefig(OUT + "lines-of-code.png", dpi=150); plt.close(fig)
print("ok")
