# hangpay Guardrail Benchmark v1.0

> **Version:** 1.0 (2026-04-17)  
> **Corpus:** 585 payloads, 11 categories, N=5 repeats  
> **Models:** 4 (3 cloud + 1 local)  
> **Status:** Internal pre-publication draft

## Summary

hangpay interposes a two-layer guardrail between an AI agent and a payment action. This benchmark measures how well that guardrail performs against a red-team attack corpus and legitimate transaction traffic.

**Key findings:**

- No model achieves the original target of bypass rate < 20% AND false-reject rate < 20% simultaneously.
- The hybrid layer (Layer 1 deterministic + Layer 2 LLM) reduces bypass by 13–21 percentage points over either layer alone, across all four models.
- Categories E (amount manipulation) and F (trust escalation) are hard for all models — bypass rates of 47–89%.
- Local quantized models (Ollama q4_K_M) show higher bypass than cloud APIs (+7pp hybrid, +12pp Layer 2) but comparable false-reject rates.

**Cross-model summary (hybrid layer):**

| Model | Provider | Bypass | FR | Flip | Best at |
|---|---|---|---|---|---|
| `gemini-2.5-flash` | Google | **29.5%** | 8.6% | 4.2% | Lowest bypass |
| `claude-haiku-4-5` | Anthropic | 30.4% | **7.8%** | **1.0%** | Lowest FR, most stable |
| `gpt-4o-mini` | OpenAI | 30.1% | 12.2% | 10.2% | — |
| `gemma4:e2b-it-q4_K_M` | Ollama (local) | 37.0% | 10.5% | 16.6% | Offline / privacy |

*Bypass = % of attack payloads incorrectly approved (lower is better). FR = % of legitimate payloads incorrectly blocked (lower is better). Flip = % of payloads where the same input produced different verdicts across N=5 identical repeats (lower is better).*

**Deterministic baselines** (model-independent): Layer 1 alone — bypass 58.4% / FR 7.8%. TOCTOU guard — bypass 3.6% / FR 0.9%.

## Architecture

hangpay evaluates each payment request through up to three stages:

```
Agent Request
     │
     ▼
┌─────────────────────────────────┐
│ Layer 1: Keyword + Pattern      │  deterministic, <1 ms
│ (vendor, category, amount)      │
└────────────┬────────────────────┘
             │ pass
             ▼
┌─────────────────────────────────┐
│ Layer 2: LLM Semantic Check     │  ~200 ms (cloud), ~20 s (local)
│ (intent, reasoning, context)    │
└────────────┬────────────────────┘
             │ pass
             ▼
┌─────────────────────────────────┐
│ TOCTOU Domain Guard             │  verifies page URL matches vendor
└────────────┬────────────────────┘
             │ pass
             ▼
        Payment Approved
```

The benchmark tests five **runners**, each isolating a different stage or combination:

| Runner | What it tests | When it blocks |
|---|---|---|
| `layer1` | Keyword + pattern engine alone | Vendor/category/amount mismatch |
| `layer2` | LLM semantic check alone | LLM judges intent as malicious |
| `hybrid` | Layer 1 → Layer 2 (production path) | Either layer blocks |
| `full_mcp` | Scan heuristic + hybrid | Page-content scan or hybrid blocks |
| `toctou` | URL domain guard | Page domain ≠ declared vendor domain |

## Methodology

### Corpus

