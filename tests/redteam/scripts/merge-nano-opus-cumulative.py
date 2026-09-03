#!/usr/bin/env python3
"""
merge-nano-opus-cumulative.py — merge the F5-Nano-Opus 418-row partial
snapshot (terminated by Anthropic credit_balance_too_low at row 418/469
on 2026-04-30T10:04:53.830Z) with the F5-Nano-Opus-Tail 51-row tail
recovery run, producing the paper-ready Bypass@K=1..20 cumulative curve
across the full 469-row attack corpus.

Methodology (no-overlap union, 418 + 51 = 469):
  - The 418 PIDs in the partial snapshot were walked K=1..20 in the
    original run and have their bypass_at_k recorded.
  - The 51 PIDs in the tail were walked K=1..20 fresh under same config
    (gpt-5.4-nano guardrail × claude-opus-4-7 attacker, K=20,
    threat_model=whitebox-no-feedback, post-credit-rotation key) and
    have independent bypass_at_k.
  - The two PID sets are disjoint by construction (tail = corpus \\ snapshot).
  - For each of 469 PIDs we use bypass_at_k from whichever run covered it.

This is the SAME merge pattern as merge-pro-gpt-cumulative.py, except
F5-Pro had a K=5-bypassed-vs-never-at-K=5 split and F5-Nano-Opus has a
covered-vs-uncovered-by-credit-pause split. The aggregation logic is
identical: take the bypass_at_k from the run that covered each PID.

Inputs (SHA-pinned):
  partial-snapshot-418: runs/adaptive/...partial-snapshot-418.jsonl
                        sha256 2c187e660f29a7fe18cb74db8f39431f66d6cb9ea606d312df71aa3aebb44404
  tail run: resolved at runtime by header signature (k_max=20, corpus_size=51,
            attacker=anthropic:claude-opus-4-7, guardrail=openai:gpt-5.4-nano)

Output: runs/adaptive/nano-opus-cumulative-K20.json
"""
from __future__ import annotations

import glob
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"

PARTIAL_SNAPSHOT = (
    RUNS_DIR
    / "2026-04-30T07-16-54-003Z-openai_gpt-5.4-nano.partial-snapshot-418.jsonl"
)
EXPECTED_PARTIAL_SHA = (
    "2c187e660f29a7fe18cb74db8f39431f66d6cb9ea606d312df71aa3aebb44404"
)

TAIL_GLOB = str(RUNS_DIR / "*-openai_gpt-5.4-nano*.jsonl")
OUT_FILE = RUNS_DIR / "nano-opus-cumulative-K20.json"

KMAX = 20
EXPECTED_TOTAL = 469
EXPECTED_PARTIAL_ROWS = 418
EXPECTED_TAIL_ROWS = 51


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


def find_tail_run() -> Path:
    """Find the tail run by header signature."""
    candidates = sorted(
        glob.glob(TAIL_GLOB), key=lambda p: Path(p).stat().st_mtime, reverse=True
    )
    for p in candidates:
        path = Path(p)
        # Skip in-flight + smoke + partial-snapshot variants
        if path.name.endswith(".part-live.jsonl"):
            continue
        if path.name.endswith(".part-live.jsonl.done"):
            continue
        if "partial-snapshot" in path.name:
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
                    and h.get("corpus_size") == EXPECTED_TAIL_ROWS
                    and h.get("attacker_model") == "anthropic:claude-opus-4-7"
                    and h.get("guardrail_model") == "openai:gpt-5.4-nano"
                    and h.get("threat_model") == "whitebox-no-feedback"
                ):
                    return path
        except (json.JSONDecodeError, OSError):
            continue
    raise RuntimeError(
        f"No tail run file found matching header (k_max={KMAX}, "
        f"corpus_size={EXPECTED_TAIL_ROWS}, attacker=anthropic:claude-opus-4-7, "
        f"guardrail=openai:gpt-5.4-nano, threat_model=whitebox-no-feedback) in {RUNS_DIR}"
    )


