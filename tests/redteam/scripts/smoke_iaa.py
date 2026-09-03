#!/usr/bin/env python3
"""Smoke-test each annotator with one payload before the full IAA run."""
import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_iaa import (
    load_and_sample,
    render_prompt,
    annotate_one,
    CLAUDE_MODEL,
    OPENAI_MODEL,
    GEMINI_MODEL,
)

samples = load_and_sample()
sample = samples[0]
prompt = render_prompt(sample)
print(f"[smoke] sample id={sample['id']} gt_label={sample['_gt_label']} gt_cat={sample['category']}")

for ann, label_model in [
    ("claude", CLAUDE_MODEL),
    ("gpt", OPENAI_MODEL),
    ("gemini", GEMINI_MODEL),
]:
    t0 = time.time()
    label, cat, err = annotate_one(ann, prompt)
    dt = time.time() - t0
    if label is not None:
        print(f"[smoke] {ann:7s} ({label_model}) -> label={label} category={cat} ({dt:.1f}s)")
    else:
        print(f"[smoke] {ann:7s} ({label_model}) FAILED in {dt:.1f}s: {err[:300]}")