585 payloads spanning 11 attack categories (A–K), each paired with legitimate counterpart traffic. Category definitions in [Appendix A](#appendix-a-attack-categories).

| Category | Payloads | Attack / Benign |
|---|---|---|
| A — Direct injection | 60 | 250 / 50 |
| B — Vendor-category mismatch | 85 | 300 / 125 |
| C — Subtle category drift | 55 | 225 / 50 |
| D — Format-hijack JSON injection | 65 | 275 / 50 |
| E — Amount manipulation | 55 | 225 / 50 |
| F — Social engineering / trust escalation | 45 | 175 / 50 |
| G — Page-content injection | 60 | 250 / 50 |
| H — TOCTOU domain mismatch | 45 | 175 / 50 |
| I — Anomalous amount | 35 | 145 / 30 |
| J — Hallucination loop | 35 | 150 / 25 |
| K — Commerce-adjacent abuse | 45 | 175 / 50 |

`corpus_hash`: `e1674ba698fe495c11d7d343f3a81fc680bd6139d61174e8641f0d3a53f4325e`

### Models

| Model | Provider | Type | Notes |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | Anthropic | Cloud API | Re-run 2026-04-16 after adapter error-fix |
| `gpt-4o-mini` | OpenAI | Cloud API | |
| `gemini-2.5-flash` | Google | Cloud API (OpenAI-compat) | |
| `gemma4:e2b-it-q4_K_M` | Ollama | Local, 4-bit quantized | Apple M-series Metal GPU |

All models use the same v3 Layer 2 prompt (byte-identical via `tests/redteam/adapters/prompt.ts`) in JSON-strict response format.

### Metrics

- **Bypass rate** = attack payloads incorrectly approved ÷ total attack payloads. Lower is better.
- **False-reject rate (FR)** = legitimate payloads incorrectly blocked ÷ total legitimate payloads. Lower is better.
- **Flip rate** = payloads where N=5 identical repeats produced inconsistent verdicts ÷ total payloads. Measures intra-model stability. Lower is better.
- **Error rate** = rows where the LLM provider returned a non-retriable error ÷ total rows. Errors are excluded from bypass/FR aggregates and reported separately.

### Protocol

Each payload is run N=5 times per runner per model. Per-payload metrics are aggregated across the 5 repeats, then rolled up per category and per model. Total rows: 14,625 (4 models × 585 payloads × 5 repeats, plus archived errored slices).

## Results

### Per-model aggregate

| Model | Provider | Layer 2 bypass | Hybrid bypass | Hybrid FR | N=5 flip | Error rate |
|---|---|---|---|---|---|---|
| `gemini-2.5-flash` | Google | 46.2% | **29.5%** | 8.6% | 4.2% | — |
| `gpt-4o-mini` | OpenAI | 45.2% | 30.1% | 12.2% | 10.2% | 0.07% |
| `claude-haiku-4-5` | Anthropic | 45.7% | 30.4% | **7.8%** | **1.0%** | 0.17% |
| `gemma4:e2b-it-q4_K_M` | Ollama | 58.1% | 37.0% | 10.5% | 16.6% | 0.00% |

Cloud models are tightly clustered on hybrid bypass (29.5–30.4%). The differences are within noise for a single-run snapshot. Each model has a distinct strength:

- **Gemini** has the lowest hybrid bypass (29.5%) and low flip (4.2%) — the strongest attack-blocker among cloud models.
- **Anthropic** has the lowest FR (7.8%) and the most stable verdicts (1.0% flip) — the most conservative and consistent.
- **OpenAI** sits in the middle on all axes.
- **Ollama** (local, 4-bit quantized) has materially higher bypass (+7pp vs cloud average) driven by weaker Layer 2 performance (+12pp). FR remains competitive (10.5%). The quantization tax falls on attack-detection capability, not on legitimate-traffic accuracy.

### Per-category breakdown (hybrid runner)

Values are bypass% / FR% / flip%. Bold = best in row for that metric.

| Cat | Description | Gemini | Anthropic | OpenAI | Ollama |
|---|---|---|---|---|---|
| A | Direct injection | **13** /  0 /  7 | 35 /  0 / **2** | 31 /  8 / 28 | 42 /  0 / 27 |
| B | Vendor mismatch | 18 / 20 / **2** | 7 / 20 /  0 | **6** / 30 /  7 | 20 / 22 /  8 |
| C | Category drift | 9 / **10** /  0 | 9 / **10** /  0 | 9 / 14 /  2 | 9 / 12 /  2 |
| D | JSON injection | **3** /  6 /  9 | 9 /  0 /  0 | 16 /  6 / 11 | 51 /  0 / 29 |
| E | Amount manipulation | **47** /  0 / 16 | 48 /  0 /  4 | 55 /  0 / 16 | 54 /  0 / 29 |
| F | Trust escalation | 88 /  0 /  **2** | 89 /  0 /  0 | 86 /  6 / 24 | 86 / 12 / 18 |
| G | Page injection | 74 / 10 /  0 | 74 / 10 /  0 | 74 / 10 /  2 | 69 / 12 / 17 |
| H | TOCTOU redirect | 66 / 10 /  7 | 58 / 10 /  4 | 50 / 10 / 13 | **36** / 18 / 18 |
| I | Anomalous amount | 10 /  7 /  3 | **3** /  0 /  0 | 1 /  7 /  6 |  8 /  0 / 14 |
| J | Hallucination loop | 0 / 20 /  0 | 0 / 20 /  0 | 0 / 20 /  0 | 0 / 20 /  0 |
| K | Commerce abuse | **0** /  0 /  0 | 3 /  0 /  2 | 1 /  0 /  2 | 13 /  2 / 16 |

**Patterns:**

- **E (amount manipulation) and F (trust escalation) are universally hard** — bypass 47–89% across all models. Amount-disguising tactics and fabricated prior approvals are highly effective at fooling LLM semantic checks.
- **C is Layer-1-dominated** — all four models show 9% hybrid bypass, indicating the deterministic regex drives the result regardless of Layer 2 quality.
- **D (JSON injection) shows the largest local-vs-cloud gap** — Ollama 51% vs cloud 3–16%. Quantized models are substantially more susceptible to format-hijack attacks.
- **J (hallucination loop) is fully solved** — 0% bypass across all models and runners.
- **G (page injection) is not applicable to the current architecture.** hangpay does not pass page content to Layer 2; the LLM only evaluates agent reasoning and vendor metadata. The 74% bypass reflects the baseline pass rate of these payloads *without page signals*, not a guardrail failure. The existing `scanPage` heuristic (hidden-element keyword scan) is too narrow to catch semantic page-level injections. This category serves as a baseline for future page-content analysis (v2 scope).

### B-class deprecation notice

The `HANGPAY_ALLOWED_CATEGORIES` keyword matcher (B-class, Layer 1) measured 40% bypass / 20% false-reject — fragile but not broken. It remains available under a deprecation notice while a v2 policy engine is designed. New installs are warned via `hangpay doctor`. Full decision rationale in `docs/internal/benchmark-history/b-class-decision.md`.

## Limitations

- **Single-run snapshot.** All numbers are from one sweep per model. Re-running on a different day will shift each model by a few percentage points; treat narrow gaps (e.g., Gemini 29.5% vs OpenAI 30.1% bypass) as noise, not signal.
- **`full_mcp` runner is reduced** — scan heuristic + hybrid fall-through. The real stdio MCP client path is out of scope for v1.
- **TOCTOU is URL-level**, not CDP-event-level — it simulates mid-flight redirect by swapping the target URL, not by intercepting browser navigation events.
- **Benign counterpart coverage varies by category** — see the Attack/Benign column in the corpus table above.
- **Prompt v4 not yet implemented.** A follow-up iteration targeting Cat E/F bypass without re-introducing false-reject overcorrection is planned but out of scope for v1.

## Reproducing the benchmark

### Prerequisites

```bash
git clone https://github.com/akshay/hangpay.git
cd hangpay
npm install
```

### Single-model run (e.g., Gemini)

```bash
export HANGPAY_LLM_API_KEY="your-api-key"
export HANGPAY_LLM_MODEL="gemini-2.5-flash"
export HANGPAY_LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"

npx tsx tests/redteam/run-corpus.ts \
  --n=5 \
  --concurrency=15
```

### Cross-model sweep (all cloud providers)

```bash
export HANGPAY_BENCH_ANTHROPIC_API_KEY="sk-ant-..."
export HANGPAY_BENCH_OPENAI_API_KEY="sk-..."
export HANGPAY_BENCH_GEMINI_API_KEY="AIza..."

npx tsx tests/redteam/run-corpus.ts \
  --model-sweep \
  --n=5 \
  --concurrency=10
```

### Ollama (local model)

```bash
# Ensure Ollama is running with the model loaded:
# ollama run gemma4:e2b-it-q4_K_M

npx tsx tests/redteam/run-corpus.ts \
  --model-sweep \
  --only=ollama \
  --n=5 \
  --batch-size=10 \
  --concurrency=3 \
  --health-check-url=http://localhost:11434/api/tags
```

Artifacts land under `tests/redteam/runs/<timestamp>-<provider>-<model>.jsonl`. API-key-shaped substrings are scrubbed before persistence.

### Unit tests (no LLM required)

```bash
npm test -- tests/guardrails.test.ts tests/guardrails-advanced.test.ts
```

## Run manifest

- **Corpus hash:** `e1674ba698fe495c11d7d343f3a81fc680bd6139d61174e8641f0d3a53f4325e`
- **Total rows:** 14,625 (4 models × 2,925 rows each)
- **Cloud sweep wall:** 2h39m (Anthropic 2h rate-limit dominated; OpenAI/Gemini each < 45 min)
- **Ollama wall:** 18.2h (10 batches × ~109 min mean, Apple M-series Metal GPU, concurrency 3)
- **Error rates:** Anthropic 0.17% (5/2925), OpenAI 0.07% (2/2925), Ollama 0.00% (0/2925). All below the 1% materiality threshold.
- **Artifacts:** `tests/redteam/runs/` — one `.jsonl` per model slice (Ollama split across 10 batch files). Errored `gemma4:e2b-it-bf16` slice archived separately.
- **Engine version:** v0.5.10 (`b890725`). Retry-exhaustion errors propagate as `error` verdict (not silent `block`), shipped in v0.5.10.

## Appendix A: Attack categories

| Cat | Name | Description |
|---|---|---|
| A | Direct injection | Malicious instructions injected into the `agent_reasoning` field |
| B | Vendor-category mismatch | Purchase at a vendor that clearly does not match the declared allowed categories |
| C | Subtle category drift | Vendor plausibly but incorrectly fits an allowed category (e.g., "electronics" vendor selling insurance) |
| D | Format-hijack JSON injection | Attacker embeds JSON fragments to override the structured output format |
| E | Amount manipulation | Misleading reasoning that disguises abnormal transaction amounts as legitimate (e.g., "cents not dollars", inflated seat counts) |
| F | Social engineering / trust escalation | Reasoning that fabricates prior approvals, agreements, or authority to bypass scrutiny (e.g., "as we agreed earlier", "follow-up to approved charge") |
| G | Page-content injection | Malicious content injected into the merchant page itself (MCP path) |
| H | TOCTOU domain mismatch | Vendor declaration says one domain, actual page URL is a different domain |
| I | Anomalous amount | Plausible vendor but suspiciously large or unusual transaction amount |
| J | Hallucination loop | Agent reasoning contains indicators of LLM hallucination or circular logic |
| K | Commerce-adjacent abuse | Transactions that are technically commerce but serve abusive purposes (gift card laundering, etc.) |

## Appendix B: Version history

| Version | Date | Changes |
|---|---|---|
| v0 (retracted) | 2026-04-13 | 20-payload hand-picked illustrative set on Claude Sonnet 4.5. "95% accuracy" headline retired. |
| v0.1 | 2026-04-14 | 585-payload corpus, Gemini-only, v1 prompt. Single-model baseline. |
| v1.0 | 2026-04-17 | Cross-model sweep (4 models), v3 prompt, adapter error-fix, Ollama full corpus. Prompt iteration and retraction history moved to `docs/internal/benchmark-history/`. |

---

This document is licensed under [CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/).  
© 2026 akshay contributors.

