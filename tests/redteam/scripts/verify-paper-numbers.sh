#!/usr/bin/env bash
#
# verify-paper-numbers.sh — CI hook: verify every SHA-256 literal in
# paper/main.tex against the on-disk file it's pinned to. Prevents
# the SHA-pin staleness pattern that R3 W1 caught (paper said
# `e1674ba6...` for the corpus, disk said `c3892e15...`; paper said
# `a8475a55...` for the prompt template, disk said `855699fa...`).
#
# Each SHA pin in the paper has a registered (sha, file) tuple below.
# When you add a new pin to main.tex, also add it here.
#
# Exits 0 on all-match. Exits 1 with diff list on any mismatch.
#
# Usage:
#   tests/redteam/scripts/verify-paper-numbers.sh
#
# CI integration suggestion: gate paper-touching PRs on this script.

set -uo pipefail

# Resolve repo root from script location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# Paper file lives in a sibling repo, not hangpay-npm. Path is fixed
# until paper repo location changes.
PAPER_FILE="${PAPER_FILE_OVERRIDE:-$(dirname "$REPO_ROOT")/paper/main.tex}"

if [[ ! -f "$PAPER_FILE" ]]; then
  echo "FATAL: paper file not found at $PAPER_FILE" >&2
  echo "       (override via PAPER_FILE_OVERRIDE env var if location differs)" >&2
  exit 2
fi

# (paper-mention, disk-file-path) pairs. The paper-mention is checked
# verbatim against grep on main.tex (i.e., the paper must contain this
# exact SHA). When you add a new pin to the paper, append the (sha,
# file) tuple here.
#
# Format: "<expected_sha>|<file_relative_to_REPO_ROOT>"
declare -a PINS=(
  # Corpus
  "c3892e15c4f9f9b1f837d7316b282edb2952d78c8e0bc89e8a409c8c4532d0b9|tests/redteam/corpus/attacks.json"
  # Layer-2 prompt template
  "855699fa656598a79b59fd2216d2f302ddca38e50226a8a911adcaee3c6678d6|src/engine/llm-guardrails.ts"
  # F5-Pro K=5 snapshot (cited in §sec:bypass-ablation Tab 11 footnote + RLHF para)
  "049fe78379b6b8afe182d9a6595d591a8662de34dadd96af383040d9a6a73ce3|tests/redteam/runs/adaptive/2026-04-29T09-31-35-759Z-gemini_gemini-3.1-pro-preview.k5-snapshot.jsonl"
  # F5-Pro-K20 fresh-subset (cited in §sec:bypass-ablation Tab 11 footnote + RLHF para)
  "edc34fdf9fbd7d9996bdd50a7409e92b01b61f59e2802b98175cb53b93af4242|tests/redteam/runs/adaptive/2026-04-29T16-31-15-287Z-gemini_gemini-3.1-pro-preview.jsonl"
  # F5-FlashGPT K=5 snapshot (cited in §sec:bypass-ablation Tab 11 row 5 footnote)
  "968b59cbd3c36f0df57ca11ee53b48f3169fccb382980c5b38284d26714dbf9e|tests/redteam/runs/adaptive/2026-04-28T04-06-24-307Z-gemini_gemini-2.5-flash.k5-snapshot.jsonl"
  # F5-FlashGPT-K20Tail final (cited in §sec:bypass-ablation Tab 11 row 5 footnote)
  "318b35710a0fdf322497e5ea8d7bd924e896cab30fdc7aab463a3273d2fd0192|tests/redteam/runs/adaptive/2026-04-30T07-16-54-003Z-gemini_gemini-2.5-flash.jsonl"
  # F5-Nano-Opus 418-row partial-snapshot (cited in §sec:bypass-ablation Tab 11 row 9 footnote)
  "2c187e660f29a7fe18cb74db8f39431f66d6cb9ea606d312df71aa3aebb44404|tests/redteam/runs/adaptive/2026-04-30T07-16-54-003Z-openai_gpt-5.4-nano.partial-snapshot-418.jsonl"
  # F5-Nano-Opus-Tail 51-row recovery (cited in §sec:bypass-ablation Tab 11 row 9 footnote)
  "394d5305071064e15c974e5100ff8341967b17e5738a6ace3e17cb3d588d10fe|tests/redteam/runs/adaptive/2026-04-30T16-35-58-644Z-openai_gpt-5.4-nano.jsonl"
)

declare -i fail=0
declare -i ok=0
echo "verify-paper-numbers.sh — checking ${#PINS[@]} SHA pins"
echo "  paper:    $PAPER_FILE"
echo "  repo root: $REPO_ROOT"
echo "----"

for pin in "${PINS[@]}"; do
  expected="${pin%%|*}"
  file_rel="${pin#*|}"
  file_abs="$REPO_ROOT/$file_rel"
  if [[ ! -f "$file_abs" ]]; then
    echo "FAIL [$file_rel]  file not found"
    fail=$((fail + 1))
    continue
  fi
  actual="$(shasum -a 256 "$file_abs" | awk '{print $1}')"
  # Verify paper mentions the expected SHA (full or 8-char prefix).
  expected_prefix="${expected:0:8}"
  paper_has_prefix=0
  if grep -q "$expected_prefix" "$PAPER_FILE"; then
    paper_has_prefix=1
  fi
  if [[ "$actual" == "$expected" ]]; then
    if [[ "$paper_has_prefix" == "1" ]]; then
      echo "OK   [$file_rel]  $expected_prefix... matches disk + paper"
      ok=$((ok + 1))
    else
      echo "WARN [$file_rel]  disk matches expected but paper does not mention $expected_prefix..."
      fail=$((fail + 1))
    fi
  else
    echo "FAIL [$file_rel]  expected $expected_prefix... actual ${actual:0:8}..."
    fail=$((fail + 1))
  fi
done

echo "----"
if [[ "$fail" -gt 0 ]]; then
  echo "verify-paper-numbers.sh: $fail FAIL / $ok OK"
  exit 1
fi
echo "verify-paper-numbers.sh: all $ok pins verified"
exit 0

