#!/usr/bin/env python3
"""
compute-cross-judge-iaa.py — analytical reanalysis of the 9-model
static benchmark to answer R10's "load-bearing claim" critique:
do model errors correlate (high κ → ranking reflects systematic
capability) or are model errors independent (low κ → ranking is
corpus-cherry-pick noise + family bias)?

NO new API calls. Pure reanalysis of existing static benchmark data.

Per-payload procedure:
  1. For each model, take the 5 hybrid-runner repeats from the
     static JSONL.
  2. Reduce 5 → 1 verdict by majority vote (>=3 of 5 approve = approve;
     >=3 of 5 block = block; tie at 2-2-1 errored shouldn't happen
     but skipped if it does).
  3. Compute, on the resulting (n_payloads x 9_models) verdict matrix:
       - Pairwise Cohen's κ for all 36 model pairs
       - Aggregate Fleiss' κ across 9 raters
       - Per-category Cohen's κ (mean over pairs within cat)
       - Per-category PABAK (prevalence-adjusted κ) for high-prevalence
         categories where Cohen's κ is deflated by class imbalance
       - Mean pairwise κ
       - Min / max pair κ + which models

Interpretation flags emitted in output:
  high_agreement: aggregate Fleiss κ >= 0.6
  mid_agreement:  0.4 <= aggregate Fleiss κ < 0.6
  low_agreement:  aggregate Fleiss κ < 0.4

Output: tests/redteam/runs/cross-judge-iaa.json

Usage:
  python3 tests/redteam/scripts/compute-cross-judge-iaa.py
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
STATIC_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "static"
OUT_FILE = REPO_ROOT / "tests" / "redteam" / "runs" / "cross-judge-iaa.json"

# Model → list of static JSONL files. Multiple files for pro-preview
# and gemma4 because the originals were resumed: the run was paused
# mid-corpus and continued in a separate file. We aggregate verdicts
# across all listed files per model and majority-vote the available
# repeats for the canonical payload set.
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

# Encoding for κ computations: 0 = block, 1 = approve.
VERDICT_TO_INT = {"block": 0, "approve": 1}


def load_majority_hybrid(paths: list[Path]) -> tuple[dict[str, int], dict[str, str]]:
    """
    Return ({payload_id: majority_verdict_0_or_1}, {payload_id: category}).
    Majority across hybrid-runner repeats aggregated from all input
    files (multiple files for resumed runs). Skip payloads where fewer
    than 3 valid (block/approve) verdicts were collected.
    """
    by_pid: dict[str, list[int]] = defaultdict(list)
    cat_map: dict[str, str] = {}
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
                cat_map[pid] = obj.get("category", "?")
                hybrid = obj.get("hybrid") or {}
                v = hybrid.get("verdict")
                if v in VERDICT_TO_INT:
                    by_pid[pid].append(VERDICT_TO_INT[v])
    out: dict[str, int] = {}
    for pid, vs in by_pid.items():
        if len(vs) < 3:
            continue
        c = Counter(vs)
        majority, _ = c.most_common(1)[0]
        out[pid] = majority
    return out, cat_map


def cohens_kappa(a: list[int], b: list[int]) -> float:
    """Cohen's κ on binary labels."""
    if len(a) == 0:
        return float("nan")
    n = len(a)
    a_arr = np.asarray(a)
    b_arr = np.asarray(b)
    po = float((a_arr == b_arr).mean())
    # Per-rater marginals
    pa1 = float(a_arr.mean())
    pb1 = float(b_arr.mean())
    pe = pa1 * pb1 + (1 - pa1) * (1 - pb1)
    if pe == 1.0:
        return 1.0 if po == 1.0 else 0.0
    return (po - pe) / (1 - pe)


def fleiss_kappa(matrix: np.ndarray) -> float:
    """
    Fleiss' κ over N items × k raters with categorical labels.
    `matrix` shape: (N, K) where K = number of categories. Each row
    sums to n (raters per item).
    """
    if matrix.size == 0:
        return float("nan")
    N = matrix.shape[0]
    n = matrix.sum(axis=1).max()  # raters per item
    if n <= 1:
        return float("nan")
    # P_i: agreement on item i
    P_i = (matrix * (matrix - 1)).sum(axis=1) / (n * (n - 1))
    P_bar = float(P_i.mean())
    # P_e: chance agreement
    p_j = matrix.sum(axis=0) / (N * n)
    P_e = float((p_j * p_j).sum())
    if P_e == 1.0:
        return 1.0 if P_bar == 1.0 else 0.0
    return (P_bar - P_e) / (1 - P_e)


def pabak(a: list[int], b: list[int]) -> float:
    """Prevalence-adjusted κ (Byrt et al. 1993): 2 * po − 1."""
    if not a:
        return float("nan")
    a_arr = np.asarray(a)
    b_arr = np.asarray(b)
    po = float((a_arr == b_arr).mean())
    return 2 * po - 1


