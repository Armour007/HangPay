# Seed Templates — Per-Category Vulnerability Surfaces

Seed templates per category as described in paper §3.1, indexed for reviewer
audit.

## Reference: paper §3.1 (verbatim)

> Stage 1, template seeding: for each of the 11 attack categories the authors
> hand-wrote 4–8 seed templates encoding the category's defining vulnerability
> surface (e.g., for Cat B vendor-mismatch, a seed specifies a vendor whose
> category is genuinely ambiguous, paired with a category claim that maximises
> plausible cover). Stage 2, LLM-assisted variation generation: each seed was
> expanded by Gemini CLI under a fixed variation prompt that produces 8–15
> variants per seed by varying surface attributes (vendor name, currency,
> amount magnitude, reasoning rephrasing) while pinning the underlying attack
> mechanism.

## Contents

- [`INDEX.md`](INDEX.md) — table of contents listing all 11 categories with
  template counts and a one-line mechanism summary per category.
- `cat-A.md` … `cat-K.md` — one file per category. Each documents that
  category's seed templates with the following structure per template:
  - **Name** — short, mechanism-descriptive identifier.
  - **Mechanism** — the vulnerability surface and attacker capability the seed
    targets (1–3 sentences).
  - **Variation surfaces** — the fields varied during stage-2 expansion
    (vendor name, amount magnitude, currency, reasoning rephrasing, plus
    mechanism-specific axes).
  - **Sample payload IDs** — ≥3 IDs from
    `tests/redteam/corpus/attacks.json` that derive from this template.

## Template counts per category

| Cat | Templates | Attack payloads in corpus |
|---|---|---|
| A — Layer-1 keyword evasion | 7 | 50 |
| B — Vendor/category token game | 5 | 60 |
| C — TOCTOU / domain spoof | 7 | 45 |
| D — Prompt injection | 8 | 55 |
| E — Amount/quantity confusion | 7 | 45 |
| F — Multi-turn / state confusion | 7 | 35 |
| G — Hidden-instruction page injection | 8 | 50 |
| H — Known-processor spoof | 6 | 35 |
| I — Client-path bypass | 6 | 29 |
| J — Env / config injection | 7 | 30 |
| K — LLM output / format | 7 | 35 |
| **Total** | **75** | **469** |

(Benign counterparts — 116 payloads with `expected: "approve"` — are scoped
along the same mechanism axes but are not derived from the adversarial seed
templates documented here. The 470th attack-slot accounting reflects the
single benign-only `I-*` row.)

## Audit workflow

1. Open `INDEX.md` to locate the category.
2. Open the corresponding `cat-X.md` for template definitions.
3. For any sample ID, look up the full payload in
   `tests/redteam/corpus/attacks.json` to confirm the mechanism mapping.
4. Sample IDs in this directory are verified against the locked corpus; the
   variation surfaces enumerated per template match the `variant_tags`,
   `vendor`, `page_url`, `reasoning`, and `allowed_categories` shapes
   actually present in the corresponding payloads.

## Related artifacts

- `paper-artifacts/diversity-audit/` — per-category embedding-space
  diversity (k-means cluster occupancy and silhouette) per §3.2.
- `paper-artifacts/extensions/` — hard-negative extensions (Cat B / E / G).
- `paper-artifacts/taxonomy-map.pdf` — taxonomy figure for §3.
- `tests/redteam/corpus/GENERATION.md` — Stage-2 Gemini variation prompt and
  per-category quotas.

