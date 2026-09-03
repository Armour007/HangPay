import { describe, it, expect, afterEach } from "vitest";
import { PopClient } from "../src/client.js";
import { MockStripeProvider } from "../src/providers/stripe-mock.js";
import type { GuardrailPolicy } from "../src/core/models.js";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = ":memory:";

describe("PopClient", () => {
  const policy: GuardrailPolicy = {
    allowedCategories: ["aws", "cloudflare"],
    maxAmountPerTx: 100,
    maxDailyBudget: 500,
    blockHallucinationLoops: true,
    webhookUrl: null,
  };

  it("approves valid payment", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, TEST_DB);
    const seal = await client.processPayment({
      agentId: "test",
      requestedAmount: 50,
      targetVendor: "AWS",
      reasoning: "Need compute",
      pageUrl: null,
    });
    expect(seal.status).toBe("Pending");
    expect(seal.authorizedAmount).toBe(50);
    expect(seal.cardNumber).toBeTruthy();
    client.stateTracker.close();
  });

  it("rejects over-budget payment", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, TEST_DB);
    // Fill up the budget
    for (let i = 0; i < 5; i++) {
      await client.processPayment({
        agentId: "test",
        requestedAmount: 100,
        targetVendor: "AWS",
        reasoning: "Need compute",
        pageUrl: null,
      });
    }
    // This should exceed daily budget
    const seal = await client.processPayment({
      agentId: "test",
      requestedAmount: 100,
      targetVendor: "AWS",
      reasoning: "Need more compute",
      pageUrl: null,
    });
    expect(seal.status).toBe("Rejected");
    expect(seal.rejectionReason).toContain("budget");
    client.stateTracker.close();
  });

  it("enforces burn-after-use", async () => {
    const client = new PopClient(new MockStripeProvider(), policy, undefined, TEST_DB);
    const seal = await client.processPayment({
      agentId: "test",
      requestedAmount: 10,
      targetVendor: "AWS",
      reasoning: "Test",
      pageUrl: null,
    });
    const result1 = await client.executePayment(seal.sealId, 10);
    expect(result1.status).toBe("success");
    const result2 = await client.executePayment(seal.sealId, 10);
    expect(result2.status).toBe("rejected");
    client.stateTracker.close();
  });
});
