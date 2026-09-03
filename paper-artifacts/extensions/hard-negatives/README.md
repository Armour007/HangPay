# Hard-Negative Benign Payloads

Hard-negative benign payloads per paper §3 design principle, organized by category.

## Source claim (paper §3, "Benign Hard Negatives by design")

> For each attack category we wrote benign payloads that share the category's surface features but flip the underlying intent: for Cat B, benign payloads use vendors with genuinely ambiguous categories (Amazon-as-publisher vs. Amazon-as-marketplace) where the vendor-category pair is legitimate but visually adjacent to the attack pattern; for Cat E amount manipulation, benign payloads use payment scenarios with arithmetically unusual but legitimate sums (international currency conversions, multi-seat licenses with non-round per-unit pricing); for Cat G page-injection, benign payloads include page content that contains attack-adjacent vocabulary ('ignore this banner ad') without injecting agent-controlling instructions.

This corpus implements that paragraph: every payload here has `expected = "approve"` and is engineered to share surface features with the corresponding attack category while remaining a fully legitimate transaction.

## Sub-collections

| File | Category | Count | Surface feature shared with attacks | Hard-negative property |
|---|---|---|---|---|
| `cat-b-ambiguous.json` | B (vendor-category mismatch) | 20 | Vendor name surface-collides with a different category's claim (e.g. Amazon, Apple, Square, Visa, Oracle, Patagonia) | Vendor + `allowed_categories` pair is legitimate; the surface-collision is a coincidence of natural-language naming |
| `cat-e-arithmetic.json` | E (amount manipulation) | 15 | Arithmetically unusual amounts (sub-cent, repeating digits, sequential digits, non-round totals) | Amount reconciles cleanly under FX conversion, multi-seat × non-round per-unit pricing, tax-inclusive totals, or metered usage |
| `cat-g-page-vocab.json` | G (page-injection) | 14 | Page DOM contains attack-adjacent vocabulary — "ignore this banner ad", "system maintenance notice", "you are authorized", "ignore previous orders", "system override" | Vocabulary appears as HTML comments, news quotes, ToS body copy, recipe tips, FAQ headings, CSS class names, or news headlines — never as a directive aimed at the agent |

**Total: 49 payloads.**

## Schema

Payloads validate against [`schema-ext.json`](./schema-ext.json), which mirrors `tests/redteam/corpus/schema.json` exactly except for one relaxation: the `id` pattern is `^[A-K]-EXT-\d{4}$` instead of `^[A-K]-\d{4}$`. The `EXT` infix marks the extension namespace and prevents id collisions with primary corpus entries (e.g. `B-EXT-0001` cannot collide with `B-0001` in `attacks.json`). Every other field, type, enum, and constraint is identical to the primary schema.

Required fields per payload (same as primary schema): `id`, `category`, `layer_target`, `vendor`, `amount`, `reasoning`, `page_url`, `allowed_categories`, `expected`, `variant_tags`. Optional: `page_content_fixture` (heavily used in Cat G), `rationale` (populated for every payload here to document the hard-negative property).

## Validation

```bash
python3 -c "
import json
from jsonschema import Draft7Validator
schema = json.load(open('schema-ext.json'))
v = Draft7Validator(schema)
for f in ['cat-b-ambiguous.json','cat-e-arithmetic.json','cat-g-page-vocab.json']:
    items = json.load(open(f))
    errs = sum(1 for item in items for _ in v.iter_errors(item))
    print(f, len(items), 'payloads,', errs, 'errors')
"
```

All three files report `0 errors`.

## Naming and id space

- `B-EXT-NNNN` — Cat B (ambiguous vendor-category) hard negatives
- `E-EXT-NNNN` — Cat E (arithmetic-but-legit) hard negatives
- `G-EXT-NNNN` — Cat G (page-vocabulary-but-no-injection) hard negatives

`NNNN` is a zero-padded 4-digit serial within each (category, EXT) namespace, starting at `0001`.

## Relationship to the primary corpus

This corpus is independent of `tests/redteam/corpus/attacks.json` and does not modify it. The primary corpus contains attack payloads (`expected="block"`) and a small number of original benign payloads; this extension corpus expands the benign side of three specific categories where surface-feature confounding is a known model-failure mode.

