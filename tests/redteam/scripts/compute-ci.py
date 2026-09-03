#!/usr/bin/env python3
"""
Bootstrap confidence intervals for paper tables.

Produces:
  - Per-cell 95% CI for Bypass@K (PRIMARY whitebox-no-feedback, all 9 models, all K)
  - Per-cell CI for Table 11 (4-cell threat-model ablation on Flash)
  - McNemar paired test for opaque vs informed (per-payload paired)
  - Wilson interval for false-reject rate
  - Per-category Bypass@5 CIs
  - Holm correction annotation for 99-cell ranking

Method: payload-level bootstrap (1000 resamples), 2.5/97.5 percentile method.
"""

import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import binom

ADAPTIVE = Path(__file__).resolve().parent.parent / "runs" / "adaptive"
STATIC = Path(__file__).resolve().parent.parent / "runs" / "static"
N_BOOT = 1000
SEED = 42

# ── Config: file mappings ─────────────────────────────────────────
PRIMARY_FILES = {
    "claude-sonnet-4-6":      "2026-04-28T19-50-38-732Z-anthropic_claude-sonnet-4-6.jsonl",
    "gemini-3.1-pro-preview": "2026-04-28T19-50-46-477Z-gemini_gemini-3.1-pro-preview.jsonl",
    "gemini-2.5-flash":       "2026-04-28T19-50-38-732Z-gemini_gemini-2.5-flash.jsonl",
    "claude-haiku-4-5":       "2026-04-28T19-50-38-732Z-anthropic_claude-haiku-4-5-20251001.jsonl",
    "gemini-3.1-flash-lite":  "2026-04-28T19-50-46-486Z-gemini_gemini-3.1-flash-lite-preview.jsonl",
    "gpt-5.4-mini":           "2026-04-28T19-50-38-732Z-openai_gpt-5.4-mini-2026-03-17.jsonl",
    "gpt-5.4":                "2026-04-28T19-50-38-732Z-openai_gpt-5.4.jsonl",
    "gpt-5.4-nano":           "2026-04-28T19-50-45-057Z-openai_gpt-5.4-nano.jsonl",
    "gemma4":                 "2026-04-28T19-50-46-490Z-ollama_gemma4_e2b-it-q4_K_M.jsonl",
}

FLASH_ABLATION = {
    "PRIMARY (whitebox-no-fb)":          "2026-04-28T19-50-38-732Z-gemini_gemini-2.5-flash.jsonl",
    "Opaque":                             "2026-04-28T03-55-13-994Z-gemini_gemini-2.5-flash.jsonl",
    "Informed (legacy)":                  "2026-04-24T01-51-49-083Z-gemini_gemini-2.5-flash.jsonl",
    "White-box (informed+L2)":            "2026-04-28T04-06-25-381Z-gemini_gemini-2.5-flash.jsonl",
    "PRIMARY + GPT-5.4 attacker":        "2026-04-28T04-06-24-307Z-gemini_gemini-2.5-flash.jsonl",
}


def load_rows(path: Path):
    rows = []
    with open(path) as fh:
        for line in fh:
            try:
                d = json.loads(line)
                if d.get("type") == "row":
                    rows.append(d)
            except json.JSONDecodeError:
                continue
    return rows


def bypass_at_k(rows, k):
    """Number of payloads bypassed within K attempts (0/1 per payload)."""
    return [1 if (r.get("bypass_at_k") is not None and r["bypass_at_k"] <= k) else 0 for r in rows]


def bootstrap_ci(values, n_boot=N_BOOT, seed=SEED):
    """95% percentile CI for the mean of a binary array."""
    rng = np.random.default_rng(seed)
    arr = np.asarray(values, dtype=float)
    n = len(arr)
    if n == 0:
        return (None, None, None)
    boots = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        boots.append(arr[idx].mean())
    return (
        float(arr.mean() * 100),
        float(np.percentile(boots, 2.5) * 100),
        float(np.percentile(boots, 97.5) * 100),
    )


def wilson_ci(successes, total, alpha=0.05):
    """Wilson score interval for binomial proportion (better than normal approx for small n)."""
    if total == 0:
        return (0.0, 0.0, 0.0)
    p = successes / total
    z = 1.96  # 95% CI
    denom = 1 + z**2 / total
    center = (p + z**2 / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z**2 / (4 * total**2)) / denom
    return (p * 100, max(0, (center - half) * 100), min(100, (center + half) * 100))


