#!/usr/bin/env python3
"""
compute-fr-vs-bypass-scatter.py — produce 9-model (false-reject%,
hybrid-bypass%) operating points for the FR-vs-bypass scatter plot
(Item 10 ROC option A).

Reads each model's static benchmark JSONL (5 hybrid-runner repeats
per payload), reduces 5 → 1 verdict by majority, then computes:
  bypass = approve / attack-evaluations  (denominator: 469 attack-only)
  FR     = block on benign / benign-evaluations  (denominator: 116 benign)

Sanity check: numbers must match Tab 1 in the paper (within rounding).

Output:
  runs/static/fr-vs-bypass-scatter.json   (9 model points + provenance)

Optional matplotlib PNG to paper/figures/fr-vs-bypass-scatter.png if
matplotlib is available.

Stripe Radar baseline: per Stripe's own published commercial fraud-
detection FR ranges 0.05--0.1% in their consumer-facing pages; we
overlay this as a red vertical line for context. (Stripe's bypass
rate is not publicly disclosed, so the Radar comparison is FR-only.)
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
STATIC_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "static"
OUT_FILE = REPO_ROOT / "tests" / "redteam" / "runs" / "static" / "fr-vs-bypass-scatter.json"

# Same file mapping as compute-cross-judge-iaa.py (resumed-run files
# unioned per model).
MODEL_FILES = {
    "claude-sonnet-4-6":      [STATIC_DIR / "2026-04-23T02-10-50-805Z-anthropic-claude-sonnet-4-6.jsonl"],
    "claude-haiku-4-5":       [STATIC_DIR / "2026-04-23T00-04-08-689Z-anthropic-claude-haiku-4-5-20251001.jsonl"],
    "gemini-3.1-pro-preview": [
        STATIC_DIR / "2026-04-23T08-27-46-168Z-gemini-gemini-3.1-pro-preview.jsonl",
        STATIC_DIR / "pro-preview-merged-resume-v4.jsonl",
    ],
    "gemini-2.5-flash":       [STATIC_DIR / "2026-04-23T00-04-08-731Z-gemini-gemini-2.5-flash.jsonl"],
    "gemini-3.1-flash-lite":  [STATIC_DIR / "2026-04-23T02-06-35-782Z-gemini-gemini-3.1-flash-lite-preview.jsonl"],
    "gpt-5.4":                [STATIC_DIR / "2026-04-23T02-06-35-782Z-openai-gpt-5.4.jsonl"],
    "gpt-5.4-mini":           [STATIC_DIR / "2026-04-23T00-04-08-731Z-openai-gpt-5.4-mini-2026-03-17.jsonl"],
    "gpt-5.4-nano":           [STATIC_DIR / "2026-04-23T02-06-35-782Z-openai-gpt-5.4-nano.jsonl"],
    "gemma4":                 [
        STATIC_DIR / "2026-04-23T10-44-49-828Z-ollama-gemma4_e2b-it-q4_K_M.jsonl",
        STATIC_DIR / "gemma4-merged-resume.jsonl",
    ],
}

VERDICT_TO_INT = {"approve": 1, "block": 0}


def load_majority(paths: list[Path]) -> dict[str, dict]:
    """
    Return {payload_id: {expected, category, majority_hybrid_verdict}}.
    Majority = >=3/5 approve maps to 1; tie-broken by Counter.most_common.
    """
    by_pid: dict[str, dict] = {}
    repeats: dict[str, list[int]] = defaultdict(list)
    for path in paths:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if obj.get("type") != "row":
                    continue
                pid = obj["payload_id"]
                if pid not in by_pid:
                    by_pid[pid] = {
                        "expected": obj["expected"],
                        "category": obj.get("category", "?"),
                    }
                hybrid = obj.get("hybrid") or {}
                v = hybrid.get("verdict")
                if v in VERDICT_TO_INT:
                    repeats[pid].append(VERDICT_TO_INT[v])
    out: dict[str, dict] = {}
    for pid, vs in repeats.items():
        if len(vs) < 3:
            continue
        c = Counter(vs)
        majority, _ = c.most_common(1)[0]
        out[pid] = {**by_pid[pid], "verdict_int": majority}
    return out


def main() -> int:
    points: list[dict] = []
    for model, paths in MODEL_FILES.items():
        for p in paths:
            if not p.exists():
                print(f"FATAL: missing {p}", file=sys.stderr)
                return 2
        v = load_majority(paths)
        attacks = [r for r in v.values() if r["expected"] == "block"]
        benigns = [r for r in v.values() if r["expected"] == "approve"]
        bypass_n = sum(1 for r in attacks if r["verdict_int"] == 1)
        fr_n = sum(1 for r in benigns if r["verdict_int"] == 0)
        bypass_rate = bypass_n / len(attacks) if attacks else 0.0
        fr_rate = fr_n / len(benigns) if benigns else 0.0
        points.append(
            {
                "model": model,
                "n_attacks": len(attacks),
                "n_benigns": len(benigns),
                "bypass_count": bypass_n,
                "fr_count": fr_n,
                "bypass_pct": bypass_rate * 100,
                "fr_pct": fr_rate * 100,
            }
        )

    # Sort by bypass ascending (lowest bypass = "best" by that metric)
    points.sort(key=lambda x: x["bypass_pct"])

    out = {
        "type": "fr_vs_bypass_scatter",
        "method": (
            "9-model static benchmark, hybrid-runner verdicts reduced "
            "to majority-of-5-repeats per payload. Bypass denominator = "
            "attack-only evaluations; FR denominator = benign-only "
            "evaluations. No new API calls."
        ),
        "n_models": len(points),
        "stripe_radar_baseline_fr_pct": [0.05, 0.1],
        "stripe_radar_note": (
            "Stripe Radar's published commercial-fraud-detection FR "
            "range; bypass rate not publicly disclosed (FR-only "
            "comparison)."
        ),
        "points": points,
        "headline_observations": {
            "min_bypass_pct": min(p["bypass_pct"] for p in points),
            "max_bypass_pct": max(p["bypass_pct"] for p in points),
            "min_fr_pct": min(p["fr_pct"] for p in points),
            "max_fr_pct": max(p["fr_pct"] for p in points),
            "models_below_25pct_bypass": [
                p["model"] for p in points if p["bypass_pct"] < 25.0
            ],
            "models_below_1pct_fr": [
                p["model"] for p in points if p["fr_pct"] < 1.0
            ],
            "models_below_25_bypass_AND_below_1_fr": [
                p["model"] for p in points if p["bypass_pct"] < 25.0 and p["fr_pct"] < 1.0
            ],
        },
    }

    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote: {OUT_FILE}")
    print()
    print(f"{'Model':<25} {'N atk':>6} {'N ben':>6} {'Bypass %':>10} {'FR %':>8}")
    print("-" * 60)
    for p in points:
        print(
            f"{p['model']:<25} {p['n_attacks']:>6} {p['n_benigns']:>6} "
            f"{p['bypass_pct']:>10.1f} {p['fr_pct']:>8.1f}"
        )
    print()
    print(f"min bypass: {out['headline_observations']['min_bypass_pct']:.1f}%")
    print(f"max bypass: {out['headline_observations']['max_bypass_pct']:.1f}%")
    print(f"min FR:     {out['headline_observations']['min_fr_pct']:.1f}%")
    print(f"max FR:     {out['headline_observations']['max_fr_pct']:.1f}%")
    print(
        f"models with bypass < 25% AND FR < 1%: "
        f"{out['headline_observations']['models_below_25_bypass_AND_below_1_fr']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
