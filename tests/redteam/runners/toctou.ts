// TOCTOU runner. Reuses verifyDomainToctou() from src/engine/injector.ts (already covered by tests/toctou.test.ts).
// Simulates a mid-flight URL change by running verify against the attacker-controlled final URL rather than
// the agent-declared page_url. Only category C / H payloads exercise this meaningfully; other categories return "skip".

import type { AttackPayload, RunnerResult } from "../types.js";
import { verifyDomainToctou } from "../../../src/engine/injector.js";

export async function runToctou(p: AttackPayload): Promise<RunnerResult> {
  const relevant = p.category === "C" || p.category === "H" || p.layer_target === "toctou";
  if (!relevant) {
    return { runner: "toctou", verdict: "skip", reason: "not a toctou-class payload", latency_ms: 0 };
  }
  if (!p.page_url) {
    return { runner: "toctou", verdict: "skip", reason: "no page_url to verify", latency_ms: 0 };
  }
  const start = performance.now();
  try {
    const result = verifyDomainToctou(p.page_url, p.vendor);
    return {
      runner: "toctou",
      verdict: result === null ? "approve" : "block",
      reason: result ?? "domain_ok",
      latency_ms: performance.now() - start,
    };
  } catch (e: any) {
    return {
      runner: "toctou",
      verdict: "error",
      reason: String(e?.message ?? e),
      latency_ms: performance.now() - start,
      error: String(e?.stack ?? e),
    };
  }
}
