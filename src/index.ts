export type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "./core/models.js";
export { PaymentIntentSchema, GuardrailPolicySchema } from "./core/models.js";
export { PopStateTracker } from "./core/state.js";
export { GuardrailEngine, matchVendor } from "./engine/guardrails.js";
export { LLMGuardrailEngine, HybridGuardrailEngine } from "./engine/llm-guardrails.js";
export { KNOWN_PAYMENT_PROCESSORS } from "./engine/known-processors.js";
export {
  PopBrowserInjector,
  verifyDomainToctou,
  ssrfValidateUrl,
} from "./engine/injector.js";
export type { InjectionResult, BillingInfo, PageSnapshot } from "./engine/injector.js";
export { PopClient } from "./client.js";
export type { VirtualCardProvider } from "./providers/base.js";
export { MockStripeProvider } from "./providers/stripe-mock.js";
export { LocalVaultProvider } from "./providers/byoc-local.js";
export { StripeIssuingProvider } from "./providers/stripe-real.js";
export {
  vaultExists,
  loadVault,
  saveVault,
  encryptCredentials,
  decryptCredentials,
  deriveKeyFromPassphrase,
  storeKeyInKeyring,
  loadKeyFromKeyring,
  clearKeyring,
  secureWipeEnv,
  OSS_WARNING,
} from "./vault.js";
