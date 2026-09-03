#!/usr/bin/env python3
"""
merge-flash-gpt-cumulative.py — merge the F5-FlashGPT K=5 snapshot
(469-row K=5) with the F5-FlashGPT-K20Tail run (195-row K=20 fresh
on never-bypassed-at-K=5 subset) to produce the paper-ready
Bypass@K=1..20 cumulative curve over the full 469-row corpus.

Same logic as merge-pro-gpt-cumulative.py:
  - For each of 469 attack-only payloads:
      * If K=5 snapshot has bypass_at_k != null: use snapshot value (1..5)
      * Else (one of the 195 never-at-K=5): use K=20 fresh-tail run's
        bypass_at_k (1..20 or None)
  - Aggregate cumulative Bypass@K for K=1..20 across full N=469.

For Tab 11 row 5 paper update:
  - Pre-merge: row 5 had only K=1..K=5 columns (K=5 snapshot data) +
    Never@K=5 + Δ@5 = -3.2pp vs Flash×Pro 61.6%.
  - Post-merge: extend row 5 to K=20 cumulative + Never@K=20.

Inputs (paths relative to pop-pay-npm/, both SHA-pinned):
  K=5 snapshot:    runs/adaptive/2026-04-28T04-06-24-307Z-gemini_gemini-2.5-flash.k5-snapshot.jsonl
  K=20 fresh-tail: runs/adaptive/<NEW>-gemini_gemini-2.5-flash.jsonl
                   (resolved at runtime via newest mtime ≥ dispatch_at)

Output: runs/adaptive/flash-gpt54-cumulative-K20.json
"""
from __future__ import annotations

import glob
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"

K5_SNAPSHOT = RUNS_DIR / (
    "2026-04-28T04-06-24-307Z-gemini_gemini-2.5-flash.k5-snapshot.jsonl"
)
# K=20 tail file: resolve at runtime to newest *-gemini_gemini-2.5-flash*.jsonl
# whose header reports k_max=20 + corpus_size=195 + attacker=openai:gpt-5.4.
K20_TAIL_GLOB = str(RUNS_DIR / "*-gemini_gemini-2.5-flash*.jsonl")
OUT_FILE = RUNS_DIR / "flash-gpt54-cumulative-K20.json"

EXPECTED_K5_SHA = "968b59cbd3c36f0df57ca11ee53b48f3169fccb382980c5b38284d26714dbf9e"

KMAX = 20
EXPECTED_TOTAL = 469
EXPECTED_NEVER_K5 = 195


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def load_run(p: Path) -> tuple[dict, list[dict], dict | None]:
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


def find_k20_tail() -> Path:
    """Find the K=20 fresh-tail file by header signature."""
    candidates = sorted(glob.glob(K20_TAIL_GLOB), key=lambda p: Path(p).stat().st_mtime, reverse=True)
    for p in candidates:
        path = Path(p)
        if path.name.endswith(".part-live.jsonl") or path.name.endswith(".part-live.jsonl.done"):
            continue
        if "k5-snapshot" in path.name:
            continue
        try:
            with open(path) as f:
                first = f.readline()
                if not first:
                    continue
                h = json.loads(first)
                if (
                    h.get("type") == "header"
                    and h.get("k_max") == KMAX
                    and h.get("corpus_size") == EXPECTED_NEVER_K5
                    and h.get("attacker_model") == "openai:gpt-5.4"
                    and h.get("guardrail_model") == "gemini:gemini-2.5-flash"
                ):
                    return path
        except (json.JSONDecodeError, OSError):
            continue
    raise RuntimeError(
        f"No K=20 tail file found matching header (k_max={KMAX}, "
        f"corpus_size={EXPECTED_NEVER_K5}, attacker=openai:gpt-5.4, "
        f"guardrail=gemini:gemini-2.5-flash) in {RUNS_DIR}"
    )


