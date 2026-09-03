#!/usr/bin/env python3
"""
Generate MANIFEST.sha256 covering all released JSONL artifacts in tests/redteam/runs/.

Usage: python3 tests/redteam/scripts/generate-manifest.py
Outputs: tests/redteam/runs/MANIFEST.sha256

Format: <sha256>  <relative-path-from-runs-dir>
Standard sha256sum output format.
"""
import hashlib
from pathlib import Path

RUNS_DIR = Path(__file__).resolve().parent.parent / "runs"
OUTPUT = RUNS_DIR / "MANIFEST.sha256"

entries = []
for path in sorted(RUNS_DIR.rglob("*.jsonl")):
    if "archive" in path.parts:
        continue  # skip superseded
    if "MANIFEST" in path.name:
        continue
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    rel = path.relative_to(RUNS_DIR)
    entries.append(f"{h.hexdigest()}  {rel}")

with open(OUTPUT, "w") as f:
    for line in entries:
        f.write(line + "\n")

print(f"Wrote {len(entries)} entries to {OUTPUT}")
print(f"Verify with: cd {RUNS_DIR} && sha256sum -c MANIFEST.sha256")