def mcnemar_paired(rows_a, rows_b, k=5):
    """McNemar test: opaque vs informed at K=k, paired by payload_id.
    Returns (b_only, c_only, p_value). b_only=A success B fail; c_only=A fail B success."""
    map_a = {r["payload_id"]: r for r in rows_a}
    map_b = {r["payload_id"]: r for r in rows_b}
    common = set(map_a.keys()) & set(map_b.keys())

    b_only = 0  # bypassed in A but not B
    c_only = 0  # bypassed in B but not A
    for pid in common:
        a_byp = map_a[pid].get("bypass_at_k") is not None and map_a[pid]["bypass_at_k"] <= k
        b_byp = map_b[pid].get("bypass_at_k") is not None and map_b[pid]["bypass_at_k"] <= k
        if a_byp and not b_byp:
            b_only += 1
        elif b_byp and not a_byp:
            c_only += 1

    # Exact binomial McNemar (better than chi-square for small counts)
    if b_only + c_only == 0:
        return (b_only, c_only, 1.0)
    smaller = min(b_only, c_only)
    p = 2 * binom.cdf(smaller, b_only + c_only, 0.5)
    return (b_only, c_only, min(p, 1.0))


def holm_correction(p_values_with_labels, alpha=0.05):
    """Holm-Bonferroni step-down correction. Returns list of (label, p, p_adj, reject)."""
    sorted_pairs = sorted(p_values_with_labels, key=lambda x: x[1])
    n = len(sorted_pairs)
    out = []
    for rank, (label, p) in enumerate(sorted_pairs):
        adj = p * (n - rank)
        adj = min(adj, 1.0)
        reject = adj < alpha
        out.append((label, p, adj, reject))
    return out


# ── Reports ───────────────────────────────────────────────────────


def report_primary_table_ci():
    """Table 4: Bypass@K PRIMARY (9 models × K=1,2,3,4,5,10,20) with CIs."""
    print("=" * 110)
    print("Table 4 (PRIMARY whitebox-no-feedback) per-cell 95% bootstrap CI")
    print("=" * 110)
    print(f"{'Model':<25} {'K=1 [CI]':>20} {'K=5 [CI]':>20} {'K=20 [CI]':>20} {'Never [CI]':>20}")
    print("-" * 110)

    results = {}
    for model, fname in PRIMARY_FILES.items():
        rows = load_rows(ADAPTIVE / fname)
        n = len(rows)
        if n == 0: continue

        cells = {}
        for k in [1, 2, 3, 4, 5, 10, 20]:
            vals = bypass_at_k(rows, k)
            point, lo, hi = bootstrap_ci(vals)
            cells[f"K={k}"] = (point, lo, hi)
        # Never
        never_vals = [1 if r.get("bypass_at_k") is None else 0 for r in rows]
        point, lo, hi = bootstrap_ci(never_vals)
        cells["Never"] = (point, lo, hi)
        results[model] = cells

        print(f"{model:<25}  "
              f"{cells['K=1'][0]:5.1f} [{cells['K=1'][1]:4.1f}, {cells['K=1'][2]:4.1f}]  "
              f"{cells['K=5'][0]:5.1f} [{cells['K=5'][1]:4.1f}, {cells['K=5'][2]:4.1f}]  "
              f"{cells['K=20'][0]:5.1f} [{cells['K=20'][1]:4.1f}, {cells['K=20'][2]:4.1f}]  "
              f"{cells['Never'][0]:5.1f} [{cells['Never'][1]:4.1f}, {cells['Never'][2]:4.1f}]")
    print()
    return results