def main() -> int:
    actual_k5_sha = sha256(K5_SNAPSHOT)
    if actual_k5_sha != EXPECTED_K5_SHA:
        print(
            f"FATAL: K=5 snapshot SHA mismatch.\n  expected: {EXPECTED_K5_SHA}\n  actual:   {actual_k5_sha}",
            file=sys.stderr,
        )
        return 2

    k5_header, k5_rows, _ = load_run(K5_SNAPSHOT)
    assert k5_header["k_max"] == 5, k5_header
    assert k5_header["guardrail_model"] == "gemini:gemini-2.5-flash", k5_header
    assert k5_header["attacker_model"] == "openai:gpt-5.4", k5_header
    assert len(k5_rows) == EXPECTED_TOTAL, (len(k5_rows), EXPECTED_TOTAL)

    k20_path = find_k20_tail()
    k20_sha = sha256(k20_path)
    k20_header, k20_rows, _ = load_run(k20_path)
    assert k20_header["k_max"] == KMAX
    assert k20_header["guardrail_model"] == "gemini:gemini-2.5-flash"
    assert k20_header["attacker_model"] == "openai:gpt-5.4"
    assert len(k20_rows) == EXPECTED_NEVER_K5, (len(k20_rows), EXPECTED_NEVER_K5)

    k20_by_id = {r["payload_id"]: r for r in k20_rows}

    merged: list[dict] = []
    used_snapshot = 0
    used_tail = 0
    for r5 in k5_rows:
        pid = r5["payload_id"]
        if r5["bypass_at_k"] is not None:
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
            r20 = k20_by_id.get(pid)
            if r20 is None:
                merged.append(
                    {
                        "payload_id": pid,
                        "category": r5["category"],
                        "bypass_at_k": None,
                        "source": "missing_k20_tail",
                    }
                )
            else:
                merged.append(
                    {
                        "payload_id": pid,
                        "category": r20["category"],
                        "bypass_at_k": r20["bypass_at_k"],
                        "source": "k20_tail_fresh",
                    }
                )
                used_tail += 1

    total = len(merged)
    cumulative: dict[int, dict] = {}
    for k in range(1, KMAX + 1):
        cnt = sum(
            1 for m in merged if m["bypass_at_k"] is not None and m["bypass_at_k"] <= k
        )
        cumulative[k] = {"count": cnt, "rate": cnt / total if total > 0 else 0.0}
    never = sum(1 for m in merged if m["bypass_at_k"] is None)

    # Per-cat
    per_cat: dict[str, dict] = {}
    cats = sorted({m["category"] for m in merged})
    for cat in cats:
        sub = [m for m in merged if m["category"] == cat]
        sub_n = len(sub)
        sub_cum = {}
        for k in range(1, KMAX + 1):
            c = sum(1 for m in sub if m["bypass_at_k"] is not None and m["bypass_at_k"] <= k)
            sub_cum[k] = {"count": c, "rate": c / sub_n if sub_n > 0 else 0.0}
        per_cat[cat] = {
            "total": sub_n,
            "bypass_at_k_cumulative": sub_cum,
            "never_bypassed_at_kmax": sum(1 for m in sub if m["bypass_at_k"] is None),
        }

    out = {
        "type": "flash_gpt_merged_cumulative",
        "guardrail_model": "gemini:gemini-2.5-flash",
        "attacker_model": "openai:gpt-5.4",
        "threat_model": "whitebox-no-feedback",
        "k_max": KMAX,
        "total_payloads": total,
        "merge_method": (
            "K=5 snapshot bypass_at_k for already-bypassed (274 rows); "
            "K=20 fresh-tail run for never-at-K=5 (195 rows). Same merge "
            "logic as merge-pro-gpt-cumulative.py."
        ),
        "input_files": {
            "k5_snapshot": {
                "path": str(K5_SNAPSHOT.relative_to(REPO_ROOT)),
                "sha256": EXPECTED_K5_SHA,
                "rows": len(k5_rows),
            },
            "k20_tail": {
                "path": str(k20_path.relative_to(REPO_ROOT)),
                "sha256": k20_sha,
                "rows": len(k20_rows),
            },
        },
        "merge_provenance": {
            "from_k5_snapshot": used_snapshot,
            "from_k20_tail": used_tail,
        },
        "bypass_at_k_cumulative": cumulative,
        "never_bypassed_at_kmax": never,
        "per_category": per_cat,
        "rows": merged,
    }

    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote: {OUT_FILE}")
    print()
    print(f"K=5 snapshot:    {used_snapshot} bypassed rows kept verbatim")
    print(f"K=20 tail run:   {used_tail} never-at-K=5 rows extended")
    print(f"Total:           {total}")
    print()
    print("Cumulative Bypass@K (full corpus N=469):")
    for k in range(1, KMAX + 1):
        v = cumulative[k]
        print(f"  K={k:>2}: {v['count']:>3}/{total} = {v['rate']*100:5.1f}%")
    print(f"  Never@K=20: {never}/{total} = {never/total*100:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
