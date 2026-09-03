# v1→v2 Prompt Iteration: Stop Conditions and Retraction

*Moved from `docs/GUARDRAIL_BENCHMARK.md` — internal R&D process, not published in the benchmark report.*

## Stop conditions (internal design)

- **A:** FR < 20% AND bypass has not materially worsened → declare iteration complete, hand off to cross-model sweep
- **B:** 3 iterations with no meaningful FR drop → halt. Signals architectural, not prompt-level, issue

## Iteration results

| Iteration | System prompt | User prompt | gemini-2.5-flash hybrid bypass | hybrid FR | avg N=5 flip |
|---|---|---|---|---|---|
| v1 (baseline) | "strict security module" | "Approve ONLY if…" | 15.6% | 58.3% | 47.7% |
| v2 | unchanged | default-APPROVE + enumerated BLOCK signals | 0.3% | **100.0%** | 1.7% |
| v3 | "payment guardrail" (neutral) | few-shot (2 APPROVE + 2 BLOCK) + terse rules | 0.0% | 99.8% | 0.0% |

## Retraction (2026-04-15)

The v2 and v3 results above, and the previously declared Stop Condition B verdict ("gemini-2.5-flash architecturally unfit"), are **invalid and retracted**.

Root cause: Gemini's free-tier quota was exhausted across the v2 overnight run; the v3 run that followed found a flat-empty quota and 2923 of 2925 layer2 rows came back as "LLM Guardrail: max retries exceeded" — the model never evaluated anything. The engine's retry-exhaustion fallback (`[false, "..."]`) was scored as "block", producing a phantom 99.8% FR.

Re-run via the cross-model sweep (2026-04-15, fresh quota, same v3 prompt, same model, same JSON mode): hybrid bypass 29.5% / FR 8.6% / flip 4.2% — actually competitive with the best cloud models.

Engine bug: retry-exhaustion now propagates as `error` verdict, not silent `block`. Shipped in v0.5.10/v0.8.9.

Full retraction notes also in `prompt-iterations.md`.

## Prompt v4 status

v4 is a candidate for follow-up tuning to specifically lift Cat E/F bypass without re-introducing the FR overcorrection seen in v2/v3. Not yet implemented. Out of scope for v1 publish.