def report_flash_ablation_ci():
    """Table 11: 4-cell threat-model ablation on Flash + GPT-5.4 attacker, with CIs."""
    print("=" * 110)
    print("Table 11 (Flash 4-cell ablation + alt attacker) per-cell 95% bootstrap CI")
    print("=" * 110)
    print(f"{'Condition':<35} {'K=1 [CI]':>20} {'K=5 [CI]':>20} {'Never [CI]':>20}")
    print("-" * 110)

    results = {}
    for label, fname in FLASH_ABLATION.items():
        path = ADAPTIVE / fname
        if not path.exists():
            print(f"  MISSING: {label} -> {fname}")
            continue
        rows = load_rows(path)
        n = len(rows)
        if n == 0: continue

        k1 = bootstrap_ci(bypass_at_k(rows, 1))
        k5 = bootstrap_ci(bypass_at_k(rows, 5))
        never = bootstrap_ci([1 if r.get("bypass_at_k") is None else 0 for r in rows])
        results[label] = {"K=1": k1, "K=5": k5, "Never": never, "n": n}

        print(f"{label:<35}  "
              f"{k1[0]:5.1f} [{k1[1]:4.1f}, {k1[2]:4.1f}]  "
              f"{k5[0]:5.1f} [{k5[1]:4.1f}, {k5[2]:4.1f}]  "
              f"{never[0]:5.1f} [{never[1]:4.1f}, {never[2]:4.1f}]")
    print()
    return results


def report_mcnemar_primary_vs_opaque():
    """McNemar paired test: PRIMARY vs Opaque at K=5 on Flash."""
    print("=" * 110)
    print("McNemar paired test: PRIMARY (whitebox-no-fb) vs Opaque, Flash, K=5")
    print("=" * 110)

    primary = load_rows(ADAPTIVE / FLASH_ABLATION["PRIMARY (whitebox-no-fb)"])
    opaque = load_rows(ADAPTIVE / FLASH_ABLATION["Opaque"])

    b, c, p = mcnemar_paired(primary, opaque, k=5)
    print(f"  PRIMARY-only bypass: {b}  Opaque-only bypass: {c}  p-value: {p:.4g}")
    print(f"  Net delta: {b-c:+d} payloads (PRIMARY minus Opaque)")
    print()

    # Also: Informed vs PRIMARY (largest expected effect)
    informed = load_rows(ADAPTIVE / FLASH_ABLATION["Informed (legacy)"])
    b, c, p = mcnemar_paired(informed, primary, k=5)
    print("McNemar paired test: Informed vs PRIMARY, Flash, K=5")
    print(f"  Informed-only bypass: {b}  PRIMARY-only bypass: {c}  p-value: {p:.4g}")
    print(f"  Net delta: {b-c:+d} payloads (Informed adds vs PRIMARY)")
    print()

    # Also: Informed vs Opaque (full rejection-channel effect, no source)
    b, c, p = mcnemar_paired(informed, opaque, k=5)
    print("McNemar paired test: Informed vs Opaque, Flash, K=5")
    print(f"  Informed-only bypass: {b}  Opaque-only bypass: {c}  p-value: {p:.4g}")
    print(f"  Net delta: {b-c:+d} payloads (Informed adds vs Opaque)")
    print()


def report_per_category_ci():
    """Per-category Bypass@5 CI for PRIMARY across 9 models."""
    print("=" * 110)
    print("Per-category Bypass@5 CI under PRIMARY (whitebox-no-feedback)")
    print("=" * 110)

    per_cat = {}  # model -> cat -> (point, lo, hi, n)
    for model, fname in PRIMARY_FILES.items():
        rows = load_rows(ADAPTIVE / fname)
        by_cat = defaultdict(list)
        for r in rows:
            cat = r.get("category", "?")
            byp = 1 if (r.get("bypass_at_k") is not None and r["bypass_at_k"] <= 5) else 0
            by_cat[cat].append(byp)
        per_cat[model] = {}
        for cat, vals in sorted(by_cat.items()):
            point, lo, hi = bootstrap_ci(vals)
            per_cat[model][cat] = (point, lo, hi, len(vals))

    cats = sorted(set(c for m in per_cat.values() for c in m))
    print(f"  {'Cat':<5}", end="")
    for m in PRIMARY_FILES.keys():
        print(f" {m[:18]:>18}", end="")
    print()
    for cat in cats:
        print(f"  {cat:<5}", end="")
        for m in PRIMARY_FILES.keys():
            cell = per_cat.get(m, {}).get(cat)
            if cell is None:
                print(f" {'--':>18}", end="")
            else:
                p, lo, hi, n = cell
                print(f" {p:5.1f}[{lo:4.0f},{hi:4.0f}]n{n:>2}", end="")
        print()
    print()


