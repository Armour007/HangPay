#!/usr/bin/env python3
"""
build-opus-final-tail-corpus.py — derive the F5-Opus-Pro-FinalTail
corpus by union-subtracting both prior Opus snapshots from the full
attack-only corpus. Produces the small (~28-payload) tail that still
needs Opus K=20 attempts after the second credit-balance pause.

Pipeline so far (chronological):
  1. F5-Opus-Pro              dispatched (PID 24211, 469 corpus, K=20)
  2. silent retries on credit_balance_too_low → killed at row 224
       → opus-partial-snapshot.jsonl   sha256 b8b40e0d...2394
       → 157 PURE / 67 CONTAMINATED in that file
  3. terminal-error patch landed (commit 7b74c28)
  4. F5-Opus-Pro-Rerun         dispatched (PID 29742, 312 corpus, K=20)
  5. patch exits cleanly on 2nd credit_balance event after 284 PURE rows
       → opus-rerun-snapshot.jsonl     sha256 18f76e2c...d964
       → 284 PURE / 0 CONTAMINATED (zero garbage thanks to patch)
  6. union of (157, 284) = 441 PIDs covered
  7. final tail = 469 attack-only - 441 = 28 (all Cat K, alphabetic stop)

Inputs (paths relative to pop-pay-npm/):
  SNAPSHOT_1    runs/adaptive/2026-04-29T18-14-36-899Z-…opus-partial-snapshot.jsonl
  SNAPSHOT_2    runs/adaptive/2026-04-29T18-58-29-824Z-…opus-rerun-snapshot.jsonl
  ATTACKS_JSON  corpus/attacks.json

Outputs:
  attacks-opus-final-tail-28.json
  attacks-opus-final-tail-28.meta.txt

Both inputs are SHA-pinned. Sanity assertion: tail must be exactly 28
attack-only payloads.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"
CORPUS_DIR = REPO_ROOT / "tests" / "redteam" / "corpus"

SNAPSHOT_1 = RUNS_DIR / (
    "2026-04-29T18-14-36-899Z-gemini_gemini-3.1-pro-preview.opus-partial-snapshot.jsonl"
)
SNAPSHOT_2 = RUNS_DIR / (
    "2026-04-29T18-58-29-824Z-gemini_gemini-3.1-pro-preview.opus-rerun-snapshot.jsonl"
)
ATTACKS_JSON = CORPUS_DIR / "attacks.json"
OUT_CORPUS = CORPUS_DIR / "attacks-opus-final-tail-28.json"
OUT_META = CORPUS_DIR / "attacks-opus-final-tail-28.meta.txt"

EXPECTED_SHA_1 = "b8b40e0d509b0e09a74101bc28dd3ec4558cad9c59ae9d093294817538bb2394"
EXPECTED_SHA_2 = "18f76e2ca9838c2888486f6f524f30d1cb48e519e6bb34ce372414924d85d964"

CREDIT_ERROR_PHRASE = "credit balance is too low"
EXPECTED_TAIL_COUNT = 28


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_pure_ids(path: Path) -> tuple[set[str], set[str], int]:
    """Return (pure_ids, contaminated_ids, total_rows)."""
    pure: set[str] = set()
    contam: set[str] = set()
    total = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("type") != "row":
                continue
            total += 1
            steps = obj.get("steps", [])
            has_credit_err = any(
                CREDIT_ERROR_PHRASE in str(s.get("reason", "")).lower()
                for s in steps
            )
            if has_credit_err:
                contam.add(obj["payload_id"])
            else:
                pure.add(obj["payload_id"])
    return pure, contam, total


def main() -> int:
    actual_1 = sha256(SNAPSHOT_1)
    actual_2 = sha256(SNAPSHOT_2)
    if actual_1 != EXPECTED_SHA_1:
        print(
            f"FATAL: snapshot 1 SHA mismatch.\n  expected: {EXPECTED_SHA_1}\n  actual:   {actual_1}",
            file=sys.stderr,
        )
        return 1
    if actual_2 != EXPECTED_SHA_2:
        print(
            f"FATAL: snapshot 2 SHA mismatch.\n  expected: {EXPECTED_SHA_2}\n  actual:   {actual_2}",
            file=sys.stderr,
        )
        return 1

    pure_1, contam_1, total_1 = collect_pure_ids(SNAPSHOT_1)
    pure_2, contam_2, total_2 = collect_pure_ids(SNAPSHOT_2)
    covered = pure_1 | pure_2

    with open(ATTACKS_JSON) as f:
        attacks = json.load(f)
    attack_only = [a for a in attacks if a.get("expected") == "block"]

    tail = [a for a in attack_only if a["id"] not in covered]

    if len(tail) != EXPECTED_TAIL_COUNT:
        print(
            f"FATAL: tail count mismatch.\n"
            f"  attack-only:    {len(attack_only)}\n"
            f"  pure_1:         {len(pure_1)}\n"
            f"  pure_2:         {len(pure_2)}\n"
            f"  union covered:  {len(covered)}\n"
            f"  expected tail:  {EXPECTED_TAIL_COUNT}\n"
            f"  actual tail:    {len(tail)}",
            file=sys.stderr,
        )
        return 1

    cat_dist = Counter(a["category"] for a in tail)

    OUT_CORPUS.write_text(json.dumps(tail, indent=2) + "\n")

    meta = (
        "attacks-opus-final-tail-28.json — F5-Opus-Pro-FinalTail corpus\n"
        "\n"
        "Sources (sha256-pinned):\n"
        f"  snapshot 1 (initial salvage):  {SNAPSHOT_1.relative_to(REPO_ROOT)}\n"
        f"    sha256: {EXPECTED_SHA_1}\n"
        f"    rows: {total_1}  PURE: {len(pure_1)}  CONTAMINATED: {len(contam_1)}\n"
        f"  snapshot 2 (rerun):            {SNAPSHOT_2.relative_to(REPO_ROOT)}\n"
        f"    sha256: {EXPECTED_SHA_2}\n"
        f"    rows: {total_2}  PURE: {len(pure_2)}  CONTAMINATED: {len(contam_2)}\n"
        "\n"
        "Filter:\n"
        "  Include attack-only payload_ids that appear in NEITHER snapshot's PURE set.\n"
        "\n"
        "Counts:\n"
        f"  attack-only corpus:    {len(attack_only)}\n"
        f"  union PURE coverage:   {len(covered)}\n"
        f"  final tail:            {len(tail)}\n"
        f"  category distribution: {dict(sorted(cat_dist.items()))}\n"
        "\n"
        "Used by: F5-Opus-Pro-FinalTail (commit-ledger.md).\n"
        "Generated: 2026-04-29 by eng-redteam-runner.\n"
    )
    OUT_META.write_text(meta)

    print(f"snapshot 1: rows={total_1} PURE={len(pure_1)} CONTAMINATED={len(contam_1)}")
    print(f"snapshot 2: rows={total_2} PURE={len(pure_2)} CONTAMINATED={len(contam_2)}")
    print(f"union PURE coverage: {len(covered)}")
    print(f"final tail size:     {len(tail)}")
    print(f"category dist:       {dict(sorted(cat_dist.items()))}")
    print(f"wrote: {OUT_CORPUS}")
    print(f"wrote: {OUT_META}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
