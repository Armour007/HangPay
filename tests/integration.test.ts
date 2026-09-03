import { describe, it, expect } from "vitest";
import { PopClient } from "../src/client.js";
import { MockStripeProvider } from "../src/providers/stripe-mock.js";
import { GuardrailEngine } from "../src/engine/guardrails.js";
import type { GuardrailPolicy, PaymentIntent } from "../src/core/models.js";

// ---------------------------------------------------------------------------
// Integration tests (mirrors Python test_integration.py)
// ---------------------------------------------------------------------------
describe("Integration – end-to-end payment flow", () => {
  const policy: GuardrailPolicy = {
    allowedCategories: ["aws", "cloudflare", "github", "wikipedia"],
    maxAmountPerTx: 100,
    maxDailyBudget: 500,
    blockHallucinationLoops: true,
    webhookUrl: null,
  };

  it("approved payment chain", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, ":memory:");
    const seal = await client.processPayment({
      agentId: "integration-test",
      requestedAmount: 25,
      targetVendor: "AWS",
      reasoning: "Provisioning EC2 for CI/CD pipeline",
      pageUrl: null,
    });
    expect(seal.status).toBe("Pending");
    expect(seal.cardNumber).toBeTruthy();
    expect(seal.authorizedAmount).toBe(25);

    // Execute payment (burn-after-use)
    const exec1 = await client.executePayment(seal.sealId, 25);
    expect(exec1.status).toBe("success");

    // Second use should fail
    const exec2 = await client.executePayment(seal.sealId, 25);
    expect(exec2.status).toBe("rejected");
    expect(exec2.reason).toContain("Burn-after-use");

    client.stateTracker.close();
  });

  it("hallucination rejection chain", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, ":memory:");
    const seal = await client.processPayment({
      agentId: "integration-test",
      requestedAmount: 25,
      targetVendor: "AWS",
      reasoning: "retry this failed again loop stuck in a loop",
      pageUrl: null,
    });
    expect(seal.status).toBe("Rejected");
    expect(seal.rejectionReason).toContain("Hallucination");
    expect(seal.cardNumber).toBeNull();
    client.stateTracker.close();
  });

  it("vendor rejection chain", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, ":memory:");
    const seal = await client.processPayment({
      agentId: "integration-test",
      requestedAmount: 25,
      targetVendor: "EvilCorp",
      reasoning: "Need their services",
      pageUrl: null,
    });
    expect(seal.status).toBe("Rejected");
    expect(seal.rejectionReason).toContain("Vendor");
    client.stateTracker.close();
  });

  it("budget exhaustion chain", async () => {
    const client = new PopClient(
      new MockStripeProvider(),
      { ...policy, maxDailyBudget: 100 },
      undefined,
      ":memory:"
    );

    // Spend up to budget
    const s1 = await client.processPayment({
      agentId: "test",
      requestedAmount: 60,
      targetVendor: "AWS",
      reasoning: "compute",
      pageUrl: null,
    });
    expect(s1.status).toBe("Pending");

    const s2 = await client.processPayment({
      agentId: "test",
      requestedAmount: 40,
      targetVendor: "AWS",
      reasoning: "compute",
      pageUrl: null,
    });
    expect(s2.status).toBe("Pending");

    // Over budget
    const s3 = await client.processPayment({
      agentId: "test",
      requestedAmount: 1,
      targetVendor: "AWS",
      reasoning: "compute",
      pageUrl: null,
    });
    expect(s3.status).toBe("Rejected");
    expect(s3.rejectionReason).toContain("budget");

    client.stateTracker.close();
  });

  it("domain mismatch rejection", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, ":memory:");
    const seal = await client.processPayment({
      agentId: "test",
      requestedAmount: 25,
      targetVendor: "AWS",
      reasoning: "Need compute",
      pageUrl: "https://evil-site.com/checkout",
    });
    expect(seal.status).toBe("Rejected");
    expect(seal.rejectionReason).toContain("domain");
    client.stateTracker.close();
  });

  it("custom engine injection", async () => {
    const customEngine = new GuardrailEngine();
    const client = new PopClient(new MockStripeProvider(), policy, customEngine, ":memory:");
    const seal = await client.processPayment({
      agentId: "test",
      requestedAmount: 25,
      targetVendor: "AWS",
      reasoning: "Normal purchase",
      pageUrl: null,
    });
    expect(seal.status).toBe("Pending");
    client.stateTracker.close();
  });
});
