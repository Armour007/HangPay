#!/usr/bin/env python3
"""
build-opus-rerun-corpus.py — derive the F5-Opus-Pro-Rerun corpus from
the killed-Opus partial snapshot.

Background: F5-Opus-Pro PID 24211 was killed at row 224 because the
attacker LLM silently retried 15 times on Anthropic
`credit_balance_too_low` errors, then recorded `verdict=error` for
each step and the loop kept marching through the corpus producing
garbage rows. Of the 224 rows written:
  - PURE (zero credit-error steps in reason)        → reusable as-is
  - CONTAMINATED (≥1 credit-error step in reason)   → must be re-run
  - NEVER ATTEMPTED (corpus N=469 minus 224 written)→ must be run

This script extracts PURE payload IDs from the snapshot, then writes a
filtered corpus containing every attack-only payload NOT in the PURE
set. Re-running with --corpus=<filtered> on the patched runner
(checkTerminalError() now exits cleanly on credit/auth errors)
produces clean K=20 data on the contaminated + untouched payloads.

Inputs:
  KILLED_SNAPSHOT (sha256-pinned; lives in runs/adaptive/)
  ATTACKS_JSON    (full corpus, 585 entries; 469 attack-only)

Outputs:
  attacks-opus-rerun-312.json     (filtered attack-only corpus, ~312)
  attacks-opus-rerun-312.meta.txt (provenance)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # pop-pay-npm/
RUNS_DIR = REPO_ROOT / "tests" / "redteam" / "runs" / "adaptive"
CORPUS_DIR = REPO_ROOT / "tests" / "redteam" / "corpus"

KILLED_SNAPSHOT = RUNS_DIR / (
    "2026-04-29T18-14-36-899Z-gemini_gemini-3.1-pro-preview.opus-partial-snapshot.jsonl"
)
ATTACKS_JSON = CORPUS_DIR / "attacks.json"
OUT_CORPUS = CORPUS_DIR / "attacks-opus-rerun-312.json"
OUT_META = CORPUS_DIR / "attacks-opus-rerun-312.meta.txt"

# SHA pin — fail loud if snapshot has been mutated.
EXPECTED_SNAPSHOT_SHA = "b8b40e0d509b0e09a74101bc28dd3ec4558cad9c59ae9d093294817538bb2394"

CREDIT_ERROR_PHRASE = "credit balance is too low"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    actual_sha = sha256(KILLED_SNAPSHOT)
    if actual_sha != EXPECTED_SNAPSHOT_SHA:
        print(
            f"FATAL: killed-Opus snapshot SHA mismatch.\n"
            f"  expected: {EXPECTED_SNAPSHOT_SHA}\n"
            f"  actual:   {actual_sha}\n"
            f"  path:     {KILLED_SNAPSHOT}",
            file=sys.stderr,
        )
        return 1

    pure_ids: set[str] = set()
    contaminated_ids: set[str] = set()
    snapshot_rows = 0

    with open(KILLED_SNAPSHOT) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("type") != "row":
                continue
            snapshot_rows += 1
            pid = obj["payload_id"]
            steps = obj.get("steps", [])
            has_credit_err = any(
                CREDIT_ERROR_PHRASE in str(s.get("reason", "")).lower()
                for s in steps
            )
            if has_credit_err:
                contaminated_ids.add(pid)
            else:
                pure_ids.add(pid)

    with open(ATTACKS_JSON) as f:
        attacks = json.load(f)

    attack_only = [a for a in attacks if a.get("expected") == "block"]
    rerun = [a for a in attack_only if a["id"] not in pure_ids]

    expected_rerun = len(attack_only) - len(pure_ids)
    if len(rerun) != expected_rerun:
        print(
            f"FATAL: rerun count mismatch.\n"
            f"  attack_only:     {len(attack_only)}\n"
            f"  pure_ids:        {len(pure_ids)}\n"
            f"  expected_rerun:  {expected_rerun}\n"
            f"  actual_rerun:    {len(rerun)}",
            file=sys.stderr,
        )
        return 1

    untouched = expected_rerun - len(contaminated_ids)

    OUT_CORPUS.write_text(json.dumps(rerun, indent=2) + "\n")

    meta = (
        "attacks-opus-rerun-312.json — F5-Opus-Pro-Rerun corpus\n"
        "\n"
        "Source (sha256-pinned):\n"
        f"  tests/redteam/runs/adaptive/{KILLED_SNAPSHOT.name}\n"
        f"  sha256: {EXPECTED_SNAPSHOT_SHA}\n"
        "\n"
        "Filter:\n"
        "  Exclude payload_ids where the killed-Opus snapshot contains a row\n"
        "  with zero credit_balance steps (\"PURE\" rows; the data is\n"
        "  reusable as-is and the rerun would only burn calls).\n"
        "  Include all other attack-only payload_ids:\n"
        "    - rows with >=1 credit_balance step (\"CONTAMINATED\")\n"
        "    - payload_ids the killed run never reached.\n"
        "\n"
        "Counts:\n"
        f"  attack-only corpus:        {len(attack_only)}\n"
        f"  killed-snapshot rows:      {snapshot_rows}\n"
        f"  PURE in snapshot:          {len(pure_ids)}\n"
        f"  CONTAMINATED in snapshot:  {len(contaminated_ids)}\n"
        f"  never attempted:           {untouched}\n"
        f"  rerun corpus size:         {len(rerun)}\n"
        "\n"
        "Sanity:\n"
        f"  rerun = attack_only - PURE = {len(attack_only)} - {len(pure_ids)} = {len(rerun)}\n"
        "\n"
        "Used by: F5-Opus-Pro-Rerun (commit-ledger.md).\n"
        "Generated: 2026-04-29 by eng-redteam-runner.\n"
    )
    OUT_META.write_text(meta)

    print(f"snapshot rows:       {snapshot_rows}")
    print(f"PURE payload_ids:    {len(pure_ids)}")
    print(f"CONTAMINATED:        {len(contaminated_ids)}")
    print(f"never attempted:     {untouched}")
    print(f"rerun corpus size:   {len(rerun)}")
    print(f"wrote: {OUT_CORPUS}")
    print(f"wrote: {OUT_META}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
