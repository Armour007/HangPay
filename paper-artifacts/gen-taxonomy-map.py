#!/usr/bin/env python3
"""Generate taxonomy-map-v2.pdf: attack categories by defense layer vs bypass rate.
Redesigned as a horizontal dumbbell/range plot."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# Category data: (label, description, defense_layer, bypass_low, bypass_high)
# defense_layer: 0=L1-dominated, 1=L2-dominated, 2=architectural gap
categories = [
    ("A", "Direct injection",         1, 8, 45),
    ("B", "Vendor mismatch",          1, 3, 21),
    ("C", "Category drift",           0, 9, 9),
    ("D", "JSON injection",           1, 0, 56),
    ("E", "Amount manipulation",      1, 27, 96),
    ("F", "Trust escalation",         2, 81, 94),
    ("G", "Page-content injection",   2, 69, 74),
    ("H", "TOCTOU redirect",          1, 37, 69),
    ("I", "Anomalous amount",         1, 3, 17),
    ("J", "Hallucination loop",       0, 0, 0),
    ("K", "Commerce-adjacent",        1, 0, 22),
]

layer_labels = ["L1-dominated", "L2-dominated", "Architectural Blindspot"]
layer_colors = ["#2196F3", "#FF9800", "#E53935"]

# Sort categories: first by defense layer, then by high bypass rate
categories_sorted = sorted(categories, key=lambda x: (x[2], x[4], x[3]))

# Create figure
fig, ax = plt.subplots(figsize=(10, 4.0))

y_positions = range(len(categories_sorted))
y_labels = []

for i, (cat_label, desc, layer, bp_low, bp_high) in enumerate(categories_sorted):
    color = layer_colors[layer]
    y_labels.append(f"{cat_label}: {desc}")
    
    # Draw line connecting low to high
    if bp_low != bp_high:
        ax.plot([bp_low, bp_high], [i, i], color=color, linewidth=4, alpha=0.6, zorder=1)
        ax.plot(bp_low, i, "o", color=color, markersize=8, zorder=2)
        ax.plot(bp_high, i, "o", color=color, markersize=8, zorder=2)
        
        # Add small text labels for the exact % values
        ax.text(bp_low - 1.5, i, f"{bp_low}%", va='center', ha='right', fontsize=8, color='gray')
        ax.text(bp_high + 1.5, i, f"{bp_high}%", va='center', ha='left', fontsize=8, color='gray')
    else:
        # Just a single point if low == high
        ax.plot(bp_low, i, "D", color=color, markersize=8, zorder=2)
        ax.text(bp_low + 1.5, i, f"{bp_low}%", va='center', ha='left', fontsize=8, color='gray')

# X-axis
ax.set_xlim(-8, 108)
ax.set_xticks(range(0, 101, 10))
ax.set_xlabel("Hybrid bypass rate range across 9 models (%)", fontsize=11, fontweight='bold')

# Y-axis
ax.set_yticks(y_positions)
ax.set_yticklabels(y_labels, fontsize=10, fontweight='medium')
ax.invert_yaxis()  # Put layer 0 at top

# Grid
ax.xaxis.grid(True, linestyle="--", alpha=0.7)
ax.yaxis.grid(True, linestyle=":", alpha=0.3)
ax.set_axisbelow(True)

# Spines
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_visible(False)
ax.tick_params(axis='y', length=0)

# Legend
legend_elements = [
    mpatches.Patch(facecolor=layer_colors[0], label="L1-dominated (deterministic rules drive outcome)"),
    mpatches.Patch(facecolor=layer_colors[1], label="L2-dominated (LLM judgment drives outcome)"),
    mpatches.Patch(facecolor=layer_colors[2], label="Architectural Blindspot (signal not available to LLM)"),
]
ax.legend(handles=legend_elements, loc="upper right", fontsize=9, framealpha=0.9, title="Primary Defense Layer")

plt.tight_layout()
from pathlib import Path
SCRIPT_DIR = Path(__file__).resolve().parent
OUT_PATH = SCRIPT_DIR / "taxonomy-map.pdf"
plt.savefig(str(OUT_PATH), bbox_inches="tight", dpi=300)
print(f"Saved {OUT_PATH}")
