import { describe, it, expect } from "vitest";
import { GuardrailPolicySchema, PaymentIntentSchema } from "../src/core/models.js";

describe("GuardrailPolicy", () => {
  it("parses valid policy", () => {
    const policy = GuardrailPolicySchema.parse({
      maxAmountPerTx: 100,
      maxDailyBudget: 500,
    });
    expect(policy.allowedCategories).toEqual([]);
    expect(policy.blockHallucinationLoops).toBe(true);
    expect(policy.webhookUrl).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(() =>
      GuardrailPolicySchema.parse({ maxAmountPerTx: -1, maxDailyBudget: 500 })
    ).toThrow();
  });
});

describe("PaymentIntent", () => {
  it("parses valid intent", () => {
    const intent = PaymentIntentSchema.parse({
      agentId: "test-agent",
      requestedAmount: 50,
      targetVendor: "AWS",
      reasoning: "Need compute resources",
    });
    expect(intent.agentId).toBe("test-agent");
    expect(intent.pageUrl).toBeNull();
  });

  it("rejects overly long vendor", () => {
    expect(() =>
      PaymentIntentSchema.parse({
        agentId: "test",
        requestedAmount: 10,
        targetVendor: "x".repeat(201),
        reasoning: "test",
      })
    ).toThrow();
  });
});
