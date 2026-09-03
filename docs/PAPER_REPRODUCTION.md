# Paper Reproduction Guide

Reproduction guide for the dataset and methodology described in **"The Illusion of Single-Attacker Rankings: A Cross-Vendor Attacker-Stability Methodology and Bypass@K Benchmark for Agentic Payment Guardrails"** (NeurIPS 2026 E&D Track submission).

This document walks reviewers and researchers from a fresh clone to fully regenerated headline tables, then to a re-collected dataset from scratch.

---

## 1. Paper context

The paper introduces:

1. A **585-payload red-team corpus** for payment-guardrail middleware, partitioned into *LLM-Evaluatable* vs *Architectural Blindspot* attack vectors.
2. A **Bypass@K cumulative iterative-attacker metric** paired with a cross-vendor attacker-stability probe.
3. An **open-source L1+L2 reference architecture** (this repo) used to anchor the methodology end-to-end.

Headline empirical results (all conditional on the v3 prompt, the 585-payload corpus, and the attacker pool reported):

| Result | Range | Source |
|---|---|---|
| Static hybrid bypass on 9 LLM-Evaluatable categories | 13–32% | Tab.~`tab:aggregate` |
| Same-family Bypass@5 (Gemini-3.1-Pro attacker) | 52.7–72.3% | Tab.~`tab:bypassk` |
| Bypass@20 same-family | 64.8–75.1% | Tab.~`tab:bypassk` |
| Cross-family Sonnet swing (vs GPT-5.4 attacker) | +22.6pp | Tab.~`tab:cross-vendor`, Fig.~`fig:ranking-inversion` |

The cross-family swing on a single guardrail is, on its own, sufficient as an existence proof to refute the prevailing single-attacker evaluation paradigm.

---

## 2. Dataset structure

```
tests/redteam/
├── corpus/
│   ├── attacks.json            # 585 payloads, 11 categories (A–K)
│   ├── GENERATION.md           # Three-stage corpus generation protocol
│   └── schema.json             # Payload field schema
├── runs/
│   ├── MANIFEST.sha256         # Byte-level integrity index (84 entries)
│   ├── static/                 # Per-model static panel runs (N=5 repeats)
│   │   ├── *-anthropic-*.jsonl
│   │   ├── *-openai-*.jsonl
│   │   ├── *-gemini-*.jsonl
│   │   └── gemma4-merged-*.jsonl
│   ├── adaptive/               # Bypass@K adaptive attacker runs (see adaptive/README.md)
│   │   ├── 2026-04-28T19-50-* # PRIMARY (same-family Gemini-Pro attacker, 9-model panel; paper-cited)
│   │   ├── 2026-04-29T*       # Cross-vendor probe (GPT-5.4 / Opus-4.7 attackers; Tab cross-vendor)
│   │   ├── 2026-04-30T07-16-* # Cross-vendor probe + Nano K=20 tail extension
│   │   └── 2026-04-28T03-55-* # Pre-PRIMARY snapshots (superseded; not paper-cited)
│   ├── ablation/               # Prompt-sensitivity (v3 / strict / paranoid)
│   │   ├── strict-{model}.jsonl
│   │   └── paranoid-{model}.jsonl
│   ├── promptguard/            # Llama Prompt Guard 2 baseline (kept for completeness)
│   ├── iaa/                    # Inter-rater reliability (218-payload sample × 3 LLMs)
│   ├── holm_36pair.json        # Holm-Bonferroni 36-pair adjusted p-values
│   └── holm_36pair_summary.txt
└── scripts/                    # Run + analysis tooling
```

Corpus payload count by category:

| Cat | Count | Cat | Count | Cat | Count |
|---|---|---|---|---|---|
| A (Direct injection) | 60 | E (Amount manipulation) | 55 | I (Anomalous amount) | 35 |
| B (Vendor mismatch) | 85 | F (Trust escalation) | 45 | J (Hallucination loop) | 35 |
| C (Category drift) | 55 | G (Page-content injection) | 60 | K (Commerce-adjacent) | 45 |
| D (JSON injection) | 65 | H (TOCTOU redirect) | 45 | **Total** | **585** |

---

## 3. Croissant 1.0 metadata

`paper-artifacts/croissant.json` is the machine-readable dataset descriptor (MLCommons Croissant 1.0). It includes:

