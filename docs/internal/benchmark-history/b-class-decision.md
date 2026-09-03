# B-Class Category Decision (S0.2a Internal)

*Moved from `docs/GUARDRAIL_BENCHMARK.md` — internal process document, not part of the published benchmark.*

## Context

`HANGPAY_ALLOWED_CATEGORIES` (B-class) is a Layer 1 keyword matcher that gates vendor-category mismatch. Before running the full v1 benchmark, we pre-registered thresholds to decide whether to keep, deprecate, or drop this matcher based on its measured performance.

## Pre-registered thresholds

| Decision | Criteria | Meaning |
|---|---|---|
| **Keep** | bypass ≤ 15% **AND** false-reject ≤ 10% | Matcher is robust enough to stay as-is. |
| **Keep-but-deprecated** | bypass in (15%, 50%) **OR** false-reject in (10%, 25%) | Matcher is fragile; stays available under a deprecation notice while a v2 policy model is designed in parallel. New installs warned via `hangpay doctor`. |
| **Drop** | bypass ≥ 50% **OR** false-reject ≥ 25% | Matcher gives a false sense of security; remove from Layer-1 critical path in next major version. |

*Keep* = strict conjunction (both numbers must be good). *Drop* triggers on either number being bad. *Keep-but-deprecated* is the middle band. Bypass rate is measured against Layer-1 only; hybrid-runner recovery is informational and does not change the decision.

## Result

- `bypass_rate_layer1` = 40.0%
- `false_reject_rate_layer1` = 20.0%
- **Decision: Keep-but-deprecated** — bypass 40.0% in (15%, 50%) AND false-reject 20.0% in (10%, 25%).

## Actions taken

1. Freeze B-class literal rules (no further tuning without v2 policy DSL)
2. Route through hybrid (Layer 2 arbitrates borderline cases)
3. NFKC + homograph normalization queued as S1.2 candidate

> **Correction (Fix 8, 2026-04-16).** Earlier drafts of the related internal spec referenced a 4-bucket variant. The 3-bucket matrix above is authoritative.

