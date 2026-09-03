// Anthropic adapter. Uses @anthropic-ai/sdk — NOT a hard dep; loaded via
// dynamic require so the harness still works when the package is absent.
//
// Install before the cross-model sweep:
//   npm install --save-dev @anthropic-ai/sdk

import type { PaymentIntent, GuardrailPolicy } from "../../../src/core/models.js";
import type { ProviderAdapter, BenchEvalResult } from "./types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { ProviderUnreachable, InvalidResponse, RetryExhausted } from "../../../src/errors.js";

const RETRIABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic" as const;
  readonly modelId: string;
  private client: any;

  private requestTimeoutMs: number;

  constructor(opts: { apiKey: string; model: string; requestTimeoutMs?: number }) {
    let Anthropic: any;
    try {
      Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
    } catch {
      throw new Error(
        "[@anthropic-ai/sdk] not installed. Run: npm install --save-dev @anthropic-ai/sdk",
      );
    }
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: this.requestTimeoutMs });
    this.modelId = opts.model;
  }

  async evaluate(intent: PaymentIntent, policy: GuardrailPolicy): Promise<BenchEvalResult> {
    const user = buildUserPrompt(intent, policy);
    const maxRetries = 15;
    let lastRetriable: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await this.client.messages.create(
          {
            model: this.modelId,
            max_tokens: 256,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: user }],
          },
          { signal: AbortSignal.timeout(this.requestTimeoutMs) },
        );
        const block = (resp.content ?? []).find((b: any) => b.type === "text");
        const text = block?.text ?? "";
        const jsonStart = text.indexOf("{");
        const jsonEnd = text.lastIndexOf("}");
        const slice = jsonStart >= 0 && jsonEnd > jsonStart ? text.slice(jsonStart, jsonEnd + 1) : text;
        let parsed: any;
        try {
          parsed = JSON.parse(slice);
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
        const transientName =
          e?.name === "APIConnectionError" ||
          e?.name === "APIConnectionTimeoutError" ||
          e?.code === "ECONNRESET" ||
          e?.code === "ETIMEDOUT" ||
          /timed out|connection error/i.test(String(e?.message ?? ""));
        if ((status && RETRIABLE.has(status)) || transientName || isAbort) {
          lastRetriable = e;
          await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 20000)));
          continue;
        }
        throw new ProviderUnreachable("anthropic", { cause: e });
      }
    }
    throw new RetryExhausted({ cause: lastRetriable });
  }
}
