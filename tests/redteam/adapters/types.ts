// Cross-provider Layer-2 evaluation interface for the redteam harness.
//
// The engine path (src/engine/llm-guardrails.ts) always reads POP_LLM_*.
// The benchmark path (this folder) reads POP_BENCH_* so operator config and
// benchmark config can never leak into each other.
//
// Providers: openai-compat (OpenAI, Gemini via compat endpoint, Ollama),
// anthropic (Anthropic SDK). Add more by implementing ProviderAdapter.

import type { PaymentIntent, GuardrailPolicy } from "../../../src/core/models.js";

export type ProviderName = "openai" | "anthropic" | "gemini" | "ollama";

export interface BenchEvalResult {
  approved: boolean;
  reason: string;
  raw?: unknown;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  readonly modelId: string;
  evaluate(intent: PaymentIntent, policy: GuardrailPolicy): Promise<BenchEvalResult>;
}

export interface BenchEnvConfig {
  anthropic?: { apiKey: string; model: string };
  openai?: { apiKey: string; model: string; baseUrl?: string };
  gemini?: { apiKey: string; model: string; baseUrl: string };
  ollama?: { baseUrl: string; model: string };
}
