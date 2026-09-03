// Hybrid = Layer1 short-circuits on block; otherwise falls through to Layer2.
// This mirrors production intent; any divergence should be treated as a bug, not a policy call.

import type { AttackPayload, RunnerResult } from "../types.js";
import { runLayer1 } from "./layer1.js";
import { runLayer2 } from "./layer2.js";

export async function runHybrid(p: AttackPayload): Promise<RunnerResult> {
  const start = performance.now();
  const l1 = await runLayer1(p);
  if (l1.verdict === "block") {
    return {
      runner: "hybrid",
      verdict: "block",
      reason: `layer1:${l1.reason}`,
      latency_ms: performance.now() - start,
    };
  }
  if (l1.verdict === "error") {
    return {
      runner: "hybrid",
      verdict: "error",
      reason: `layer1_error:${l1.reason}`,
      latency_ms: performance.now() - start,
      error: l1.error,
    };
  }
  const l2 = await runLayer2(p);
  return {
    runner: "hybrid",
    verdict: l2.verdict,
    reason: `layer2:${l2.reason}`,
    latency_ms: performance.now() - start,
    error: l2.error,
    ...(l2.raw !== undefined && { raw: l2.raw }),
  };
}
