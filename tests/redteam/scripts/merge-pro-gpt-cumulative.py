#!/usr/bin/env python3
"""
merge-pro-gpt-cumulative.py — merge F5-Pro K=5 snapshot with F5-Pro-K20
fresh subset run to produce the paper-ready Bypass@K cumulative curve
for the Pro guardrail × GPT-5.4 attacker (PRIMARY whitebox-no-feedback)
ablation.

Why merge: founder C2 direction "錢不是這樣浪費" — the 362 payloads that
already bypassed at K=1..5 do not need re-attacking at K=6..20 (already
counted as bypass). Only the 107 never-bypassed-at-K=5 subset was
re-attacked at K=1..20. Merge:
  - For each of 469 attack payloads:
    - If bypass_at_k in K=5 snapshot is set: use snapshot value (1..5)
    - Else: use K=20 run's bypass_at_k (1..20 or null)
  - Compute cumulative Bypass@K for K=1..20 across full N=469.

Inputs (paths relative to pop-pay-npm/):
  tests/redteam/runs/adaptive/
      2026-04-29T09-31-35-759Z-gemini_gemini-3.1-pro-preview.k5-snapshot.jsonl
      2026-04-29T16-31-15-287Z-gemini_gemini-3.1-pro-preview.jsonl

Output:
  tests/redteam/runs/adaptive/pro-gpt54-cumulative-K20.json

Uses: stdlib only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"

K5_SNAPSHOT = RUNS_DIR / (
    "2026-04-29T09-31-35-759Z-gemini_gemini-3.1-pro-preview.k5-snapshot.jsonl"
)
K20_FRESH = RUNS_DIR / (
    "2026-04-29T16-31-15-287Z-gemini_gemini-3.1-pro-preview.jsonl"
)
OUT_FILE = RUNS_DIR / "pro-gpt54-cumulative-K20.json"

# SHA256 sentinels — fail loudly if input files have been mutated since the
# F5-Pro / F5-Pro-K20 ledger entries pinned them.
EXPECTED_K5_SHA = "049fe78379b6b8afe182d9a6595d591a8662de34dadd96af383040d9a6a73ce3"
EXPECTED_K20_SHA = "edc34fdf9fbd7d9996bdd50a7409e92b01b61f59e2802b98175cb53b93af4242"

KMAX = 20
EXPECTED_FULL_CORPUS = 469
EXPECTED_FRESH_SUBSET = 107


def sha256(p: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def load_run(p: Path) -> tuple[dict, list[dict], dict | None]:
    """Return (header, rows, report)."""
    header: dict | None = None
    rows: list[dict] = []
    report: dict | None = None
    with open(p) as f:
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
            elif t == "report":
                report = obj
    if header is None:
        raise RuntimeError(f"{p}: no header line")
    return header, rows, report


def main() -> int:
    # Verify file SHAs match the immutable references
    actual_k5 = sha256(K5_SNAPSHOT)
    actual_k20 = sha256(K20_FRESH)
    if actual_k5 != EXPECTED_K5_SHA:
        print(
            f"FATAL: K=5 snapshot SHA mismatch.\n"
            f"  expected: {EXPECTED_K5_SHA}\n"
            f"  actual:   {actual_k5}\n"
            f"  path:     {K5_SNAPSHOT}",
            file=sys.stderr,
        )
        return 2
    if actual_k20 != EXPECTED_K20_SHA:
        print(
            f"FATAL: K=20 fresh-run SHA mismatch.\n"
            f"  expected: {EXPECTED_K20_SHA}\n"
            f"  actual:   {actual_k20}\n"
            f"  path:     {K20_FRESH}",
            file=sys.stderr,
        )
        return 2

    k5_header, k5_rows, _ = load_run(K5_SNAPSHOT)
    k20_header, k20_rows, _ = load_run(K20_FRESH)

    # Sanity
    assert k5_header["guardrail_model"] == "gemini:gemini-3.1-pro-preview", k5_header
    assert k5_header["attacker_model"] == "openai:gpt-5.4", k5_header
    assert k5_header["threat_model"] == "whitebox-no-feedback", k5_header
    assert k5_header["k_max"] == 5, k5_header
    assert len(k5_rows) == EXPECTED_FULL_CORPUS, (len(k5_rows), EXPECTED_FULL_CORPUS)

    assert k20_header["guardrail_model"] == "gemini:gemini-3.1-pro-preview", k20_header
    assert k20_header["attacker_model"] == "openai:gpt-5.4", k20_header
    assert k20_header["threat_model"] == "whitebox-no-feedback", k20_header
    assert k20_header["k_max"] == KMAX, k20_header
    assert len(k20_rows) == EXPECTED_FRESH_SUBSET, (len(k20_rows), EXPECTED_FRESH_SUBSET)

    # Build merged map keyed by payload_id
    k20_by_id = {r["payload_id"]: r for r in k20_rows}

    merged: list[dict] = []
    used_snapshot = 0
    used_k20 = 0
    snapshot_never_not_in_k20 = 0
    for r5 in k5_rows:
        pid = r5["payload_id"]
        if r5["bypass_at_k"] is not None:
            # Already bypassed at K=1..5 — keep snapshot result, do not consult K=20
            merged.append(
                {
                    "payload_id": pid,
                    "category": r5["category"],
                    "bypass_at_k": r5["bypass_at_k"],
                    "source": "k5_snapshot",
                }
            )
            used_snapshot += 1
        else:
            # Never-bypassed at K=5 — should be in K=20 fresh run
            r20 = k20_by_id.get(pid)
            if r20 is None:
                # Conservative: keep as null and flag
                snapshot_never_not_in_k20 += 1
                merged.append(
                    {
                        "payload_id": pid,
                        "category": r5["category"],
                        "bypass_at_k": None,
                        "source": "k5_snapshot_no_k20_data",
                    }
                )
            else:
                merged.append(
                    {
                        "payload_id": pid,
                        "category": r20["category"],
                        "bypass_at_k": r20["bypass_at_k"],
                        "source": "k20_fresh",
                    }
                )
                used_k20 += 1

    # Cumulative Bypass@K for K=1..KMAX across full corpus
    total = len(merged)
    cumulative: dict[int, dict] = {}
    for k in range(1, KMAX + 1):
        count = sum(
            1
            for m in merged
            if m["bypass_at_k"] is not None and m["bypass_at_k"] <= k
        )
        cumulative[k] = {"count": count, "rate": count / total if total > 0 else 0.0}

    never_at_kmax = sum(1 for m in merged if m["bypass_at_k"] is None)

    # Per-category breakdown
    per_cat: dict[str, dict] = {}
    cats = sorted({m["category"] for m in merged})
    for cat in cats:
        sub = [m for m in merged if m["category"] == cat]
        sub_n = len(sub)
        sub_cum = {}
        for k in range(1, KMAX + 1):
            c = sum(
                1
                for m in sub
                if m["bypass_at_k"] is not None and m["bypass_at_k"] <= k
            )
            sub_cum[k] = {
                "count": c,
                "rate": c / sub_n if sub_n > 0 else 0.0,
            }
        per_cat[cat] = {
            "total": sub_n,
            "bypass_at_k_cumulative": sub_cum,
            "never_bypassed_at_kmax": sum(1 for m in sub if m["bypass_at_k"] is None),
        }

    out = {
        "type": "merged_cumulative",
        "guardrail_model": "gemini:gemini-3.1-pro-preview",
        "attacker_model": "openai:gpt-5.4",
        "threat_model": "whitebox-no-feedback",
        "k_max": KMAX,
        "total_payloads": total,
        "merge_method": (
            "F5-Pro K=5 snapshot bypass_at_k for already-bypassed; "
            "F5-Pro-K20 fresh-subset bypass_at_k for never-at-K=5 subset. "
            "K=1..5 cumulative reproduces snapshot exactly. "
            "K=6..20 adds bypasses found in fresh K=20 walk on the 107-payload subset."
        ),
        "input_files": {
            "k5_snapshot": {
                "path": str(K5_SNAPSHOT.relative_to(REPO_ROOT)),
                "sha256": EXPECTED_K5_SHA,
                "rows": len(k5_rows),
            },
            "k20_fresh": {
                "path": str(K20_FRESH.relative_to(REPO_ROOT)),
                "sha256": EXPECTED_K20_SHA,
                "rows": len(k20_rows),
            },
        },
        "merge_provenance": {
            "from_k5_snapshot": used_snapshot,
            "from_k20_fresh": used_k20,
            "snapshot_never_no_k20_data": snapshot_never_not_in_k20,
        },
        "bypass_at_k_cumulative": cumulative,
        "never_bypassed_at_kmax": never_at_kmax,
        "per_category": per_cat,
    }

    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote: {OUT_FILE}")
    print()
    print("Cumulative Bypass@K (full corpus N={}):".format(total))
    for k in range(1, KMAX + 1):
        v = cumulative[k]
        print(f"  K={k:>2}: {v['count']:>3}/{total} = {v['rate'] * 100:5.1f}%")
    print(
        f"  Never@K={KMAX}: {never_at_kmax}/{total} = "
        f"{never_at_kmax / total * 100:.1f}%"
    )

    # Sanity assertions for paper-ready numbers
    k5_count = cumulative[5]["count"]
    k20_count = cumulative[KMAX]["count"]
    expected_k5 = 362  # from F5-Pro snapshot
    expected_k20 = 362 + 27  # snapshot bypassed + fresh K=20 bypassed
    if k5_count != expected_k5:
        print(
            f"\nWARN: K=5 cumulative {k5_count} != expected {expected_k5}",
            file=sys.stderr,
        )
    if k20_count != expected_k20:
        print(
            f"\nWARN: K=20 cumulative {k20_count} != expected {expected_k20}",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