- **Core fields**: name, version, license (CC BY-SA 4.0), distribution with file-level SHA-256 pins, recordSet schema for the 11 payload fields.
- **Responsible AI fields** (12 fields): data collection, preprocessing, annotation, biases, sensitive information, social impact, intended uses, release-and-maintenance, and more.

Validate the file:

```bash
python3 -c "import json; json.load(open('paper-artifacts/croissant.json')); print('valid JSON')"
```

---

## 4. Reproduce headline tables (fast path, ~5 minutes)

The released JSONL run files contain all the row-level data; tables can be regenerated deterministically from them.

```bash
# Clone (no dependencies needed — Python stdlib only for table regen)
git clone https://github.com/akshay/hangpay.git
cd hangpay

# Verify byte-level integrity of run files
cd tests/redteam/runs
sha256sum -c MANIFEST.sha256
cd ../../..

# Regenerate the three headline tables from JSONL
python3 paper-artifacts/gen-tables.py --table all
```

Output: LaTeX-formatted Tab.~`tab:bypassk` (Bypass@K cumulative), Tab.~`tab:threat-ablation` (4-cell threat-model matrix on Flash), and Tab.~`tab:cross-vendor` (5-cell cross-family attacker probe).

**Tolerance bands**: numbers should match the paper to within ±0.1pp on point estimates and ±0.5pp on bootstrap CI bounds (10,000-resample seed=42). Divergence beyond these constitutes a reproducibility regression.

To regenerate the taxonomy figure:

```bash
pip install matplotlib adjustText
python3 paper-artifacts/gen-taxonomy-map.py
# Outputs paper-artifacts/taxonomy-map.pdf
```

---

## 5. Re-run from scratch (full data collection, ~24h compute)

For full re-collection (not needed for reviewer verification — released JSONLs are the canonical artifacts):

```bash
# Install Node + Python dependencies
npm ci
python3 -m venv .venv && source .venv/bin/activate
pip install -r tests/redteam/requirements.txt

# Set provider API keys (read by adapters via process.env / os.environ)
export HANGPAY_BENCH_ANTHROPIC_API_KEY=sk-ant-...
export HANGPAY_BENCH_OPENAI_API_KEY=sk-proj-...
export HANGPAY_BENCH_GOOGLE_API_KEY=AIza...
# Optional: local Gemma4 via Ollama
ollama pull gemma4:e2b-it-q4_K_M

# Static panel (N=5 repeats per payload, all 9 models, ~5h cloud)
npm run redteam:static

# Adaptive Bypass@K (K_max=20, PRIMARY whitebox-no-feedback)
npm run redteam:adaptive -- --k-max 20 --threat primary

# Prompt ablation (v3 / strict / paranoid on Cat E + F)
npm run redteam:ablation

# IAA (3 frontier LLMs as annotators on 218-payload stratified sample)
python3 tests/redteam/scripts/run_iaa.py
```

Expected wall times (per Run Manifest):
- Cloud sweep (8 cloud models × 585 × 5): ~5h
- Local Gemma4 (4-bit Q4_K_M, Apple M-series Metal GPU, concurrency 3): 18.2h
- Adaptive Bypass@K K_max=20: ~6h per (guardrail × attacker) cell

---

## 6. Statistical methodology

| Method | Where | Implementation |
|---|---|---|
| Payload-level percentile bootstrap 95% CIs | All headline aggregates | `paper-artifacts/gen-tables.py` (1000 resamples; 10,000 for selected cells; seed=42) |
| McNemar paired tests | Cross-vendor probe (Tab.~`tab:cross-vendor`) | per-payload bypass indicator pairs across attacker swap; 10-test family |
| Holm-Bonferroni FWER correction | Cross-vendor + per-category | `holm_36pair.json` (36-pair contrast family for per-cat); 10-test family for cross-vendor |
| Fleiss' κ + pairwise Cohen's κ | IAA (3-LLM annotator agreement) | `tests/redteam/scripts/run_iaa.py` (218-payload stratified sample) |

Reported per-category κ ranges from 0.17 (Cat F, semantically ambiguous trust escalation) to 1.0 (Cat G, architecturally distinctive page-content injection), mirroring the LLM-Evaluatable / Architectural-Blindspot partition.

---

## 7. JSONL row schema (data dictionary)

### Corpus payload (`corpus/attacks.json`)

