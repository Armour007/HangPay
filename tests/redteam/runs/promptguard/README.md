# PromptGuard2 Baseline Reproduction

Reproduces the Llama Prompt Guard 2 baseline comparison from Section 4.5 of the paper.

## Prerequisites

1. Python 3.10+
2. HuggingFace account with access to [meta-llama/Llama-Prompt-Guard-2-86M](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M) (gated model, requires Meta license agreement)

## Setup

```bash
cd hangpay-npm/tests/redteam

# Create virtualenv
python3 -m venv .venv-pg2
source .venv-pg2/bin/activate

# Install dependencies
pip install transformers torch huggingface_hub

# Authenticate with HuggingFace
huggingface-cli login --token <your-hf-token>
```

## Run

```bash
# Default: PromptGuard2-86M on Apple Silicon GPU
python3 scripts/run-promptguard.py

# On CPU (slower, ~2 min)
python3 scripts/run-promptguard.py --device cpu

# Alternative model (no HF gating required)
python3 scripts/run-promptguard.py --model protectai/deberta-v3-base-prompt-injection-v2
```

## Output

- `runs/promptguard/Llama-Prompt-Guard-2-86M.jsonl` — per-payload results
- `runs/promptguard/Llama-Prompt-Guard-2-86M-summary.json` — aggregate statistics

## Expected Results

PG2 detection rate: 5.8% (27/469 attack payloads), FPR: 0.0% (0/116 benign).

The script also prints a comparison table against the hangpay hybrid guardrail results (requires static/ JSONL files).

## What the Script Does

1. Reads `corpus/attacks.json` (585 payloads: 469 attack + 116 benign)
2. For each payload, feeds the `reasoning` field to PG2
3. PG2 classifies as BENIGN / INJECTION / JAILBREAK
4. INJECTION or JAILBREAK with score > 0.5 = "detected" (would block)
5. Computes per-category detection rate (denominator = attack payloads only)
6. Compares against hangpay hybrid bypass rates from static/ JSONL files

