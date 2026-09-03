# Adaptive runs — family guide

The `adaptive/` directory contains JSONL outputs from the iterative-attacker (Bypass@K) pipeline. Files are grouped into three families distinguished by their attacker/guardrail configuration. The same UTC-timestamp prefix shared across multiple files in one family indicates a single pipeline invocation that fanned out across models.

## 1. PRIMARY — same-family (Gemini-3.1-Pro attacker), 9-model panel

**Family prefix**: `2026-04-28T19-50-*`

| File | Guardrail model |
|---|---|
| `2026-04-28T19-50-38-732Z-anthropic_claude-haiku-4-5-20251001.jsonl` | Claude Haiku 4.5 |
| `2026-04-28T19-50-38-732Z-anthropic_claude-sonnet-4-6.jsonl` | Claude Sonnet 4.6 |
| `2026-04-28T19-50-38-732Z-gemini_gemini-2.5-flash.jsonl` | Gemini 2.5 Flash |
| `2026-04-28T19-50-38-732Z-openai_gpt-5.4-mini-2026-03-17.jsonl` | GPT-5.4-mini |
| `2026-04-28T19-50-38-732Z-openai_gpt-5.4.jsonl` | GPT-5.4 |
| `2026-04-28T19-50-45-057Z-openai_gpt-5.4-nano.jsonl` | GPT-5.4-nano |
| `2026-04-28T19-50-46-477Z-gemini_gemini-3.1-pro-preview.jsonl` | Gemini 3.1 Pro Preview |
| `2026-04-28T19-50-46-486Z-gemini_gemini-3.1-flash-lite-preview.jsonl` | Gemini 3.1 Flash-Lite Preview |
| `2026-04-28T19-50-46-490Z-ollama_gemma4_e2b-it-q4_K_M.jsonl` | Gemma 4 (local 4-bit, Ollama) |

**This is the paper-canonical PRIMARY data** under the whitebox-no-feedback OSS-realistic threat model. Used to populate `tab:bypassk` (Bypass@K cumulative across 9 models). Pinned in `paper-artifacts/gen-tables.py` `PRIMARY_FILES` map.

## 2. Cross-vendor probe — alternative attacker families on selected guardrails

**Family prefixes**: `2026-04-29T*`, `2026-04-30T07-16-*`, `2026-04-30T16-35-*`

These swap the attacker family while holding each guardrail constant, generating the 5 cross-family cells reported in `tab:cross-vendor` and visualized in `fig:ranking-inversion` (the +22.6pp Sonnet swing existence proof).

| Cell (guardrail × attacker) | Anchor file family |
|---|---|
| Sonnet × GPT-5.4 attacker | `2026-04-29T18-14-*` |
| Pro guardrail × GPT-5.4 attacker | `2026-04-30T07-16-*` (Flash×GPT row) |
| Pro guardrail × Opus-4.7 attacker | `2026-04-29T18-14/20-42-*` |
| Flash × GPT-5.4 attacker | `2026-04-30T07-16-*` |
| Nano × Opus-4.7 attacker | `2026-04-30T07-16/16-35-*` (incl. K=20 tail extension) |

The Nano×Opus cell uses two pipeline phases — initial 418-row partial-snapshot then a 51-row K=20 tail recovery — to reach the K_max=20 endpoint on a slow-attacker pairing.

## 3. Pre-PRIMARY snapshots (superseded — kept for completeness only)

**Family prefixes**: `2026-04-28T03-55-*`, `2026-04-28T04-06-*`

Earlier same-day runs with the same configuration as PRIMARY (Gemini-Pro attacker, 9-model panel) that were superseded by the 19-50 family before the paper analysis. Kept in the repository to support audit of the run history; **not used by `gen-tables.py`** and **not referenced in the paper**. Reviewers verifying headline numbers should ignore these.

## Verification

All files in this directory are pinned in `tests/redteam/runs/MANIFEST.sha256`. Verify byte-level integrity from the runs root:

```bash
cd tests/redteam/runs
shasum -a 256 -c MANIFEST.sha256
```

To re-aggregate Bypass@K and cross-vendor tables from these JSONL inputs:

```bash
python3 paper-artifacts/gen-tables.py --table all
```

