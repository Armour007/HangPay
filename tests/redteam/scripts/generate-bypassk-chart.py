#!/usr/bin/env python3
"""
Generate Bypass@K cumulative curve chart for NeurIPS paper.

Reads adaptive/ JSONL files for all 9 models, computes cumulative bypass
rate at each K step, and outputs a publication-quality PDF figure.

Usage: python3 tests/redteam/scripts/generate-bypassk-chart.py
"""

import json
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

# ── Paths ────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
ADAPTIVE_DIR = SCRIPT_DIR.parent / "runs" / "adaptive"
OUTPUT_PDF = Path(__file__).resolve().parents[4] / "paper" / "figures" / "bypassk-curve.pdf"

# ── Adaptive file mapping (latest complete run per model) ────────
ADAPTIVE_FILES = {
    "claude-sonnet-4-6":      "2026-04-24T00-33-09-554Z-anthropic_claude-sonnet-4-6.jsonl",
    "gemini-3.1-pro":         "2026-04-24T03-44-11-465Z-gemini_gemini-3.1-pro-preview.jsonl",
    "gemini-2.5-flash":       "2026-04-24T01-51-49-083Z-gemini_gemini-2.5-flash.jsonl",
    "claude-haiku-4-5":       "2026-04-23T23-41-26-025Z-anthropic_claude-haiku-4-5-20251001.jsonl",
    "gemini-3.1-flash-lite":  "2026-04-24T02-56-13-944Z-gemini_gemini-3.1-flash-lite-preview.jsonl",
    "gpt-5.4-mini":           "2026-04-23T23-41-31-131Z-openai_gpt-5.4-mini-2026-03-17.jsonl",
    "gpt-5.4":                "2026-04-24T01-03-50-917Z-openai_gpt-5.4.jsonl",
    "gpt-5.4-nano":           "2026-04-24T00-26-17-908Z-openai_gpt-5.4-nano.jsonl",
    "gemma4 (local)":         "2026-04-24T04-57-07-714Z-ollama_gemma4_e2b-it-q4_K_M.jsonl",
}

# ── Style mapping ────────────────────────────────────────────────
MODEL_STYLES = {
    "claude-sonnet-4-6":      {"color": "#6B4C9A", "marker": "o",  "ls": "-"},
    "gemini-3.1-pro":         {"color": "#1A73E8", "marker": "s",  "ls": "-"},
    "gemini-2.5-flash":       {"color": "#4285F4", "marker": "D",  "ls": "--"},
    "claude-haiku-4-5":       {"color": "#9B59B6", "marker": "^",  "ls": "--"},
    "gemini-3.1-flash-lite":  {"color": "#34A853", "marker": "v",  "ls": "-."},
    "gpt-5.4-mini":           {"color": "#E74C3C", "marker": "<",  "ls": "-."},
    "gpt-5.4":                {"color": "#C0392B", "marker": ">",  "ls": "-"},
    "gpt-5.4-nano":           {"color": "#F39C12", "marker": "P",  "ls": ":"},
    "gemma4 (local)":         {"color": "#7F8C8D", "marker": "X",  "ls": ":"},
}


def load_adaptive(filepath: str) -> dict:
    """Load adaptive JSONL, return {payload_id: bypass_at_k} where bypass_at_k is int or None."""
    results = {}
    with open(filepath) as f:
        for line in f:
            row = json.loads(line)
            if row.get("type") != "row":
                continue
            pid = row["payload_id"]
            bypass_at_k = row.get("bypass_at_k")  # int or null
            results[pid] = bypass_at_k
    return results


def compute_cumulative_bypass(data: dict, k_max: int = 5) -> list[float]:
    """Compute cumulative bypass rate at each K step.

    Returns list of rates [K<=1, K<=2, ..., K<=k_max] as percentages.
    """
    total = len(data)
    if total == 0:
        return [0.0] * k_max

    rates = []
    for k in range(1, k_max + 1):
        bypassed = sum(1 for v in data.values() if v is not None and v <= k)
        rates.append(bypassed / total * 100)
    return rates


def main():
    k_values = list(range(1, 6))

    # Collect data
    model_curves = {}
    for label, filename in ADAPTIVE_FILES.items():
        filepath = ADAPTIVE_DIR / filename
        if not filepath.exists():
            print(f"WARNING: {filepath} not found, skipping {label}")
            continue
        data = load_adaptive(str(filepath))
        curve = compute_cumulative_bypass(data)
        model_curves[label] = curve
        print(f"{label:30s}  K<=1={curve[0]:5.1f}%  K<=5={curve[4]:5.1f}%  (n={len(data)})")

    # ── Plot ──────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(7, 4.5))

    # Sort models by Bypass@5 ascending (best = lowest)
    sorted_models = sorted(model_curves.items(), key=lambda x: x[1][-1])

    for label, curve in sorted_models:
        style = MODEL_STYLES[label]
        ax.plot(
            k_values, curve,
            color=style["color"],
            marker=style["marker"],
            linestyle=style["ls"],
            linewidth=1.8,
            markersize=6,
            label=label,
            zorder=3,
        )

    # Formatting
    ax.set_xlabel("K (rewrite steps)", fontsize=11)
    ax.set_ylabel("Cumulative Bypass Rate (%)", fontsize=11)
    ax.set_xticks(k_values)
    ax.set_xticklabels([f"K={k}" for k in k_values])
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f%%"))
    ax.set_ylim(0, 100)
    ax.set_xlim(0.8, 5.2)

    # Grid
    ax.grid(True, alpha=0.3, linestyle="--")
    ax.set_axisbelow(True)

    # Legend outside right
    ax.legend(
        fontsize=8,
        loc="center left",
        bbox_to_anchor=(1.02, 0.5),
        frameon=True,
        framealpha=0.9,
        edgecolor="#cccccc",
    )

    # Annotation: highlight K=1->K=2 gain
    ax.annotate(
        "+20\u201326pp",
        xy=(1.5, 55),
        fontsize=8,
        color="#555555",
        ha="center",
        style="italic",
    )

    plt.tight_layout()
    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(OUTPUT_PDF), bbox_inches="tight", dpi=300)
    print(f"\nChart saved to {OUTPUT_PDF}")
    plt.close()


if __name__ == "__main__":
    main()
