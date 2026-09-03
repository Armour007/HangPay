import { describe, it, expect } from "vitest";
import { LLMGuardrailEngine } from "../src/engine/llm-guardrails.js";
import { ProviderUnreachable, InvalidResponse, RetryExhausted } from "../src/errors.js";
import type { PaymentIntent, GuardrailPolicy } from "../src/core/models.js";

const intent: PaymentIntent = {
  agentId: "test-agent",
  requestedAmount: 10,
  targetVendor: "example.com",
  reasoning: "buy a thing",
  pageUrl: null,
};
const policy: GuardrailPolicy = {
  allowedCategories: ["software"],
  maxAmountPerTx: 100,
  maxDailyBudget: 500,
  blockHallucinationLoops: true,
  webhookUrl: null,
};

function makeEngine(create: (kw: any) => Promise<any>): LLMGuardrailEngine {
  const eng = new LLMGuardrailEngine({ apiKey: "x" });
  // Inject fake openai client + zero-out backoff sleeps via setTimeout shim.
  (eng as any).client = { chat: { completions: { create } } };
  return eng;
}

describe("LLMGuardrailEngine typed errors", () => {
  it("retry exhaustion raises RetryExhausted (not [false, ...])", async () => {
    const eng = makeEngine(async () => {
      const e: any = new Error("rate-limited");
      e.status = 429;
      throw e;
    });
    await expect(eng.evaluateIntent(intent, policy)).rejects.toBeInstanceOf(RetryExhausted);
  }, 30000);

  it("non-retriable status raises ProviderUnreachable", async () => {
    const eng = makeEngine(async () => {
      const e: any = new Error("bad creds");
      e.status = 401;
      throw e;
    });
    await expect(eng.evaluateIntent(intent, policy)).rejects.toBeInstanceOf(ProviderUnreachable);
  });

  it("invalid JSON raises InvalidResponse", async () => {
    const eng = makeEngine(async () => ({
      choices: [{ message: { content: "not-json" } }],
    }));
    await expect(eng.evaluateIntent(intent, policy)).rejects.toBeInstanceOf(InvalidResponse);
  });

  it("happy path returns verdict", async () => {
    const eng = makeEngine(async () => ({
      choices: [{ message: { content: JSON.stringify({ approved: true, reason: "fine" }) } }],
    }));
    const [approved, reason] = await eng.evaluateIntent(intent, policy);
    expect(approved).toBe(true);
    expect(reason).toBe("fine");
  });
});
