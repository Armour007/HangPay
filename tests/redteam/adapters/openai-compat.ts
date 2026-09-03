// OpenAI-compat adapter. Serves: OpenAI proper, Gemini (OpenAI-compat
// endpoint), Ollama (OpenAI-compat /v1). Uses the same openai SDK already
// required by the engine — no new dep.

import type { PaymentIntent, GuardrailPolicy } from "../../../src/core/models.js";
import type { ProviderAdapter, ProviderName, BenchEvalResult } from "./types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { ProviderUnreachable, InvalidResponse, RetryExhausted } from "../../../src/errors.js";

const RETRIABLE = new Set([429, 500, 502, 503, 504]);

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly name: ProviderName;
  readonly modelId: string;
  private client: any;
  private useJsonMode: boolean;

  private requestTimeoutMs: number;

  constructor(opts: {
    name: ProviderName;
    apiKey: string;
    baseUrl?: string;
    model: string;
    useJsonMode?: boolean;
    requestTimeoutMs?: number;
  }) {
    const { default: OpenAI } = require("openai");
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      timeout: this.requestTimeoutMs,
    });
    this.name = opts.name;
    this.modelId = opts.model;
    this.useJsonMode = opts.useJsonMode ?? true;
  }

  async evaluate(intent: PaymentIntent, policy: GuardrailPolicy): Promise<BenchEvalResult> {
    const kwargs: any = {
      model: this.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(intent, policy) },
      ],
    };
    if (this.useJsonMode) kwargs.response_format = { type: "json_object" };
    // Ollama's OpenAI-compat endpoint accepts `keep_alive` as a body passthrough.
    // Pin at 24h so inter-batch pauses don't trigger cold-reload (default 5m → 10-30s reload latency skews p50/p95).
    if (this.name === "ollama") kwargs.keep_alive = "24h";
    // OpenAI safety identifier (`user` field): metadata-only API parameter
    // that tags adversarial-research traffic for provider-side abuse-monitoring
    // correlation. Added post-2026-04-30 cyber-abuse warning incident per
    // OpenAI's recommendation. Only sent for provider==="openai" since
    // Gemini/Ollama OpenAI-compat endpoints may reject unknown fields.
    // API metadata only — does NOT modify SYSTEM_PROMPT or user message.
    if (this.name === "openai") kwargs.user = "redteam-research-v1";

    const maxRetries = Number(process.env.POP_BENCH_MAX_RETRIES ?? 15);
    let lastRetriable: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await this.client.chat.completions.create(kwargs, {
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        const text = resp.choices[0].message.content;
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch (pe: any) {
          throw new InvalidResponse(`JSON parse failed: ${pe?.message ?? pe}`, { cause: pe });
        }
        return { approved: parsed.approved === true, reason: parsed.reason ?? "unknown", raw: { ...parsed, api_model: resp.model } };
      } catch (e: any) {
        if (e instanceof InvalidResponse) throw e;
        const status = e?.status ?? e?.statusCode;
        const isAbort =
          e?.name === "AbortError" ||
          e?.name === "TimeoutError" ||
          e?.code === "ABORT_ERR" ||
          /aborted|timeout/i.test(String(e?.message ?? ""));
        const transientName = e?.name === "APIConnectionError" || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT";
        if ((status && RETRIABLE.has(status)) || transientName || isAbort) {
          lastRetriable = e;
          const backoffBase = Number(process.env.POP_BENCH_RETRY_BASE_MS ?? 1000);
          const backoffCap = Number(process.env.POP_BENCH_RETRY_CAP_MS ?? 20000);
          await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * backoffBase, backoffCap)));
          continue;
        }
        throw new ProviderUnreachable(this.name, { cause: e });
      }
    }
    throw new RetryExhausted({ cause: lastRetriable });
  }
}