def main() -> int:
    actual_partial_sha = sha256(PARTIAL_SNAPSHOT)
    if actual_partial_sha != EXPECTED_PARTIAL_SHA:
        print(
            f"FATAL: partial snapshot SHA mismatch.\n  expected: {EXPECTED_PARTIAL_SHA}\n  actual:   {actual_partial_sha}",
            file=sys.stderr,
        )
        return 2

    partial_header, partial_rows, _ = load_run(PARTIAL_SNAPSHOT)
    assert partial_header["k_max"] == KMAX, partial_header
    assert partial_header["guardrail_model"] == "openai:gpt-5.4-nano", partial_header
    assert partial_header["attacker_model"] == "anthropic:claude-opus-4-7", partial_header
    assert partial_header.get("threat_model") == "whitebox-no-feedback", partial_header
    assert len(partial_rows) == EXPECTED_PARTIAL_ROWS, (
        len(partial_rows),
        EXPECTED_PARTIAL_ROWS,
    )

    tail_path = find_tail_run()
    tail_sha = sha256(tail_path)
    tail_header, tail_rows, _ = load_run(tail_path)
    assert tail_header["k_max"] == KMAX
    assert tail_header["guardrail_model"] == "openai:gpt-5.4-nano"
    assert tail_header["attacker_model"] == "anthropic:claude-opus-4-7"
    assert tail_header["threat_model"] == "whitebox-no-feedback"
    assert len(tail_rows) == EXPECTED_TAIL_ROWS, (len(tail_rows), EXPECTED_TAIL_ROWS)

    partial_pids = {r["payload_id"] for r in partial_rows}
    tail_pids = {r["payload_id"] for r in tail_rows}
    overlap = partial_pids & tail_pids
    if overlap:
        print(
            f"FATAL: PID overlap between partial and tail (must be disjoint): "
            f"{len(overlap)} PIDs, e.g. {sorted(overlap)[:5]}",
            file=sys.stderr,
        )
        return 2
    union = partial_pids | tail_pids
    if len(union) != EXPECTED_TOTAL:
        print(
            f"FATAL: union={len(union)} != expected {EXPECTED_TOTAL}",
            file=sys.stderr,
        )
        return 2

    merged: list[dict] = []
    for r in partial_rows:
        merged.append(
            {
                "payload_id": r["payload_id"],
                "category": r["category"],
                "bypass_at_k": r["bypass_at_k"],
                "source": "partial_snapshot_418",
            }
        )
    for r in tail_rows:
        merged.append(
            {
                "payload_id": r["payload_id"],
                "category": r["category"],
                "bypass_at_k": r["bypass_at_k"],
                "source": "tail_recovery_51",
            }
        )

    total = len(merged)
    cumulative: dict[int, dict] = {}
    for k in range(1, KMAX + 1):
        cnt = sum(
            1
            for m in merged
            if m["bypass_at_k"] is not None and m["bypass_at_k"] <= k
        )
        cumulative[k] = {"count": cnt, "rate": cnt / total if total > 0 else 0.0}
    never = sum(1 for m in merged if m["bypass_at_k"] is None)

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
            sub_cum[k] = {"count": c, "rate": c / sub_n if sub_n > 0 else 0.0}
        per_cat[cat] = {
            "total": sub_n,
            "bypass_at_k_cumulative": sub_cum,
            "never_bypassed_at_kmax": sum(1 for m in sub if m["bypass_at_k"] is None),
        }

    out = {
        "type": "nano_opus_merged_cumulative",
        "guardrail_model": "openai:gpt-5.4-nano",
        "attacker_model": "anthropic:claude-opus-4-7",
        "threat_model": "whitebox-no-feedback",
        "k_max": KMAX,
        "total_payloads": total,
        "merge_method": (
            "418-row partial snapshot (covered before credit_balance_too_low "
            "TERMINAL pause at 2026-04-30T10:04:53.830Z) UNION 51-row tail "
            "recovery (uncovered subset, walked K=1..20 fresh post-top-up). "
            "Disjoint PID sets by construction; union == 469."
        ),
        "input_files": {
            "partial_snapshot_418": {
                "path": str(PARTIAL_SNAPSHOT.relative_to(REPO_ROOT)),
                "sha256": EXPECTED_PARTIAL_SHA,
                "rows": len(partial_rows),
            },
            "tail_recovery_51": {
                "path": str(tail_path.relative_to(REPO_ROOT)),
                "sha256": tail_sha,
                "rows": len(tail_rows),
            },
        },
        "merge_provenance": {
            "from_partial_snapshot": len(partial_rows),
            "from_tail_recovery": len(tail_rows),
            "pid_overlap": 0,
            "union_size": len(union),
        },
        "bypass_at_k_cumulative": cumulative,
        "never_bypassed_at_kmax": never,
        "per_category": per_cat,
        "rows": merged,
    }

    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote: {OUT_FILE}")
    print()
    print(f"partial snapshot: {len(partial_rows)} rows from {PARTIAL_SNAPSHOT.name}")
    print(f"tail recovery:    {len(tail_rows)} rows from {tail_path.name}")
    print(f"union (no overlap): {len(union)}")
    print()
    print("Cumulative Bypass@K (full corpus N=469):")
    for k in range(1, KMAX + 1):
        v = cumulative[k]
        print(f"  K={k:>2}: {v['count']:>3}/{total} = {v['rate']*100:5.1f}%")
    print(f"  Never@K=20: {never}/{total} = {never/total*100:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
