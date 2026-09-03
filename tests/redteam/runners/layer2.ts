// Layer-2 runner. Engine reads its OWN env (POP_LLM_*). Harness does NOT read ~/.config/pop-pay/.env.
// If no LLM is configured (detected by a missing POP_LLM_API_KEY and no OPENAI_API_KEY in process.env),
// verdict is "skip" and the caller should tag the run as requires:llm unavailable.
//
// --model-sweep mode: setBenchAdapter() injects a ProviderAdapter; runLayer2
// dispatches to it instead of the POP_LLM_* engine. Injection is process-wide
// and serialised by the sweep loop (one adapter per corpus slice).

import { LLMGuardrailEngine } from "../../../src/engine/llm-guardrails.js";
import type { ProviderAdapter } from "../adapters/types.js";
import type { AttackPayload, RunnerResult } from "../types.js";

let cachedEngine: LLMGuardrailEngine | null = null;
let cachedAvailable: boolean | null = null;
let injectedAdapter: ProviderAdapter | null = null;
let injectedLabel: string | null = null;

export function setBenchAdapter(adapter: ProviderAdapter | null, label: string | null = null): void {
  injectedAdapter = adapter;
  injectedLabel = label;
  cachedEngine = null;
  cachedAvailable = null;
}

export function currentBenchLabel(): string | null {
  return injectedLabel;
}

function llmAvailable(): boolean {
  if (injectedAdapter) return true;
  if (cachedAvailable !== null) return cachedAvailable;
  const key = process.env.POP_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  cachedAvailable = Boolean(key);
  return cachedAvailable;
}

function getEngine(): LLMGuardrailEngine {
  if (cachedEngine) return cachedEngine;
  cachedEngine = new LLMGuardrailEngine({
    apiKey: process.env.POP_LLM_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: process.env.POP_LLM_BASE_URL,
    model: process.env.POP_LLM_MODEL ?? "gpt-4o-mini",
  });
  return cachedEngine;
}

export async function runLayer2(p: AttackPayload): Promise<RunnerResult> {
  if (!llmAvailable()) {
    return { runner: "layer2", verdict: "skip", reason: "no LLM configured (requires:llm)", latency_ms: 0 };
  }
  const start = performance.now();
  const intent = {
    agentId: `redteam-${p.id}`,
    requestedAmount: p.amount,
    targetVendor: p.vendor,
    reasoning: p.reasoning,
    pageUrl: p.page_url,
  };
  const policy = {
    allowedCategories: p.allowed_categories,
    maxAmountPerTx: 1_000_000,
    maxDailyBudget: 1_000_000,
    blockHallucinationLoops: true,
    webhookUrl: null,
  };
  try {
    let approved: boolean;
    let reason: string;
    let raw: unknown;
    if (injectedAdapter) {
      const r = await injectedAdapter.evaluate(intent, policy);
      approved = r.approved;
      reason = r.reason;
      raw = r.raw;
    } else {
      const [a, rr] = await getEngine().evaluateIntent(intent, policy);
      approved = a;
      reason = rr;
    }
    return {
      runner: "layer2",
      verdict: approved ? "approve" : "block",
      reason,
      latency_ms: performance.now() - start,
      ...(raw !== undefined && { raw }),
    };
  } catch (e: any) {
    return {
      runner: "layer2",
      verdict: "error",
      reason: String(e?.message ?? e),
      latency_ms: performance.now() - start,
      error: String(e?.stack ?? e),
    };
  }
}