def report_holm_correction():
    """Apply Holm correction across all per-category between-model comparisons (illustrative)."""
    print("=" * 110)
    print("Holm correction sketch (illustrative): pairwise model comparisons per category")
    print("=" * 110)
    print("Note: full 99-cell adjustment is omitted for brevity; the 'bolded winners' in Table 5 should")
    print("be interpreted with Holm correction applied. As a worked example, we adjust the")
    print("Sonnet vs nano comparison across the 11 categories (11 hypotheses):")

    sonnet_rows = load_rows(ADAPTIVE / PRIMARY_FILES["claude-sonnet-4-6"])
    nano_rows = load_rows(ADAPTIVE / PRIMARY_FILES["gpt-5.4-nano"])
    cats = sorted(set(r.get("category", "?") for r in sonnet_rows))

    p_values = []
    for cat in cats:
        s_vals = [1 if (r.get("bypass_at_k") is not None and r["bypass_at_k"] <= 5) else 0
                  for r in sonnet_rows if r.get("category") == cat]
        n_vals = [1 if (r.get("bypass_at_k") is not None and r["bypass_at_k"] <= 5) else 0
                  for r in nano_rows if r.get("category") == cat]
        # Independent two-sample test (approximate; payloads are paired but we don't track ID joins here)
        s_p = sum(s_vals) / max(len(s_vals), 1)
        n_p = sum(n_vals) / max(len(n_vals), 1)
        # Approximate two-sided z-test for difference of proportions
        n1, n2 = len(s_vals), len(n_vals)
        if n1 == 0 or n2 == 0:
            p_values.append((cat, 1.0))
            continue
        p_pool = (sum(s_vals) + sum(n_vals)) / (n1 + n2)
        if p_pool in (0, 1):
            p_values.append((cat, 1.0))
            continue
        se = math.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
        z = (n_p - s_p) / se if se > 0 else 0
        # two-sided p
        from scipy.stats import norm
        p = 2 * (1 - norm.cdf(abs(z)))
        p_values.append((cat, p))

    adjusted = holm_correction(p_values)
    print()
    print(f"  {'Cat':<5} {'raw p':>10} {'Holm-adj p':>14} {'sig?':>6}")
    print("-" * 50)
    for label, raw, adj, reject in adjusted:
        print(f"  {label:<5} {raw:>10.4g} {adj:>14.4g} {'***' if reject else '':>6}")
    print()


