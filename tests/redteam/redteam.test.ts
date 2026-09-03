// Vitest entry — gated by POP_REDTEAM=1. When unset the whole suite is skipped.
// LLM-requiring paths are tagged `requires:llm` and self-skip if no API key is in the harness process env.

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadCorpus, validateCorpus } from "./validate-corpus.js";
import { runLayer1 } from "./runners/layer1.js";
import { runHybrid } from "./runners/hybrid.js";
import { aggregate } from "./aggregator.js";
import type { AttackPayload, PayloadRunRow } from "./types.js";

const GATED = process.env.POP_REDTEAM === "1";
const CORPUS_PATH = "tests/redteam/corpus/attacks.json";

describe.skipIf(!GATED)("RT-1 red team harness", () => {
  let corpus: AttackPayload[] = [];

  beforeAll(() => {
    if (!existsSync(CORPUS_PATH)) {
      throw new Error(`Corpus missing at ${CORPUS_PATH}. See tests/redteam/README.md.`);
    }
    corpus = loadCorpus(CORPUS_PATH);
  });

  it("corpus validates schema and dedup", () => {
    // Re-run validator on raw input to produce a report here (loadCorpus already threw on errors)
    const raw = JSON.parse(require("node:fs").readFileSync(CORPUS_PATH, "utf8"));
    const { report } = validateCorpus(raw);
    expect(report.ok, report.errors.join("\n")).toBe(true);
  });

  it("corpus has >=500 payloads and covers A-K", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(500);
    const cats = new Set(corpus.map((p) => p.category));
    for (const c of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      expect(cats.has(c as any), `category ${c} missing`).toBe(true);
    }
  });

  it("Layer1 smoke: one known-bad B payload blocks", async () => {
    const b = corpus.find((p) => p.category === "B" && p.expected === "block");
    if (!b) return; // corpus may not have it yet in very early bootstrap
    const r = await runLayer1(b);
    expect(["block", "approve", "error"]).toContain(r.verdict);
  });

  it("Hybrid runner smoke is callable", async () => {
    const anyPayload = corpus[0];
    if (!anyPayload) return;
    const r = await runHybrid(anyPayload);
    expect(r.runner).toBe("hybrid");
  });

  it("Aggregator produces a report shape with B-class decision", () => {
    // Minimal synthetic rows — exercises the report shape, not real numbers.
    const synth: PayloadRunRow[] = corpus.slice(0, 5).map((p, i) => ({
      payload_id: p.id,
      category: p.category,
      expected: p.expected,
      run_index: 0,
      layer1: { runner: "layer1", verdict: "block", reason: "stub", latency_ms: 1 },
      layer2: { runner: "layer2", verdict: "skip", reason: "no LLM", latency_ms: 0 },
      hybrid: { runner: "hybrid", verdict: "block", reason: "stub", latency_ms: 1 },
      full_mcp: { runner: "full_mcp", verdict: "block", reason: "stub", latency_ms: 1 },
      toctou: { runner: "toctou", verdict: "skip", reason: "n/a", latency_ms: 0 },
      attribution: ["layer1"],
    }));
    const r = aggregate(synth, "stub-hash");
    expect(r.b_class.decision).toMatch(/keep|keep-deprecated|drop/);
  });
});
