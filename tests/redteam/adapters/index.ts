// POP_BENCH_* dispatcher. Reads bench-only env (never POP_LLM_*) and returns
// the set of ProviderAdapters the harness can sweep across.
//
// Env schema:
//   POP_BENCH_ANTHROPIC_API_KEY   POP_BENCH_ANTHROPIC_MODEL
//   POP_BENCH_OPENAI_API_KEY      POP_BENCH_OPENAI_MODEL      POP_BENCH_OPENAI_BASE_URL
//   POP_BENCH_GEMINI_API_KEY      POP_BENCH_GEMINI_MODEL      POP_BENCH_GEMINI_BASE_URL
//   POP_BENCH_OLLAMA_BASE_URL     POP_BENCH_OLLAMA_MODEL      (key unused)
//
// Each block is independent: if one provider's env is set, that adapter is
// included. Empty set = no sweep (harness falls back to POP_LLM_* engine
// path used by the baseline runs).

import type { ProviderAdapter } from "./types.js";
import { OpenAICompatAdapter } from "./openai-compat.js";
import { AnthropicAdapter } from "./anthropic.js";

// ── MODEL_REGISTRY ──────────────────────────────────────────────────────
// Central registry mapping model names to provider configs.
// Used by run-adaptive.ts AttackerLLM to resolve any registered model
// without hardcoding provider logic.

export interface ModelRegistryEntry {
  model: string;
  provider: string;
  sdk: "openai-compat" | "anthropic";
  apiKeyEnv?: string;
  baseUrlEnv?: string;
  baseUrl?: string;
}

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // ── Anthropic ──
  { model: "claude-haiku-4-5-20251001", provider: "anthropic", sdk: "anthropic", apiKeyEnv: "POP_BENCH_ANTHROPIC_API_KEY" },
  { model: "claude-sonnet-4-6", provider: "anthropic", sdk: "anthropic", apiKeyEnv: "POP_BENCH_ANTHROPIC_API_KEY" },
  // Attacker-only (used by AttackerAnthropic in run-adaptive.ts; not a guardrail benchmark target)
  { model: "claude-opus-4-7", provider: "anthropic", sdk: "anthropic", apiKeyEnv: "POP_BENCH_ANTHROPIC_API_KEY" },
  // ── OpenAI ──
  { model: "gpt-5.4-mini-2026-03-17", provider: "openai", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_OPENAI_API_KEY", baseUrlEnv: "POP_BENCH_OPENAI_BASE_URL" },
  { model: "gpt-5.4-nano", provider: "openai", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_OPENAI_API_KEY", baseUrlEnv: "POP_BENCH_OPENAI_BASE_URL" },
  { model: "gpt-5.4", provider: "openai", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_OPENAI_API_KEY", baseUrlEnv: "POP_BENCH_OPENAI_BASE_URL" },
  // ── Gemini ──
  { model: "gemini-2.5-flash", provider: "gemini", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_GEMINI_API_KEY", baseUrlEnv: "POP_BENCH_GEMINI_BASE_URL", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { model: "gemini-3.1-flash-lite-preview", provider: "gemini", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_GEMINI_API_KEY", baseUrlEnv: "POP_BENCH_GEMINI_BASE_URL", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { model: "gemini-3.1-pro-preview", provider: "gemini", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_GEMINI_API_KEY", baseUrlEnv: "POP_BENCH_GEMINI_BASE_URL", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  // ── Ollama ──
  { model: "gemma4:e2b-it-q4_K_M", provider: "ollama", sdk: "openai-compat", baseUrlEnv: "POP_BENCH_OLLAMA_BASE_URL" },
  // ── Attacker-only (not a guardrail benchmark model) ──
  { model: "gemini-3-flash-preview", provider: "gemini", sdk: "openai-compat", apiKeyEnv: "POP_BENCH_GEMINI_API_KEY", baseUrlEnv: "POP_BENCH_GEMINI_BASE_URL", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" },
];

export function resolveBenchAdapters(): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];

  const aKey = process.env.POP_BENCH_ANTHROPIC_API_KEY;
  const aModel = process.env.POP_BENCH_ANTHROPIC_MODEL;
  if (aKey && aModel) adapters.push(new AnthropicAdapter({ apiKey: aKey, model: aModel }));

  const oKey = process.env.POP_BENCH_OPENAI_API_KEY;
  const oModel = process.env.POP_BENCH_OPENAI_MODEL;
  if (oKey && oModel) {
    adapters.push(
      new OpenAICompatAdapter({
        name: "openai",
        apiKey: oKey,
        model: oModel,
        baseUrl: process.env.POP_BENCH_OPENAI_BASE_URL,
      }),
    );
  }

  const gKey = process.env.POP_BENCH_GEMINI_API_KEY;
  const gModel = process.env.POP_BENCH_GEMINI_MODEL;
  const gUrl = process.env.POP_BENCH_GEMINI_BASE_URL;
  if (gKey && gModel && gUrl) {
    adapters.push(
      new OpenAICompatAdapter({ name: "gemini", apiKey: gKey, model: gModel, baseUrl: gUrl }),
    );
  }

  const olUrl = process.env.POP_BENCH_OLLAMA_BASE_URL;
  const olModel = process.env.POP_BENCH_OLLAMA_MODEL;
  if (olUrl && olModel) {
    adapters.push(
      new OpenAICompatAdapter({
        name: "ollama",
        apiKey: "not-needed",
        model: olModel,
        baseUrl: olUrl,
      }),
    );
  }

  return adapters;
}

export function describeAdapters(adapters: ProviderAdapter[]): string {
  if (adapters.length === 0) return "(none — POP_BENCH_* unset)";
  return adapters.map((a) => `${a.name}:${a.modelId}`).join(", ");
}

export type { ProviderAdapter, BenchEvalResult } from "./types.js";
