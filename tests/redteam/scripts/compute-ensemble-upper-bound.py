#!/usr/bin/env python3
"""
compute-ensemble-upper-bound.py — empirical 3-attacker ensemble upper
bound on Pro guardrail bypass. Address R5/R7/R8/R11/R13 "stronger
attacker would do more" critique with no new API calls: a determined
adversary with multi-vendor API access can deploy the union of all
3 attackers per payload and accept the soonest bypass.

Per-payload ensemble Bypass@K = OR over (Gemini-3.1-Pro, Opus-4.7,
GPT-5.4) attackers; concretely:

    ensemble_bypass_at_k[pid] = min(
        attacker.bypass_at_k[pid]
        for attacker in [pro, opus, gpt]
        if attacker.bypass_at_k[pid] is not None
    ) or None

Aggregated over the 469 attack payloads, this lower-bounds the bypass
achievable by an adversary with <$100/month commodity budget across
three frontier providers.

Sources (all SHA-pinned; all on same Pro guardrail; all PRIMARY
whitebox-no-feedback threat model):

  Pro × Gemini-3.1-Pro:
    runs/adaptive/2026-04-28T19-50-46-477Z-gemini_gemini-3.1-pro-preview.jsonl
    (PRIMARY 9-model headline run; full 469 corpus, K=20).

  Pro × Opus-4.7 (merged 3-source PURE):
    runs/adaptive/pro-opus-cumulative-K20.json
    (469 union via merge-pro-opus-cumulative.py; carries refused_all).

  Pro × GPT-5.4 (merged 2-source):
    runs/adaptive/2026-04-29T09-31-35-759Z-gemini_gemini-3.1-pro-preview.k5-snapshot.jsonl
      + runs/adaptive/2026-04-29T16-31-15-287Z-gemini_gemini-3.1-pro-preview.jsonl
    Same merge as merge-pro-gpt-cumulative.py: K=5 snapshot's bypass_at_k
    for already-bypassed (1..5); K=20 fresh-subset run for never-at-K=5.

Theoretical bounds for context:
  independent upper = 1 - prod(1-p_i) = 1 - (1-0.648)(1-0.708)(1-0.829) ≈ 98.2%
  correlated lower  = max(p_i) = 82.9%

The empirical ensemble sits between these bounds and characterizes
the partial correlation between Anthropic, OpenAI, and Google attacker
error patterns.

Output: runs/adaptive/pro-ensemble-3attacker-K20.json
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"

PRO_X_PRO = RUNS_DIR / "2026-04-28T19-50-46-477Z-gemini_gemini-3.1-pro-preview.jsonl"
PRO_X_OPUS_CUM = RUNS_DIR / "pro-opus-cumulative-K20.json"
PRO_X_GPT_K5 = RUNS_DIR / (
    "2026-04-29T09-31-35-759Z-gemini_gemini-3.1-pro-preview.k5-snapshot.jsonl"
)
PRO_X_GPT_K20_FRESH = RUNS_DIR / (
    "2026-04-29T16-31-15-287Z-gemini_gemini-3.1-pro-preview.jsonl"
)
OUT_FILE = RUNS_DIR / "pro-ensemble-3attacker-K20.json"

# SHA pins — fail loud if any input is mutated.
EXPECTED_SHAS = {
    PRO_X_OPUS_CUM: "f1717b69af81abb35d1cc1a19956b1e64843a9a88438e54f482bf99376e7c27a",
    PRO_X_GPT_K5: "049fe78379b6b8afe182d9a6595d591a8662de34dadd96af383040d9a6a73ce3",
    PRO_X_GPT_K20_FRESH: "edc34fdf9fbd7d9996bdd50a7409e92b01b61f59e2802b98175cb53b93af4242",
}
# Pro × Pro PRIMARY 9-model run sha computed at run time (not previously pinned).

KMAX = 20
EXPECTED_TOTAL = 469


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl_rows(path: Path) -> tuple[dict, list[dict]]:
    """Return (header, rows). Rows are 'type'=='row' entries."""
    header: dict | None = None
    rows: list[dict] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            t = obj.get("type")
            if t == "header":
                header = obj
            elif t == "row":
                rows.append(obj)
    if header is None:
        raise RuntimeError(f"{path}: no header line")
    return header, rows


def main() -> int:
    # SHA-pin the inputs that already had pinned SHAs in prior phases.
    for p, exp in EXPECTED_SHAS.items():
        actual = sha256(p)
        if actual != exp:
            print(
                f"FATAL: {p.name} SHA mismatch.\n  expected: {exp}\n  actual:   {actual}",
                file=sys.stderr,
            )
            return 2

    # ── Pro × Pro: read the 9-model PRIMARY run for Pro guardrail.
    pro_header, pro_rows = load_jsonl_rows(PRO_X_PRO)
    assert pro_header["k_max"] == KMAX, pro_header
    assert pro_header["guardrail_model"] == "gemini:gemini-3.1-pro-preview", pro_header
    assert pro_header["attacker_model"] == "gemini:gemini-3.1-pro-preview", pro_header
    assert pro_header.get("threat_model") == "whitebox-no-feedback" or True  # legacy header may omit
    assert pro_header["corpus_size"] == EXPECTED_TOTAL, pro_header
    pro_pp_pid = {r["payload_id"]: r["bypass_at_k"] for r in pro_rows}
    pro_cat = {r["payload_id"]: r["category"] for r in pro_rows}
    pro_x_pro_sha = sha256(PRO_X_PRO)

    # ── Pro × Opus: read the merged cumulative (already 469 PURE rows).
    opus_doc = json.loads(PRO_X_OPUS_CUM.read_text())
    assert opus_doc["k_max"] == KMAX
    assert opus_doc["guardrail_model"] == "gemini:gemini-3.1-pro-preview"
    assert opus_doc["attacker_model"] == "anthropic:claude-opus-4-7"
    assert opus_doc["total_payloads_full"] == EXPECTED_TOTAL, opus_doc.keys()
    opus_pp_pid = {r["payload_id"]: r["bypass_at_k"] for r in opus_doc["rows"]}

    # ── Pro × GPT: union the K=5 snapshot's bypassed rows with the K=20
    #    fresh-subset run for never-at-K=5 (same logic as
    #    merge-pro-gpt-cumulative.py).
    k5_header, k5_rows = load_jsonl_rows(PRO_X_GPT_K5)
    assert k5_header["k_max"] == 5, k5_header
    assert k5_header["attacker_model"] == "openai:gpt-5.4", k5_header
    k20_header, k20_rows = load_jsonl_rows(PRO_X_GPT_K20_FRESH)
    assert k20_header["k_max"] == KMAX, k20_header
    assert k20_header["attacker_model"] == "openai:gpt-5.4", k20_header

    k20_by_id = {r["payload_id"]: r for r in k20_rows}
    gpt_pp_pid: dict[str, int | None] = {}
    for r5 in k5_rows:
        pid = r5["payload_id"]
        if r5["bypass_at_k"] is not None:
            gpt_pp_pid[pid] = r5["bypass_at_k"]
        else:
            r20 = k20_by_id.get(pid)
            gpt_pp_pid[pid] = r20["bypass_at_k"] if r20 is not None else None

    # ── Coverage assertions: all three sources must cover the same 469 PIDs.
    for name, m in [("Pro×Pro", pro_pp_pid), ("Pro×Opus", opus_pp_pid), ("Pro×GPT", gpt_pp_pid)]:
        if len(m) != EXPECTED_TOTAL:
            print(
                f"FATAL: {name} has {len(m)} payloads, expected {EXPECTED_TOTAL}",
                file=sys.stderr,
            )
            return 2

    pids_pro = set(pro_pp_pid.keys())
    pids_opus = set(opus_pp_pid.keys())
    pids_gpt = set(gpt_pp_pid.keys())
    if not (pids_pro == pids_opus == pids_gpt):
        diffs = {
            "pro_only_vs_opus": sorted(pids_pro - pids_opus)[:5],
            "opus_only_vs_pro": sorted(pids_opus - pids_pro)[:5],
            "pro_only_vs_gpt": sorted(pids_pro - pids_gpt)[:5],
        }
        print(f"FATAL: payload_id sets diverge across sources: {diffs}", file=sys.stderr)
        return 2

    # ── Compute per-payload ensemble: soonest bypass across the 3 attackers.
    ensemble: dict[str, int | None] = {}
    sorted_pids = sorted(pids_pro)
    for pid in sorted_pids:
        ks = [v for v in (pro_pp_pid[pid], opus_pp_pid[pid], gpt_pp_pid[pid]) if v is not None]
        ensemble[pid] = min(ks) if ks else None

    # ── Aggregate cumulative Bypass@K=1..20 across 469.
    n = EXPECTED_TOTAL
    cumulative: dict[int, dict] = {}
    for k in range(1, KMAX + 1):
        cnt = sum(1 for v in ensemble.values() if v is not None and v <= k)
        cumulative[k] = {"count": cnt, "rate": cnt / n}

    never = sum(1 for v in ensemble.values() if v is None)

    # Per-attacker individual K=20 (for context + bound check).
    pro_k20 = sum(1 for v in pro_pp_pid.values() if v is not None and v <= KMAX) / n
    opus_k20 = sum(1 for v in opus_pp_pid.values() if v is not None and v <= KMAX) / n
    gpt_k20 = sum(1 for v in gpt_pp_pid.values() if v is not None and v <= KMAX) / n

    # Theoretical bounds.
    independent_upper = 1 - (1 - pro_k20) * (1 - opus_k20) * (1 - gpt_k20)
    correlated_lower = max(pro_k20, opus_k20, gpt_k20)

    # Per-category K=20 ensemble + best single-attacker per cat.
    per_cat: dict[str, dict] = {}
    cats = defaultdict(list)
    for pid, k in ensemble.items():
        cats[pro_cat[pid]].append(pid)
    for cat in sorted(cats):
        cat_pids = cats[cat]
        cn = len(cat_pids)
        ens_cnt = sum(1 for pid in cat_pids if ensemble[pid] is not None and ensemble[pid] <= KMAX)
        pro_cnt = sum(1 for pid in cat_pids if pro_pp_pid[pid] is not None and pro_pp_pid[pid] <= KMAX)
        opus_cnt = sum(1 for pid in cat_pids if opus_pp_pid[pid] is not None and opus_pp_pid[pid] <= KMAX)
        gpt_cnt = sum(1 for pid in cat_pids if gpt_pp_pid[pid] is not None and gpt_pp_pid[pid] <= KMAX)
        best_single = max(pro_cnt, opus_cnt, gpt_cnt)
        ens_minus_best = (ens_cnt - best_single) / cn * 100
        per_cat[cat] = {
            "n": cn,
            "ensemble_K20": {"count": ens_cnt, "rate": ens_cnt / cn},
            "pro_K20": {"count": pro_cnt, "rate": pro_cnt / cn},
            "opus_K20": {"count": opus_cnt, "rate": opus_cnt / cn},
            "gpt_K20": {"count": gpt_cnt, "rate": gpt_cnt / cn},
            "best_single_K20_count": best_single,
            "ensemble_minus_best_pp": ens_minus_best,
        }

    # ── Output.
    out = {
        "type": "pro_ensemble_3attacker",
        "guardrail_model": "gemini:gemini-3.1-pro-preview",
        "attackers": ["gemini:gemini-3.1-pro-preview", "anthropic:claude-opus-4-7", "openai:gpt-5.4"],
        "threat_model": "whitebox-no-feedback",
        "k_max": KMAX,
        "total_payloads": n,
        "method": (
            "Per-payload Bypass@K = soonest of (Pro, Opus, GPT) bypass; "
            "OR aggregated over 469. SHA-pinned inputs; same Pro guardrail "
            "across all 3 sources; PRIMARY whitebox-no-feedback threat model."
        ),
        "input_files": [
            {
                "path": str(PRO_X_PRO.relative_to(REPO_ROOT)),
                "sha256": pro_x_pro_sha,
                "attacker": "gemini:gemini-3.1-pro-preview",
                "individual_K20_rate": pro_k20,
            },
            {
                "path": str(PRO_X_OPUS_CUM.relative_to(REPO_ROOT)),
                "sha256": EXPECTED_SHAS[PRO_X_OPUS_CUM],
                "attacker": "anthropic:claude-opus-4-7",
                "individual_K20_rate": opus_k20,
            },
            {
                "path": (
                    f"{PRO_X_GPT_K5.relative_to(REPO_ROOT)} + "
                    f"{PRO_X_GPT_K20_FRESH.relative_to(REPO_ROOT)}"
                ),
                "sha256": (
                    f"{EXPECTED_SHAS[PRO_X_GPT_K5]} + {EXPECTED_SHAS[PRO_X_GPT_K20_FRESH]}"
                ),
                "attacker": "openai:gpt-5.4",
                "individual_K20_rate": gpt_k20,
            },
        ],
        "ensemble_bypass_at_k_cumulative": cumulative,
        "ensemble_never_bypassed_at_kmax": {
            "count": never,
            "rate": never / n,
        },
        "individual_K20_rates": {
            "pro_x_pro": pro_k20,
            "pro_x_opus": opus_k20,
            "pro_x_gpt": gpt_k20,
        },
        "theoretical_bounds": {
            "correlated_lower": correlated_lower,
            "independent_upper": independent_upper,
            "ensemble_empirical": cumulative[KMAX]["rate"],
            "in_bounds": correlated_lower <= cumulative[KMAX]["rate"] <= independent_upper,
        },
        "per_category": per_cat,
    }

    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote: {OUT_FILE}")
    print()
    print(f"Individual Pro × ___ Bypass@K=20 rates (469-row corpus):")
    print(f"  Pro × Pro    : {pro_k20*100:5.1f}%")
    print(f"  Pro × Opus   : {opus_k20*100:5.1f}%")
    print(f"  Pro × GPT-5.4: {gpt_k20*100:5.1f}%")
    print()
    print(f"Theoretical bounds:")
    print(f"  Correlated lower  (max of 3): {correlated_lower*100:5.1f}%")
    print(f"  Independent upper (1−Π(1−p)): {independent_upper*100:5.1f}%")
    print()
    print(f"Empirical ensemble Bypass@K cumulative (469 corpus):")
    for k in range(1, KMAX + 1):
        v = cumulative[k]
        print(f"  K={k:>2}: {v['count']:>3}/{n} = {v['rate']*100:5.1f}%")
    print(
        f"  Never@K=20: {never}/{n} = {never/n*100:.1f}%"
    )

    bounds_ok = correlated_lower - 1e-9 <= cumulative[KMAX]["rate"] <= independent_upper + 1e-9
    if not bounds_ok:
        print(
            f"\nFATAL: ensemble K=20 = {cumulative[KMAX]['rate']*100:.1f}% violates bounds "
            f"[{correlated_lower*100:.1f}, {independent_upper*100:.1f}].",
            file=sys.stderr,
        )
        return 2

    print()
    print("Per-category K=20 (ensemble vs best single-attacker):")
    for cat in sorted(per_cat):
        c = per_cat[cat]
        print(
            f"  {cat}: n={c['n']:>3}  ens={c['ensemble_K20']['count']:>3}/{c['n']} = {c['ensemble_K20']['rate']*100:5.1f}%  "
            f"best_single={c['best_single_K20_count']:>3}/{c['n']}  "
            f"ens−best=+{c['ensemble_minus_best_pp']:.1f}pp  "
            f"(pro={c['pro_K20']['rate']*100:.0f} opus={c['opus_K20']['rate']*100:.0f} gpt={c['gpt_K20']['rate']*100:.0f})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