Each entry is one attack payload:

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable payload identifier (e.g., `A-001`, `B-042`) |
| `category` | string | Attack category, one of A–K |
| `layer_target` | string | Defense layer the payload primarily targets (`L1` / `L2` / `architectural`) |
| `vendor` | string | Vendor/merchant name in the payment intent |
| `amount` | number | Payment amount (synthetic; no real card data) |
| `reasoning` | string | Agent's claimed reasoning string (the attack vector) |
| `page_url` | string | URL context (used by Cat G page-injection variants) |
| `allowed_categories` | string[] | Categories the agent is authorized to transact in |
| `expected` | string | Ground-truth verdict (`block` or `allow`) |
| `variant_tags` | string[] | Generation-time tags for diversity audit |
| `rationale` | string | Human-readable note on why this payload is an attack |

### Static run row (`runs/static/*.jsonl`)

First line is a header `{type: "header", ...}` with corpus_hash, model, n_runs_per_payload, generated_at. Subsequent lines are payload rows:

| Field | Type | Description |
|---|---|---|
| `payload_id` | string | Foreign key into `corpus/attacks.json` |
| `category` | string | Attack category |
| `expected` | string | Ground-truth verdict |
| `run_index` | int | 0..N-1 for the N=5 repeats |
| `layer1` | object | L1 deterministic verdict + reason |
| `layer2` | object | L2 LLM verdict + reason + raw response |
| `hybrid` | object | L1→L2 production-path final verdict |
| `full_mcp` | object | Full MCP guardrail (with optional scanners) |
| `toctou` | object | TOCTOU domain check result |
| `attribution` | object | Per-layer responsibility attribution |

### Adaptive run row (`runs/adaptive/*.jsonl`)

Header line documents `attacker_model`, `k_max`, `corpus_size`, `git_sha`, `filter` (intent-preservation filter config). Subsequent lines:

| Field | Type | Description |
|---|---|---|
| `payload_id` | string | Foreign key into corpus |
| `category` | string | Attack category |
| `bypass_at_k` | object | `{k: bool}` — first K at which the payload bypassed |
| `steps` | object[] | Per-K rewrite step: attacker prompt, rewrite, guardrail verdict, latency |

### MANIFEST.sha256

GNU `sha256sum`-format file: 64-char hex digest, two spaces, relative path. Verify with `sha256sum -c MANIFEST.sha256` from `tests/redteam/runs/`.

---

## 8. License + responsible disclosure

**Corpus**: CC BY-SA 4.0 — share-alike, attribution required.
**Harness** (TypeScript MCP server, Python analysis scripts): MIT.
**Croissant metadata**: CC BY-SA 4.0 (matches corpus).

**Responsible disclosure**: this corpus and harness target the authors' own open-source reference architecture (`hangpay`), not third-party production guardrails. The dual-use risk is addressed via:

- 90-day staged release for harness updates that materially expand attacker capability (multi-turn dialogue, fork-and-vote ensembling, context-stuffing rewrites).
- API-key scrubbing on all released artifacts.
- Optional opt-in advisory group of cooperating guardrail vendors.

A v2 PRIVATE canary corpus (100 payloads, GSM-1k / MMLU-Pro pattern) is committed for follow-on work to mitigate longitudinal contamination.

---

## 9. Anonymization note for reviewers (double-blind period)

This repository is the open-source reference architecture cited in the paper. The repository name and the GitHub organization are necessarily visible because the methodology is anchored to this implementation; per the NeurIPS 2026 E&D Track best-effort anonymization guideline for benchmarks built on existing public codebases, the repository URL is retained.

Reviewers are kindly asked to refrain from accessing the repository in a way that would identify the authors during the review period (e.g., do not check git commit histories tied to identifiable accounts, do not search for the repository owner's other projects).

The croissant.json metadata file is delivered both via OpenReview supplementary upload and committed to `paper-artifacts/` for redundancy.

---

## 10. Contact + filing issues

For reproduction questions: open a GitHub issue on this repository tagged `paper-reproduction`.

For responsible-disclosure of vulnerabilities discovered in third-party guardrails using this corpus or harness: do **not** open a public issue. Use the contact channel listed in the paper's **Responsible Disclosure** section after the double-blind review period.

For methodology clarifications during peer review: route via the OpenReview discussion thread for the paper.

