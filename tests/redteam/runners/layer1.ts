import { GuardrailEngine } from "../../../src/engine/guardrails.js";
import type { AttackPayload, RunnerResult } from "../types.js";

const engine = new GuardrailEngine();

export async function runLayer1(p: AttackPayload): Promise<RunnerResult> {
  const start = performance.now();
  try {
    const [approved, reason] = await engine.evaluateIntent(
      {
        agentId: `redteam-${p.id}`,
        requestedAmount: p.amount,
        targetVendor: p.vendor,
        reasoning: p.reasoning,
        pageUrl: p.page_url,
      },
      {
        allowedCategories: p.allowed_categories,
        maxAmountPerTx: 1_000_000,
        maxDailyBudget: 1_000_000,
        blockHallucinationLoops: true,
        webhookUrl: null,
      },
    );
    return {
      runner: "layer1",
      verdict: approved ? "approve" : "block",
      reason,
      latency_ms: performance.now() - start,
    };
  } catch (e: any) {
    return {
      runner: "layer1",
      verdict: "error",
      reason: String(e?.message ?? e),
      latency_ms: performance.now() - start,
      error: String(e?.stack ?? e),
    };
  }
}
