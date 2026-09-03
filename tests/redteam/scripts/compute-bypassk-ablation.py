#!/usr/bin/env python3
"""
Compute Bypass@K cumulative curves for all threat-model conditions.

Usage:
  python3 tests/redteam/scripts/compute-bypassk-ablation.py
  python3 tests/redteam/scripts/compute-bypassk-ablation.py --json   # machine-readable

Outputs a comparison table per guardrail model across:
  - opaque (no-feedback, primary)        -- latest 2026-04-28T03-55* files
  - informed (legacy with-feedback)      -- 2026-04-24 baseline
  - white-box (Flash only)
  - GPT-5.4 attacker (Flash only)
"""

import argparse
import json
from pathlib import Path

ADAPTIVE_DIR = Path(__file__).resolve().parent.parent / "runs" / "adaptive"

LEGACY_INFORMED = {
    "claude-sonnet-4-6":      "2026-04-24T00-33-09-554Z-anthropic_claude-sonnet-4-6.jsonl",
    "gemini-3.1-pro-preview": "2026-04-24T03-44-11-465Z-gemini_gemini-3.1-pro-preview.jsonl",
    "gemini-2.5-flash":       "2026-04-24T01-51-49-083Z-gemini_gemini-2.5-flash.jsonl",
    "claude-haiku-4-5":       "2026-04-23T23-41-26-025Z-anthropic_claude-haiku-4-5-20251001.jsonl",
    "gemini-3.1-flash-lite":  "2026-04-24T02-56-13-944Z-gemini_gemini-3.1-flash-lite-preview.jsonl",
    "gpt-5.4-mini":           "2026-04-23T23-41-31-131Z-openai_gpt-5.4-mini-2026-03-17.jsonl",
    "gpt-5.4":                "2026-04-24T01-03-50-917Z-openai_gpt-5.4.jsonl",
    "gpt-5.4-nano":           "2026-04-24T00-26-17-908Z-openai_gpt-5.4-nano.jsonl",
    "gemma4":                 "2026-04-24T04-57-07-714Z-ollama_gemma4_e2b-it-q4_K_M.jsonl",
}


def load_curve(path: Path, k_max: int = 5):
    """Return (k_rates_pct, never_pct, n_rows) or None if file missing/incomplete."""
    if not path.exists():
        return None
    rows = []
    header = None
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("type") == "header":
                header = d
            elif d.get("type") == "row":
                rows.append(d)
    n = len(rows)
    if n == 0:
        return None
    rates = []
    for k in range(1, k_max + 1):
        bypassed = sum(1 for r in rows if r.get("bypass_at_k") is not None and r["bypass_at_k"] <= k)
        rates.append(bypassed / n * 100)
    never = sum(1 for r in rows if r.get("bypass_at_k") is None)
    return {
        "n": n,
        "rates": rates,
        "never_pct": never / n * 100,
        "guardrail": (header or {}).get("guardrail_model", "?"),
        "attacker": (header or {}).get("attacker_model", "?"),
        "corpus_size": (header or {}).get("corpus_size", "?"),
    }


def find_latest_opaque(target_guardrail_model: str):
    """Locate the PRIMARY no-feedback (opaque) file for a guardrail model.

    Reads each candidate's JSONL header and matches by exact guardrail_model field.
    PRIMARY launch was at 03-55 UTC (other prefixes are ablations or stale runs).
    """
    PRIMARY_PREFIX = "2026-04-28T03-55"
    matches = []
    for p in ADAPTIVE_DIR.iterdir():
        if p.name.endswith(".done"):
            continue
        if not p.name.startswith(PRIMARY_PREFIX):
            continue
        try:
            with open(p) as fh:
                header = json.loads(fh.readline())
            if header.get("type") == "header" and header.get("guardrail_model") == target_guardrail_model:
                matches.append(p)
        except Exception:
            continue
    matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    completed = [p for p in matches if p.suffix == ".jsonl" and ".part-live." not in p.name]
    if completed:
        return completed[0]
    if matches:
        return matches[0]
    return None


GUARDRAIL_MODEL_IDS = {
    "claude-sonnet-4-6":      "anthropic:claude-sonnet-4-6",
    "gemini-3.1-pro-preview": "gemini:gemini-3.1-pro-preview",
    "gemini-2.5-flash":       "gemini:gemini-2.5-flash",
    "claude-haiku-4-5":       "anthropic:claude-haiku-4-5-20251001",
    "gemini-3.1-flash-lite":  "gemini:gemini-3.1-flash-lite-preview",
    "gpt-5.4-mini":           "openai:gpt-5.4-mini-2026-03-17",
    "gpt-5.4":                "openai:gpt-5.4",
    "gpt-5.4-nano":           "openai:gpt-5.4-nano",
    "gemma4":                 "ollama:gemma4:e2b-it-q4_K_M",
}


def fmt_row(label: str, curve, ref_curve=None):
    if curve is None:
        return f"  {label:30s}  [no data]"
    rates = curve["rates"]
    delta_str = ""
    if ref_curve is not None:
        delta = rates[-1] - ref_curve["rates"][-1]
        sign = "+" if delta >= 0 else ""
        delta_str = f"  Δ@K=5: {sign}{delta:.1f}pp"
    return (f"  {label:30s}  "
            f"K=1:{rates[0]:5.1f}  K=2:{rates[1]:5.1f}  K=3:{rates[2]:5.1f}  "
            f"K=4:{rates[3]:5.1f}  K=5:{rates[4]:5.1f}  Never:{curve['never_pct']:5.1f}  "
            f"N={curve['n']}{delta_str}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit JSON for downstream tooling")
    args = ap.parse_args()

    results = {}
    for model, legacy_file in LEGACY_INFORMED.items():
        guardrail_id = GUARDRAIL_MODEL_IDS[model]
        # informed (legacy)
        informed = load_curve(ADAPTIVE_DIR / legacy_file)
        # opaque (latest no-feedback)
        opaque_path = find_latest_opaque(guardrail_id)
        opaque = load_curve(opaque_path) if opaque_path else None

        results[model] = {
            "informed": informed,
            "opaque": opaque,
            "opaque_file": str(opaque_path.name) if opaque_path else None,
        }

    if args.json:
        # Strip non-serializable
        for r in results.values():
            for k in ("informed", "opaque"):
                if r[k] and "n" in r[k]:
                    pass  # already serializable
        print(json.dumps(results, indent=2, default=str))
        return

    print("=" * 100)
    print("Bypass@K Threat-Model Comparison (Opaque vs Informed)")
    print("=" * 100)
    print()

    # Summary table per model
    for model, r in results.items():
        print(f"{model}")
        print(fmt_row("informed (legacy w/ feedback)", r["informed"]))
        print(fmt_row("opaque (no-feedback PRIMARY)", r["opaque"], ref_curve=r["informed"]))
        print()

    # Ablation extras for Flash
    flash_kw = "gemini-2.5-flash"
    print("=" * 100)
    print("Flash-only ablations (white-box, alt attacker)")
    print("=" * 100)
    # White-box file: started at 04-06 with --whitebox; identify via attacker_model + recent timestamp
    wb_candidates = sorted(
        [p for p in ADAPTIVE_DIR.glob("2026-04-28T04-*gemini_gemini-2.5-flash*")
         if not p.name.endswith(".done")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for p in wb_candidates[:2]:
        c = load_curve(p)
        print(f"  {p.name[:60]}")
        if c:
            print(f"    G={c['guardrail']}  A={c['attacker']}  N={c['n']}  K=5:{c['rates'][-1]:.1f}%  Never:{c['never_pct']:.1f}%")


if __name__ == "__main__":
    main()
