#!/usr/bin/env python3
"""
Corpus Diversity Audit (paper §3.2)
====================================

Implements the *semantic-clustering audit* described in §3.2 of the pop-pay
NeurIPS 2026 paper:

    "we embedded all curated variants with a fixed sentence-encoder, ran
     k-means at k=|seeds| within each category, and rejected the corpus
     state if any single cluster contained >40% of the variants under that
     category."

This script audits the locked corpus at
`tests/redteam/corpus/attacks.json` against the 40% threshold.

Methodology
-----------
1. Load all 585 curated payloads from attacks.json.
2. Group by `category` (A-K, 11 categories).
3. For each category:
   - Embed the `reasoning` field using a fixed sentence-encoder
     (sentence-transformers/all-MiniLM-L6-v2; deterministic, light weight).
   - Run k-means with k = number of unique `variant_tags` observed in that
     category. The set of distinct variant_tags is the on-disk record of
     which seed strategies were instantiated for the category, so
     |unique variant_tags| serves as the |seeds| proxy required by §3.2.
     This proxy is documented here so reviewers can audit the choice.
   - Compute max cluster size as a percentage of the category's payload count.
   - Pass iff max cluster percentage <= 40%.
4. Emit `results.json` (machine-readable) and `per-category-clusters.txt`
   (human-readable, with the top variant_tags per cluster centroid).

Reproducibility
---------------
- random_state = 42 for k-means (n_init=10).
- Embedding model is fixed (`all-MiniLM-L6-v2`).
- Library versions are recorded in results.json under `environment`.
- Fallback: if sentence-transformers cannot be imported, the script falls
  back to scikit-learn TfidfVectorizer (recorded as embedding_method in
  results.json so a reviewer can see which path executed). The fallback is
  documented in README.md §Methodology.

Usage
-----
    pip install sentence-transformers scikit-learn numpy
    python audit-script.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import sklearn
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer

RANDOM_STATE = 42
THRESHOLD_PCT = 40.0  # paper §3.2: reject if any cluster contains >40%
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

HERE = Path(__file__).resolve().parent
CORPUS_PATH = (
    HERE.parent.parent / "tests" / "redteam" / "corpus" / "attacks.json"
)
RESULTS_JSON = HERE / "results.json"
CLUSTERS_TXT = HERE / "per-category-clusters.txt"


def load_corpus(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def embed(texts: list[str]) -> tuple[np.ndarray, str, dict]:
    """Embed `texts`. Prefer sentence-transformers; fall back to TF-IDF.

    Returns (matrix, method_label, version_dict).
    """
    versions: dict = {}
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        import sentence_transformers as st  # type: ignore

        model = SentenceTransformer(EMBEDDING_MODEL)
        # convert_to_numpy=True; batch encode is deterministic for fixed weights
        emb = model.encode(
            texts,
            convert_to_numpy=True,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        versions["sentence_transformers"] = st.__version__
        return emb.astype(np.float32), f"sentence-transformers:{EMBEDDING_MODEL}", versions
    except Exception as exc:  # pragma: no cover - documented fallback
        # Fallback path: deterministic TF-IDF.
        vec = TfidfVectorizer(
            lowercase=True,
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=1,
        )
        emb = vec.fit_transform(texts).astype(np.float32).toarray()
        versions["sentence_transformers"] = f"unavailable ({exc.__class__.__name__})"
        return emb, "tfidf-char-wb-3-5 (fallback)", versions


def audit_category(
    cat: str,
    payloads: list[dict],
    embeddings: np.ndarray,
) -> dict:
    n = len(payloads)
    unique_tags: set[str] = set()
    for p in payloads:
        for t in p.get("variant_tags", []) or []:
            unique_tags.add(t)
    k = max(2, len(unique_tags))  # KMeans requires k >= 2
    if k > n:
        k = n  # degenerate guard; never triggers on this corpus

    km = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
    labels = km.fit_predict(embeddings)
    sizes = Counter(labels.tolist())
    size_list = sorted(sizes.values(), reverse=True)
    max_cluster_pct = 100.0 * size_list[0] / n

    # For each cluster, list top variant_tags by frequency.
    cluster_top_tags: dict[int, list[tuple[str, int]]] = {}
    cluster_examples: dict[int, list[str]] = {}
    for cid in range(k):
        idxs = [i for i, lbl in enumerate(labels) if lbl == cid]
        tag_counter: Counter = Counter()
        for i in idxs:
            for t in payloads[i].get("variant_tags", []) or []:
                tag_counter[t] += 1
        cluster_top_tags[cid] = tag_counter.most_common(5)
        cluster_examples[cid] = [
            payloads[i].get("reasoning", "")[:120] for i in idxs[:3]
        ]

    return {
        "category": cat,
        "n_payloads": n,
        "k": k,
        "unique_variant_tags": sorted(unique_tags),
        "cluster_sizes": size_list,
        "max_cluster_size": size_list[0],
        "max_cluster_pct": round(max_cluster_pct, 2),
        "threshold_pct": THRESHOLD_PCT,
        "pass": max_cluster_pct <= THRESHOLD_PCT,
        "cluster_top_tags": {
            str(cid): tags for cid, tags in cluster_top_tags.items()
        },
        "cluster_examples": {
            str(cid): exs for cid, exs in cluster_examples.items()
        },
    }


def main() -> int:
    if not CORPUS_PATH.exists():
        print(f"ERROR: corpus not found at {CORPUS_PATH}", file=sys.stderr)
        return 2

    corpus = load_corpus(CORPUS_PATH)
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for p in corpus:
        by_cat[p["category"]].append(p)

    # Embed *all* reasoning text once (deterministic, single model load).
    all_texts = [p.get("reasoning", "") or "" for p in corpus]
    matrix, method, versions = embed(all_texts)

    # Build per-category embedding views.
    index_by_cat: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(corpus):
        index_by_cat[p["category"]].append(i)

    per_cat_results = []
    for cat in sorted(by_cat.keys()):
        idxs = index_by_cat[cat]
        emb = matrix[idxs]
        result = audit_category(cat, by_cat[cat], emb)
        per_cat_results.append(result)

    overall_pass = all(r["pass"] for r in per_cat_results)

    out = {
        "paper_section": "§3.2 — Corpus diversity audit",
        "threshold_pct": THRESHOLD_PCT,
        "embedding_method": method,
        "k_choice": "k = number of unique variant_tags within the category (proxy for |seeds|)",
        "random_state": RANDOM_STATE,
        "corpus_path": str(CORPUS_PATH.relative_to(HERE.parent.parent)),
        "n_payloads_total": len(corpus),
        "n_categories": len(per_cat_results),
        "overall_pass": overall_pass,
        "per_category": per_cat_results,
        "environment": {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "scikit_learn": sklearn.__version__,
            **versions,
        },
    }

    with RESULTS_JSON.open("w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)

    # Human-readable summary.
    lines: list[str] = []
    lines.append("Corpus Diversity Audit — per-category clusters")
    lines.append("=" * 60)
    lines.append(f"Corpus: {CORPUS_PATH}")
    lines.append(f"Embedding: {method}")
    lines.append(f"Threshold: max cluster <= {THRESHOLD_PCT}% (paper §3.2)")
    lines.append(f"Overall: {'PASS' if overall_pass else 'FAIL'}")
    lines.append("")
    for r in per_cat_results:
        verdict = "PASS" if r["pass"] else "FAIL"
        lines.append(
            f"Category {r['category']}: n={r['n_payloads']}, k={r['k']}, "
            f"max_cluster={r['max_cluster_size']} ({r['max_cluster_pct']}%) "
            f"[{verdict}]"
        )
        lines.append(f"  cluster sizes: {r['cluster_sizes']}")
        for cid_str, tags in r["cluster_top_tags"].items():
            tag_str = ", ".join(f"{t}×{c}" for t, c in tags) if tags else "(no tags)"
            lines.append(f"  cluster {cid_str}: {tag_str}")
        lines.append("")

    with CLUSTERS_TXT.open("w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    # Print short summary for CLI.
    print(f"Embedding: {method}")
    print(f"Overall: {'PASS' if overall_pass else 'FAIL'}")
    for r in per_cat_results:
        verdict = "PASS" if r["pass"] else "FAIL"
        print(
            f"  {r['category']}: n={r['n_payloads']}, k={r['k']}, "
            f"max_cluster_pct={r['max_cluster_pct']}% [{verdict}]"
        )
    print(f"\nWrote {RESULTS_JSON.name} and {CLUSTERS_TXT.name}")
    return 0 if overall_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