def main() -> int:
    # Load each model's verdicts.
    model_verdicts: dict[str, dict[str, int]] = {}
    cat_maps: dict[str, dict[str, str]] = {}
    for model, paths in MODEL_FILES.items():
        for p in paths:
            if not p.exists():
                print(f"FATAL: missing {p}", file=sys.stderr)
                return 2
        v, cmap = load_majority_hybrid(paths)
        model_verdicts[model] = v
        cat_maps[model] = cmap
        print(f"  {model}: {len(v)} payloads with majority verdict")

    # Common PIDs across all 9 models.
    common = set.intersection(*(set(v.keys()) for v in model_verdicts.values()))
    print(f"\nCommon payloads (in all 9 models): {len(common)}")

    if len(common) < 100:
        print(
            f"FATAL: only {len(common)} common payloads — alignment broken",
            file=sys.stderr,
        )
        return 2

    sorted_pids = sorted(common)
    cat_map_canonical = {pid: cat_maps["claude-sonnet-4-6"][pid] for pid in sorted_pids}

    # Build N × 9 matrix (encoded 0/1).
    models = list(MODEL_FILES.keys())
    matrix = np.array(
        [[model_verdicts[m][pid] for m in models] for pid in sorted_pids],
        dtype=int,
    )

    # Pairwise Cohen's κ — all 36 unique pairs.
    pairwise: dict[str, float] = {}
    for a, b in combinations(models, 2):
        ai = models.index(a)
        bi = models.index(b)
        k = cohens_kappa(matrix[:, ai].tolist(), matrix[:, bi].tolist())
        pairwise[f"{a}__{b}"] = k

    # Aggregate Fleiss' κ across 9 raters.
    # Build rater-count matrix: for each payload, count how many raters chose each label.
    fleiss_input = np.zeros((len(sorted_pids), 2), dtype=int)
    for i, pid in enumerate(sorted_pids):
        block_count = sum(1 for m in models if model_verdicts[m][pid] == 0)
        approve_count = 9 - block_count
        fleiss_input[i, 0] = block_count
        fleiss_input[i, 1] = approve_count
    fleiss_overall = fleiss_kappa(fleiss_input)

    # Per-category Cohen's κ (mean over the 36 pairs, restricted to that cat).
    per_cat: dict[str, dict] = {}
    cats = sorted({cat_map_canonical[pid] for pid in sorted_pids})
    for cat in cats:
        cat_pids = [pid for pid in sorted_pids if cat_map_canonical[pid] == cat]
        if len(cat_pids) < 5:
            continue
        cat_idx = [sorted_pids.index(p) for p in cat_pids]
        cat_mat = matrix[cat_idx, :]
        # Mean pairwise Cohen's κ within this cat
        ks = []
        pabak_vals = []
        for a, b in combinations(models, 2):
            ai = models.index(a)
            bi = models.index(b)
            ks.append(cohens_kappa(cat_mat[:, ai].tolist(), cat_mat[:, bi].tolist()))
            pabak_vals.append(pabak(cat_mat[:, ai].tolist(), cat_mat[:, bi].tolist()))
        # Fleiss for this cat
        fl_inp = np.zeros((len(cat_pids), 2), dtype=int)
        for i, pid in enumerate(cat_pids):
            block_count = sum(1 for m in models if model_verdicts[m][pid] == 0)
            fl_inp[i, 0] = block_count
            fl_inp[i, 1] = 9 - block_count
        fl = fleiss_kappa(fl_inp)
        # Class prevalence (fraction approve)
        prev = float(matrix[cat_idx, :].mean())
        per_cat[cat] = {
            "n_payloads": len(cat_pids),
            "mean_cohens_kappa": float(np.nanmean(ks)),
            "median_cohens_kappa": float(np.nanmedian(ks)),
            "fleiss_kappa": fl,
            "mean_pabak": float(np.nanmean(pabak_vals)),
            "approve_prevalence": prev,
        }

    # Mean / min / max pairwise
    pw_values = [v for v in pairwise.values() if not np.isnan(v)]
    mean_pw = float(np.mean(pw_values))
    min_pair = min(pairwise.items(), key=lambda x: (x[1] if not np.isnan(x[1]) else 1.0))
    max_pair = max(pairwise.items(), key=lambda x: (x[1] if not np.isnan(x[1]) else -1.0))

    # Interpretation flag
    if fleiss_overall >= 0.6:
        interpretation = "high_agreement"
    elif fleiss_overall >= 0.4:
        interpretation = "mid_agreement"
    else:
        interpretation = "low_agreement"

    out = {
        "type": "cross_judge_iaa",
        "method": (
            "Pure reanalysis of existing 9-model static benchmark data; "
            "no new API calls. For each model, hybrid-runner verdicts "
            "from 5 repeats reduced to majority. Cohen's κ per pair, "
            "Fleiss' κ over 9 raters, PABAK per category."
        ),
        "n_models": len(models),
        "models": models,
        "n_common_payloads": len(common),
        "fleiss_kappa_overall": fleiss_overall,
        "interpretation": interpretation,
        "mean_pairwise_cohens_kappa": mean_pw,
        "min_pair": {"pair": min_pair[0], "kappa": min_pair[1]},
        "max_pair": {"pair": max_pair[0], "kappa": max_pair[1]},
        "pairwise_cohens_kappa": pairwise,
        "per_category": per_cat,
    }
    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"\nwrote: {OUT_FILE}")
    print(f"\nFleiss' κ (9 raters, {len(common)} payloads): {fleiss_overall:.3f}")
    print(f"Interpretation: {interpretation}")
    print(f"Mean pairwise Cohen's κ: {mean_pw:.3f}")
    print(f"Min pair: {min_pair[0]} κ={min_pair[1]:.3f}")
    print(f"Max pair: {max_pair[0]} κ={max_pair[1]:.3f}")
    print()
    print("Per-category Fleiss κ (high-prevalence cats use PABAK):")
    for cat in sorted(per_cat):
        c = per_cat[cat]
        print(
            f"  {cat}: n={c['n_payloads']:>3}  Fleiss κ={c['fleiss_kappa']:>+.3f}  "
            f"mean Cohen κ={c['mean_cohens_kappa']:>+.3f}  "
            f"PABAK={c['mean_pabak']:>+.3f}  prev_approve={c['approve_prevalence']:.2f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
