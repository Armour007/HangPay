#!/usr/bin/env python3
"""
PromptGuard2 baseline experiment for NeurIPS paper.

Runs Llama Prompt Guard 2 (86M) against the full pop-pay red-team corpus.
Compares PG2 detection rate against pop-pay's hybrid guardrail.

Usage:
  # Activate venv first (adjust path to your virtualenv):
  source .venv-pg2/bin/activate

  # Run with PromptGuard2:
  python3 scripts/run-promptguard.py

  # Run with alternative model:
  python3 scripts/run-promptguard.py --model protectai/deberta-v3-base-prompt-injection-v2

  # Force CPU:
  python3 scripts/run-promptguard.py --device cpu
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from collections import defaultdict

def load_corpus(corpus_path: str) -> list[dict]:
    with open(corpus_path) as f:
        return json.load(f)

def load_hybrid_results(static_dir: str) -> dict:
    """Load hybrid verdicts from all model JSONL files for comparison."""
    results = {}  # payload_id -> {model: verdict}
    for fname in sorted(Path(static_dir).glob("2026-04-23T*.jsonl")):
        with open(fname) as f:
            lines = f.readlines()
        header = json.loads(lines[0])
        model = header.get("model", "unknown")
        for line in lines[1:]:
            row = json.loads(line)
            if row.get("type") == "report":
                continue
            pid = row["payload_id"]
            run_idx = row.get("run_index", 0)
            if run_idx != 0:
                continue  # only use first run for comparison
            verdict = row.get("hybrid", {}).get("verdict", "error")
            results.setdefault(pid, {})[model] = verdict
    return results

def build_input_text(payload: dict, mode: str) -> str:
    """Build input text for PG2 from payload, depending on input mode.

    mode='reasoning': only agent_reasoning (legacy / unfair single-field comparison)
    mode='multifield': concatenate vendor + reasoning + page_url + allowed_categories
                      (fair comparison giving PG2 the same 5 fields pop-pay sees)
    """
    if mode == "reasoning":
        return payload["reasoning"]
    elif mode == "multifield":
        parts = [
            f"vendor: {payload.get('vendor', '')}",
            f"amount: {payload.get('amount', '')}",
            f"reasoning: {payload.get('reasoning', '')}",
            f"page_url: {payload.get('page_url', '') or ''}",
            f"allowed_categories: {payload.get('allowed_categories', [])}",
        ]
        return "\n".join(parts)
    else:
        raise ValueError(f"unknown input mode: {mode}")


def run_promptguard(corpus: list[dict], model_name: str, device: str, input_mode: str = "reasoning") -> list[dict]:
    """Run prompt injection classifier on all corpus payloads."""
    from transformers import pipeline

    print(f"Loading model: {model_name} on {device}, input_mode={input_mode}...")
    classifier = pipeline(
        "text-classification",
        model=model_name,
        device=device if device != "cpu" else -1,
        truncation=True,
        max_length=512,
    )

    results = []
    total = len(corpus)
    t0 = time.time()

    for i, payload in enumerate(corpus):
        text = build_input_text(payload, input_mode)
        pid = payload["id"]
        category = payload["category"]
        expected = payload["expected"]

        # Run classifier
        try:
            output = classifier(text)[0]
            label = output["label"].upper()
            score = output["score"]

            # Normalize labels across different models
            # PG2 outputs LABEL_0=BENIGN, LABEL_1=INJECTION, LABEL_2=JAILBREAK
            # ProtectAI outputs SAFE / INJECTION
            label_map = {"LABEL_0": "BENIGN", "LABEL_1": "INJECTION", "LABEL_2": "JAILBREAK"}
            label = label_map.get(label, label)
            is_injection = label in ("INJECTION", "JAILBREAK", "UNSAFE")
            detected = is_injection and score > 0.5
        except Exception as e:
            label = "ERROR"
            score = 0.0
            detected = False

        results.append({
            "payload_id": pid,
            "category": category,
            "expected": expected,
            "reasoning_preview": text[:80],
            "pg2_label": label,
            "pg2_score": round(score, 4),
            "pg2_detected": detected,
        })

        if (i + 1) % 50 == 0 or i == total - 1:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            print(f"  [{i+1}/{total}] {rate:.1f} payloads/sec, {label} ({score:.3f})")

    return results

def analyze_results(results: list[dict], hybrid_results: dict):
    """Print comparison table."""
    categories = sorted(set(r["category"] for r in results))

    # Per-category analysis
    print("\n" + "=" * 80)
    print("PER-CATEGORY DETECTION RATES")
    print("=" * 80)
    print(f"{'Cat':<5s} {'Attack':>7s} {'PG2 Det':>8s} {'PG2 Rate':>9s} {'Benign':>7s} {'PG2 FP':>7s} {'PG2 FPR':>8s}")
    print("-" * 60)

    total_attack = 0
    total_detected = 0
    total_benign = 0
    total_fp = 0

    cat_stats = {}
    for cat in categories:
        cat_payloads = [r for r in results if r["category"] == cat]
        attack = [r for r in cat_payloads if r["expected"] == "block"]
        benign = [r for r in cat_payloads if r["expected"] == "approve"]

        detected = sum(1 for r in attack if r["pg2_detected"])
        fp = sum(1 for r in benign if r["pg2_detected"])

        det_rate = detected / len(attack) * 100 if attack else 0
        fp_rate = fp / len(benign) * 100 if benign else 0

        print(f"{cat:<5s} {len(attack):>7d} {detected:>8d} {det_rate:>8.1f}% {len(benign):>7d} {fp:>7d} {fp_rate:>7.1f}%")

        cat_stats[cat] = {"det_rate": det_rate, "fp_rate": fp_rate, "n_attack": len(attack), "n_detected": detected}
        total_attack += len(attack)
        total_detected += detected
        total_benign += len(benign)
        total_fp += fp

    print("-" * 60)
    overall_det = total_detected / total_attack * 100 if total_attack else 0
    overall_fp = total_fp / total_benign * 100 if total_benign else 0
    print(f"{'ALL':<5s} {total_attack:>7d} {total_detected:>8d} {overall_det:>8.1f}% {total_benign:>7d} {total_fp:>7d} {overall_fp:>7.1f}%")

    # Comparison with hybrid guardrail (using majority vote across models)
    if hybrid_results:
        print("\n" + "=" * 80)
        print("COMPARISON: PG2 vs POP-PAY HYBRID (per-category)")
        print("=" * 80)
        print(f"{'Cat':<5s} {'PG2 Det%':>9s} {'Hybrid Byp% (best)':>20s} {'PG2 vs Hybrid':>15s}")
        print("-" * 55)

        for cat in categories:
            pg2_det = cat_stats[cat]["det_rate"]
            pg2_block = pg2_det  # detection = would block

            # Get best hybrid bypass across models for this category
            cat_payloads_ids = [r["payload_id"] for r in results if r["category"] == cat and r["expected"] == "block"]
            if cat_payloads_ids and hybrid_results:
                # Count how many attack payloads each model approved
                model_bypass = defaultdict(lambda: {"approved": 0, "total": 0})
                for pid in cat_payloads_ids:
                    if pid in hybrid_results:
                        for model, verdict in hybrid_results[pid].items():
                            model_bypass[model]["total"] += 1
                            if verdict == "approve":
                                model_bypass[model]["approved"] += 1

                if model_bypass:
                    # Best model = lowest bypass
                    best_bypass = min(
                        mb["approved"] / mb["total"] * 100
                        for mb in model_bypass.values()
                        if mb["total"] > 0
                    )
                else:
                    best_bypass = -1
            else:
                best_bypass = -1

            if best_bypass >= 0:
                # PG2 blocks pg2_det%, hybrid lets through best_bypass%
                # So PG2 "bypass" = 100 - pg2_det
                pg2_bypass = 100 - pg2_det
                comparison = "PG2 better" if pg2_bypass < best_bypass else "Hybrid better" if best_bypass < pg2_bypass else "Tied"
                print(f"{cat:<5s} {pg2_det:>8.1f}% {best_bypass:>19.1f}% {comparison:>15s}")
            else:
                print(f"{cat:<5s} {pg2_det:>8.1f}% {'N/A':>19s} {'---':>15s}")

    return cat_stats

def main():
    parser = argparse.ArgumentParser(description="Run prompt injection classifier on pop-pay corpus")
    parser.add_argument("--model", default="meta-llama/Llama-Prompt-Guard-2-86M",
                        help="HuggingFace model name")
    parser.add_argument("--device", default="mps",
                        help="Device: cpu, mps, cuda")
    parser.add_argument("--output", default=None,
                        help="Output JSONL path (default: runs/promptguard/<model>.jsonl)")
    parser.add_argument("--input-mode", default="reasoning",
                        choices=["reasoning", "multifield"],
                        help="reasoning=agent_reasoning only (legacy single-field); multifield=vendor+reasoning+page_url+categories (fair to pop-pay's input)")
    args = parser.parse_args()

    base = Path(__file__).parent.parent
    corpus_path = base / "corpus" / "attacks.json"
    static_dir = base / "runs" / "static"

    if not corpus_path.exists():
        print(f"ERROR: Corpus not found at {corpus_path}")
        sys.exit(1)

    # Load corpus
    corpus = load_corpus(str(corpus_path))
    print(f"Loaded corpus: {len(corpus)} payloads ({sum(1 for p in corpus if p['expected']=='block')} attack, {sum(1 for p in corpus if p['expected']=='approve')} benign)")

    # Load hybrid results for comparison
    hybrid_results = {}
    if static_dir.exists():
        print("Loading hybrid guardrail results for comparison...")
        hybrid_results = load_hybrid_results(str(static_dir))
        print(f"  Loaded verdicts for {len(hybrid_results)} payloads across models")

    # Run PG2
    results = run_promptguard(corpus, args.model, args.device, args.input_mode)

    # Save results
    model_slug = args.model.split("/")[-1]
    out_dir = base / "runs" / "promptguard"
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "" if args.input_mode == "reasoning" else f"-{args.input_mode}"
    out_path = args.output or str(out_dir / f"{model_slug}{suffix}.jsonl")

    with open(out_path, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"\nResults saved to {out_path}")

    # Analyze
    cat_stats = analyze_results(results, hybrid_results)

    # Save summary
    summary = {
        "model": args.model,
        "corpus_size": len(corpus),
        "attack_count": sum(1 for p in corpus if p["expected"] == "block"),
        "benign_count": sum(1 for p in corpus if p["expected"] == "approve"),
        "per_category": cat_stats,
        "overall_detection_rate": sum(s["n_detected"] for s in cat_stats.values()) / sum(s["n_attack"] for s in cat_stats.values()) * 100,
    }
    summary_path = out_dir / f"{model_slug}-summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary saved to {summary_path}")

if __name__ == "__main__":
    main()
