# Versioning Policy

This file documents the versioning strategy for the hangpay benchmark corpus, evaluation harness, and model adapters.

## Semantic versioning summary

We use SemVer 2.0 (`MAJOR.MINOR.PATCH`) for the harness package. The corpus has its own immutable-snapshot versioning scheme described below.

## Harness versioning (npm package)

| Bump | Trigger |
|---|---|
| **MAJOR** | Breaking API change (LLMAdapter interface change, JSONL schema change) |
| **MINOR** | New evaluation feature (new attacker mode, new metric, new threat model) |
| **PATCH** | Bug fixes, dependency updates that don't change benchmark numbers |

A MINOR or higher bump that affects benchmark numbers reproduction must update the prompt SHA in the README and the `hangpay --version` output.

## Corpus versioning (snapshot-based)

The benchmark corpus (`tests/redteam/corpus/attacks.json`) uses immutable snapshots identified by SHA-256 hash, not by version number. This is intentional: published benchmark numbers are tied to a specific corpus hash.

| Snapshot | SHA-256 | Released | Status |
|---|---|---|---|
| **v1.0** (NeurIPS 2026 submission) | `e1674ba698fe495c11d7d343f3a81fc680bd6139d61174e8641f0d3a53f4325e` | 2026-04 | **Frozen** for paper |
| v1.1 (planned post-submission) | TBD | TBD | Bug-fix only payload re-labeling, no new payloads |
| v2.0 (planned, with held-out partition) | TBD | TBD | Adds independently-authored 50-payload held-out test set |

## Adding a new corpus snapshot

1. Compute new SHA-256: `sha256sum tests/redteam/corpus/attacks.json`
2. Add row to the table above with date and status
3. Update `tests/redteam/runs/static/README.md` to point to the new snapshot
4. Tag the git commit `corpus-v1.X` (or v2.X for major)
5. Re-run benchmark on at least one model to verify numbers are reproducible

## Model adapter deprecation

Provider model IDs may be deprecated by the upstream provider (e.g., OpenAI sunsetting `gpt-5.4`). Our policy:

| Status | Action | When |
|---|---|---|
| **Provider sunsets model** | Adapter remains in repo, marked `@deprecated` in types | Indefinite |
| **Adapter incompatible with current provider API** | Adapter moved to `src/adapters/archive/` | Next MAJOR release |
| **Provider deprecates entire SDK** | Drop adapter, document in CHANGELOG | Same release as SDK drop |

Benchmark results for deprecated models remain in `tests/redteam/runs/static/archive/` indefinitely — the published paper numbers must remain reproducible from frozen artifacts.

## Reproducibility guarantee

A benchmark JSONL file with header `{"corpus_hash": "<X>", "git_sha": "<Y>"}` can be reproduced by:

1. Checking out git commit `<Y>`
2. Verifying corpus hash matches `<X>`
3. Running the harness with the same model ID and N=5 repeats
4. Comparing the resulting JSONL to the original (allowing for per-call LLM latency differences but expecting identical verdicts at temperature=0; see paper Limitations on temperature=0 ≠ deterministic)

We do not guarantee bitwise output reproduction (provider-side non-determinism is documented as a Limitation), but we do guarantee that the methodology is reproducible from these inputs.

## Changelog policy

All MAJOR and MINOR changes go in `CHANGELOG.md` with the following sections:
- **Breaking**: API or schema changes
- **Added**: New features
- **Changed**: Behavior changes (with before/after benchmark numbers if applicable)
- **Fixed**: Bug fixes
- **Deprecated**: Marked-for-removal items

PATCH changes may be combined into a single CHANGELOG entry per release.