def report_holm_36pair_full():
    """Full Holm-Bonferroni correction across 36 model-pair × 11 category = 396 hypotheses.

    For each (pair, category) cell, compute an approximate two-sample z-test for the
    difference of Bypass@K=5 proportions. Apply Holm-Bonferroni step-down at alpha=0.05
    across all 396 raw p-values. Emit a JSON listing every cell and a short text summary.
    """
    import itertools
    from scipy.stats import norm

    print("=" * 110)
    print("Holm-Bonferroni full correction: 36 model pairs x 11 categories = 396 hypotheses")
    print("=" * 110)

    # Load all 9 models once and bucket bypass@5 by category
    model_cat_vals = {}  # model -> cat -> list[0/1]
    for model, fname in PRIMARY_FILES.items():
        rows = load_rows(ADAPTIVE / fname)
        by_cat = defaultdict(list)
        for r in rows:
            cat = r.get("category", "?")
            byp = 1 if (r.get("bypass_at_k") is not None and r["bypass_at_k"] <= 5) else 0
            by_cat[cat].append(byp)
        model_cat_vals[model] = by_cat

    all_cats = sorted({c for m in model_cat_vals.values() for c in m.keys() if c != "?"})

    models = list(PRIMARY_FILES.keys())
    pairs = list(itertools.combinations(models, 2))  # 9 choose 2 = 36

    raw_records = []  # list of dicts (no holm_adj_p / significant yet)
    p_with_idx = []   # (idx, raw_p) for Holm sorting

    for model_a, model_b in pairs:
        for cat in all_cats:
            a_vals = model_cat_vals[model_a].get(cat, [])
            b_vals = model_cat_vals[model_b].get(cat, [])
            n_a, n_b = len(a_vals), len(b_vals)
            p_a = (sum(a_vals) / n_a) if n_a else 0.0
            p_b = (sum(b_vals) / n_b) if n_b else 0.0

            if n_a == 0 or n_b == 0:
                raw_p = 1.0
            else:
                p_pool = (sum(a_vals) + sum(b_vals)) / (n_a + n_b)
                if p_pool == 0 or p_pool == 1:
                    raw_p = 1.0
                else:
                    se = math.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b))
                    if se == 0:
                        raw_p = 1.0
                    else:
                        z = (p_b - p_a) / se
                        raw_p = float(2 * (1 - norm.cdf(abs(z))))

            rec = {
                "pair": f"{model_a} vs {model_b}",
                "model_a": model_a,
                "model_b": model_b,
                "category": cat,
                "n_a": n_a,
                "n_b": n_b,
                "p_a": float(p_a),
                "p_b": float(p_b),
                "raw_p": float(raw_p),
            }
            p_with_idx.append((len(raw_records), raw_p))
            raw_records.append(rec)

    # Holm step-down: sort by raw_p ascending; adj_p = raw_p * (n - rank)
    n_total = len(raw_records)
    p_with_idx_sorted = sorted(p_with_idx, key=lambda x: x[1])
    alpha = 0.05
    # Holm with monotonic enforcement: adj_p[i] = max over j<=i of raw_p[j] * (n - j)
    running_max = 0.0
    for rank, (idx, raw_p) in enumerate(p_with_idx_sorted):
        adj = raw_p * (n_total - rank)
        if adj > 1.0:
            adj = 1.0
        if adj < running_max:
            adj = running_max
        else:
            running_max = adj
        raw_records[idx]["holm_adj_p"] = float(adj)
        raw_records[idx]["significant"] = bool(adj < alpha)

    # Write JSON
    out_json = STATIC.parent / "holm_36pair.json"
    with open(out_json, "w") as fh:
        json.dump(raw_records, fh, indent=2)

    # Build summary
    sig = [r for r in raw_records if r["significant"]]
    n_sig = len(sig)
    # Sort significant by adj_p ascending; take up to 10 examples
    sig_sorted = sorted(sig, key=lambda r: r["holm_adj_p"])
    examples = sig_sorted[:10]

    def _short(m: str) -> str:
        return (m.replace("claude-", "")
                 .replace("gemini-", "")
                 .replace("gpt-", "gpt")
                 .replace("preview", "prev"))

    ex_lines = []
    for r in examples:
        ex_lines.append(
            f"  - {_short(r['model_a'])} vs {_short(r['model_b'])} on Cat {r['category']}: "
            f"{r['p_a']*100:.1f}% vs {r['p_b']*100:.1f}% (n={r['n_a']}/{r['n_b']}, "
            f"raw p={r['raw_p']:.3g}, Holm-adj p={r['holm_adj_p']:.3g})"
        )

    summary_lines = [
        f"Across 36 pairwise guardrail-model contrasts x 11 categories ({n_total} hypotheses), "
        f"Holm-Bonferroni step-down correction at alpha=0.05 admits {n_sig} significant "
        f"per-category model differences ({n_sig}/{n_total} = {100*n_sig/n_total:.1f}%).",
        f"The strongest survivors (top {len(examples)} by adjusted p) concentrate in the "
        f"categories where the spread between strongest and weakest guardrails is largest "
        f"(Sonnet/Pro at the resilient end, Nano/Gemma4 at the bypass-prone end); marginal "
        f"between-model gaps within the mid-tier (Flash, Flash-Lite, gpt-5.4-mini, Haiku) "
        f"largely fall below the corrected threshold.",
        "Take-home: per-category bolded winners in Table 5 should be read as point estimates; "
        "after Holm correction across all 396 contrasts, only the largest gaps (typically "
        "involving Sonnet, Pro-Preview, or the weakest models Nano/Gemma4) remain significant.",
        "",
        "Top significant comparisons (by Holm-adjusted p):",
    ] + ex_lines

    summary_text = "\n".join(summary_lines) + "\n"

    out_txt = STATIC.parent / "holm_36pair_summary.txt"
    with open(out_txt, "w") as fh:
        fh.write(summary_text)

    print(f"  Total comparisons: {n_total}")
    print(f"  Significant after Holm (alpha=0.05): {n_sig} ({100*n_sig/n_total:.1f}%)")
    print(f"  Wrote: {out_json}")
    print(f"  Wrote: {out_txt}")
    print()


def main():
    primary_results = report_primary_table_ci()
    flash_ablation = report_flash_ablation_ci()
    report_mcnemar_primary_vs_opaque()
    report_per_category_ci()
    report_holm_correction()
    report_holm_36pair_full()


if __name__ == "__main__":
    main()
