#!/usr/bin/env python3
"""
build-nano-opus-tail-corpus.py — build the 51-payload tail corpus for
F5-Nano-Opus terminal-pause recovery.

Context: F5-Nano-Opus (gpt-5.4-nano guardrail × claude-opus-4-7
attacker, K=20, full 469 corpus) hit Anthropic credit_balance_too_low
at 418/469 rows on 2026-04-30T10:04:53.830Z. The checkTerminalError()
sentinel pattern caught it cleanly — partial-snapshot-418.jsonl frozen
immutable, no garbage retry rows.

Recovery plan (Path A, F5-Opus-Pro precedent): top up Anthropic + run
the uncovered 51-row tail under same config + merge snapshot+tail into
final cumulative curve.

This script:
1. Reads the 418-row immutable partial-snapshot
2. Collects covered PIDs
3. Reads attacks.json, filters to PIDs NOT in covered set
4. Asserts len(tail) == 51 (16 Cat J + 35 Cat K, by team-lead claim;
   we verify exact distribution at runtime)
5. Writes attacks-nano-opus-tail-51.json + .meta.txt provenance

Inputs (SHA-pinned):
  partial-snapshot-418: runs/adaptive/...partial-snapshot-418.jsonl
                        sha256 2c187e660f29a7fe18cb74db8f39431f66d6cb9ea606d312df71aa3aebb44404
  full corpus:          tests/redteam/corpus/attacks.json

Output:
  tests/redteam/corpus/attacks-nano-opus-tail-51.json
  tests/redteam/corpus/attacks-nano-opus-tail-51.json.meta.txt
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

PARTIAL_SNAPSHOT = (
    RUNS_DIR
    / "2026-04-30T07-16-54-003Z-openai_gpt-5.4-nano.partial-snapshot-418.jsonl"
)
EXPECTED_PARTIAL_SHA = (
    "2c187e660f29a7fe18cb74db8f39431f66d6cb9ea606d312df71aa3aebb44404"
)
FULL_CORPUS = CORPUS_DIR / "attacks.json"

OUT_CORPUS = CORPUS_DIR / "attacks-nano-opus-tail-51.json"
OUT_META = CORPUS_DIR / "attacks-nano-opus-tail-51.json.meta.txt"

EXPECTED_FULL_TOTAL = 469
EXPECTED_TAIL_TOTAL = 51


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not PARTIAL_SNAPSHOT.exists():
        print(f"FATAL: missing {PARTIAL_SNAPSHOT}", file=sys.stderr)
        return 2
    actual_sha = sha256(PARTIAL_SNAPSHOT)
    if actual_sha != EXPECTED_PARTIAL_SHA:
        print(
            f"FATAL: partial-snapshot SHA mismatch.\n  expected: {EXPECTED_PARTIAL_SHA}\n  actual:   {actual_sha}",
            file=sys.stderr,
        )
        return 2

    covered_pids: set[str] = set()
    with open(PARTIAL_SNAPSHOT) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("type") == "row":
                covered_pids.add(obj["payload_id"])

    if len(covered_pids) != 418:
        print(
            f"FATAL: expected 418 covered PIDs, got {len(covered_pids)}",
            file=sys.stderr,
        )
        return 2

    full_all = json.loads(FULL_CORPUS.read_text())
    # Full corpus contains both attacks (expected=block) and benigns
    # (expected=approve). Adaptive runs are attack-only; filter accordingly.
    full = [p for p in full_all if p.get("expected") == "block"]
    if not isinstance(full, list) or len(full) != EXPECTED_FULL_TOTAL:
        print(
            f"FATAL: full corpus attack-only expected {EXPECTED_FULL_TOTAL}-element list, got "
            f"{type(full).__name__} len={len(full) if isinstance(full, list) else 'N/A'} "
            f"(raw corpus total={len(full_all)})",
            file=sys.stderr,
        )
        return 2

    tail = [p for p in full if p["id"] not in covered_pids]
    if len(tail) != EXPECTED_TAIL_TOTAL:
        print(
            f"FATAL: expected tail of {EXPECTED_TAIL_TOTAL}, got {len(tail)}",
            file=sys.stderr,
        )
        return 2

    cat_dist = Counter(p.get("category", "?") for p in tail)
    OUT_CORPUS.write_text(json.dumps(tail, indent=2) + "\n")
    out_sha = sha256(OUT_CORPUS)

    full_sha = sha256(FULL_CORPUS)

    meta_lines = [
        "# attacks-nano-opus-tail-51.json — provenance",
        "",
        f"output_file:        {OUT_CORPUS.relative_to(REPO_ROOT)}",
        f"output_sha256:      {out_sha}",
        f"output_count:       {len(tail)}",
        "",
        "## Source files",
        f"partial_snapshot:   {PARTIAL_SNAPSHOT.relative_to(REPO_ROOT)}",
        f"partial_snapshot_sha256: {EXPECTED_PARTIAL_SHA}",
        f"full_corpus:        {FULL_CORPUS.relative_to(REPO_ROOT)}",
        f"full_corpus_sha256: {full_sha}",
        "",
        "## Filter criterion",
        "tail = full_corpus.id NOT IN partial_snapshot.payload_id",
        "(i.e., the 51 payloads uncovered when F5-Nano-Opus credit-balance",
        "TERMINAL pause hit at row 418/469 on 2026-04-30T10:04:53.830Z)",
        "",
        "## Category distribution",
    ]
    for cat in sorted(cat_dist):
        meta_lines.append(f"  {cat}: {cat_dist[cat]}")
    meta_lines.append("")
    meta_lines.append("## Use")
    meta_lines.append(
        "Dispatch as F5-Nano-Opus-Tail with --corpus="
        + str(OUT_CORPUS.relative_to(REPO_ROOT))
        + ","
    )
    meta_lines.append(
        "  same model/attacker/threat-model/kmax as F5-Nano-Opus parent."
    )
    meta_lines.append(
        "Merge: 418-snapshot rows + 51-tail rows = 469-row union for Tab 11 row 9."
    )

    OUT_META.write_text("\n".join(meta_lines) + "\n")

    print(f"wrote: {OUT_CORPUS}")
    print(f"  sha256: {out_sha}")
    print(f"  count:  {len(tail)}")
    print(f"wrote: {OUT_META}")
    print()
    print("Tail category distribution:")
    for cat in sorted(cat_dist):
        print(f"  {cat}: {cat_dist[cat]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
