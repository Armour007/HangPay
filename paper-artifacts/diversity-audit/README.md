# Corpus Diversity Audit (§3.2)

The audit described in paper §3.2; results documented here. Paper §3.2 states:

> "Second, a *semantic-clustering audit*: we embedded all curated variants
> with a fixed sentence-encoder, ran k-means at k=|seeds| within each
> category, and rejected the corpus state if any single cluster contained
> >40% of the variants under that category."

This artifact reproduces that audit against the locked corpus
(`tests/redteam/corpus/attacks.json`, 585 payloads across categories A–K)
and reports the per-category cluster distributions and pass/fail verdicts.

## Methodology

- **Input.** All 585 curated payloads from
  `tests/redteam/corpus/attacks.json`, grouped by `category` (A–K).
- **Embedding.** The `reasoning` field of each payload is embedded with the
  fixed sentence-encoder `sentence-transformers/all-MiniLM-L6-v2`
  (deterministic; light weight; widely available). Embeddings are
  L2-normalized at encode time.
- **k-means.** Within each category we run `sklearn.cluster.KMeans` with
  `random_state=42`, `n_init=10`, and **k = number of unique `variant_tags`
  observed in that category**. The set of distinct `variant_tags` is the
  on-disk record of which seed strategies were instantiated for the
  category, so |unique variant_tags| serves as the |seeds| proxy required
  by §3.2. (`k=2` is enforced as a floor; this floor is not exercised by
  the locked corpus, where the smallest k is 11.)
- **Threshold.** Per §3.2, the corpus state is rejected if any single
  cluster contains >40% of the category's payloads. We report
  `max_cluster_pct` per category and PASS iff `max_cluster_pct ≤ 40%`.
- **Embedding fallback.** If `sentence-transformers` cannot be imported,
  the script falls back to a deterministic
  `TfidfVectorizer(analyzer="char_wb", ngram_range=(3,5))`. The active
  embedding method is recorded in `results.json` under `embedding_method`
  so reviewers can confirm which path executed. The results reported in
  this README were produced with `sentence-transformers/all-MiniLM-L6-v2`.

## Results

All 11 categories pass the §3.2 threshold (max cluster ≤ 40%). Overall: **PASS**.

| Category | n   | k  | Max cluster % | Verdict |
|----------|-----|----|---------------|---------|
| A        | 60  | 11 | 20.00%        | PASS    |
| B        | 85  | 13 | 11.76%        | PASS    |
| C        | 55  | 17 | 12.73%        | PASS    |
| D        | 65  | 23 | 10.77%        | PASS    |
| E        | 55  | 16 | 14.55%        | PASS    |
| F        | 45  | 21 | 8.89%         | PASS    |
| G        | 60  | 23 | 10.00%        | PASS    |
| H        | 45  | 21 | 11.11%        | PASS    |
| I        | 35  | 21 | 11.43%        | PASS    |
| J        | 35  | 17 | 17.14%        | PASS    |
| K        | 45  | 21 | 13.33%        | PASS    |

Full per-cluster sizes and the top `variant_tags` per cluster are recorded
in `per-category-clusters.txt`; the machine-readable record (including
library versions, random state, and embedding method) is in
`results.json`.

## Reproduction

```bash
pip install sentence-transformers scikit-learn numpy
python audit-script.py
```

The script loads the corpus from `../../tests/redteam/corpus/attacks.json`,
performs the audit, and writes `results.json` and
`per-category-clusters.txt` next to itself. `random_state=42` and the
fixed embedding model make the run deterministic; library versions are
recorded under `environment` in `results.json`.

## Files

- `audit-script.py` — the audit implementation.
- `results.json` — machine-readable per-category results, environment, and verdict.
- `per-category-clusters.txt` — human-readable summary with per-cluster top `variant_tags`.

