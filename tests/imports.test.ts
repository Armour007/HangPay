import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Import smoke tests (mirrors Python test_rename_smoke.py)
// ---------------------------------------------------------------------------
describe("Import smoke tests", () => {
  it("imports PopClient", async () => {
    const { PopClient } = await import("../src/client.js");
    expect(PopClient).toBeDefined();
  });

  it("imports PopBrowserInjector", async () => {
    const { PopBrowserInjector } = await import("../src/engine/injector.js");
    expect(PopBrowserInjector).toBeDefined();
  });

  it("imports PopStateTracker", async () => {
    const { PopStateTracker } = await import("../src/core/state.js");
    expect(PopStateTracker).toBeDefined();
  });

  it("imports GuardrailEngine", async () => {
    const { GuardrailEngine } = await import("../src/engine/guardrails.js");
    expect(GuardrailEngine).toBeDefined();
  });

  it("imports matchVendor", async () => {
    const { matchVendor } = await import("../src/engine/guardrails.js");
    expect(matchVendor).toBeDefined();
  });

  it("imports LLMGuardrailEngine", async () => {
    const { LLMGuardrailEngine } = await import("../src/engine/llm-guardrails.js");
    expect(LLMGuardrailEngine).toBeDefined();
  });

  it("imports HybridGuardrailEngine", async () => {
    const { HybridGuardrailEngine } = await import("../src/engine/llm-guardrails.js");
    expect(HybridGuardrailEngine).toBeDefined();
  });

  it("imports vault functions", async () => {
    const vault = await import("../src/vault.js");
    expect(vault.encryptCredentials).toBeDefined();
    expect(vault.decryptCredentials).toBeDefined();
    expect(vault.vaultExists).toBeDefined();
    expect(vault.saveVault).toBeDefined();
    expect(vault.loadVault).toBeDefined();
    expect(vault.deriveKeyFromPassphrase).toBeDefined();
  });

  it("imports KNOWN_PAYMENT_PROCESSORS", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS).toBeInstanceOf(Set);
    expect(KNOWN_PAYMENT_PROCESSORS.size).toBeGreaterThan(10);
  });

  it("imports models and schemas", async () => {
    const { GuardrailPolicySchema, PaymentIntentSchema } = await import("../src/core/models.js");
    expect(GuardrailPolicySchema).toBeDefined();
    expect(PaymentIntentSchema).toBeDefined();
  });

  it("imports providers", async () => {
    const { MockStripeProvider } = await import("../src/providers/stripe-mock.js");
    const { LocalVaultProvider } = await import("../src/providers/byoc-local.js");
    const { LithicProvider } = await import("../src/providers/lithic.js");
    expect(MockStripeProvider).toBeDefined();
    expect(LocalVaultProvider).toBeDefined();
    expect(LithicProvider).toBeDefined();
  });

  it("imports from index (public API)", async () => {
    const api = await import("../src/index.js");
    expect(api.PopClient).toBeDefined();
    expect(api.GuardrailEngine).toBeDefined();
    expect(api.PopBrowserInjector).toBeDefined();
    expect(api.MockStripeProvider).toBeDefined();
    expect(api.encryptCredentials).toBeDefined();
    expect(api.KNOWN_PAYMENT_PROCESSORS).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Known payment processors registry
// ---------------------------------------------------------------------------
describe("KNOWN_PAYMENT_PROCESSORS", () => {
  it("includes Stripe", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS.has("stripe.com")).toBe(true);
  });

  it("includes PayPal", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS.has("paypal.com")).toBe(true);
  });

  it("includes Square", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS.has("squareup.com")).toBe(true);
  });

  it("includes Adyen", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS.has("adyen.com")).toBe(true);
  });

  it("includes event platforms", async () => {
    const { KNOWN_PAYMENT_PROCESSORS } = await import("../src/engine/known-processors.js");
    expect(KNOWN_PAYMENT_PROCESSORS.has("eventbrite.com")).toBe(true);
    expect(KNOWN_PAYMENT_PROCESSORS.has("lu.ma")).toBe(true);
  });
});
