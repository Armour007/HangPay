import { describe, it, expect } from "vitest";
import { MockStripeProvider } from "../src/providers/stripe-mock.js";
import { LithicProvider } from "../src/providers/lithic.js";
import type { PaymentIntent, GuardrailPolicy } from "../src/core/models.js";

const policy: GuardrailPolicy = {
  allowedCategories: ["aws"],
  maxAmountPerTx: 100,
  maxDailyBudget: 500,
  blockHallucinationLoops: true,
  webhookUrl: null,
};

const validIntent: PaymentIntent = {
  agentId: "test",
  requestedAmount: 50,
  targetVendor: "AWS",
  reasoning: "Need compute",
  pageUrl: null,
};

// ---------------------------------------------------------------------------
// MockStripeProvider
// ---------------------------------------------------------------------------
describe("MockStripeProvider", () => {
  const provider = new MockStripeProvider();

  it("issues card for valid intent", async () => {
    const seal = await provider.issueCard(validIntent, policy);
    expect(seal.status).toBe("Issued");
    expect(seal.cardNumber).toBeTruthy();
    expect(seal.cardNumber!.length).toBe(16);
    expect(seal.cvv).toBeTruthy();
    expect(seal.cvv!.length).toBe(3);
    expect(seal.expirationDate).toMatch(/^\d{2}\/\d{2}$/);
    expect(seal.authorizedAmount).toBe(50);
    expect(seal.sealId).toBeTruthy();
  });

  it("rejects over-limit request", async () => {
    const overIntent: PaymentIntent = {
      ...validIntent,
      requestedAmount: 200,
    };
    const seal = await provider.issueCard(overIntent, policy);
    expect(seal.status).toBe("Rejected");
    expect(seal.cardNumber).toBeNull();
    expect(seal.rejectionReason).toContain("limit");
  });

  it("generates unique seal IDs", async () => {
    const seal1 = await provider.issueCard(validIntent, policy);
    const seal2 = await provider.issueCard(validIntent, policy);
    expect(seal1.sealId).not.toBe(seal2.sealId);
  });

  it("generates random card numbers", async () => {
    const seal1 = await provider.issueCard(validIntent, policy);
    const seal2 = await provider.issueCard(validIntent, policy);
    // Very high probability they differ
    expect(seal1.cardNumber).not.toBe(seal2.cardNumber);
  });
});

// ---------------------------------------------------------------------------
// LithicProvider (skeleton — should throw)
// ---------------------------------------------------------------------------
describe("LithicProvider", () => {
  it("rejects over-limit request", async () => {
    const provider = new LithicProvider("test-key");
    const overIntent: PaymentIntent = {
      ...validIntent,
      requestedAmount: 200,
    };
    const seal = await provider.issueCard(overIntent, policy);
    expect(seal.status).toBe("Rejected");
  });

  it("throws for valid request (skeleton not implemented)", async () => {
    const provider = new LithicProvider("test-key");
    await expect(provider.issueCard(validIntent, policy)).rejects.toThrow("skeleton");
  });
});
