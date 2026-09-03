import { randomUUID } from "node:crypto";
import type { VirtualCardProvider } from "./base.js";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

/**
 * LithicProvider — multi-issuer adapter skeleton for Lithic virtual cards.
 *
 * Lithic provides an API for issuing virtual debit and credit cards.
 * This is a skeleton implementation; replace TODO sections with real API calls
 * once the Lithic SDK integration is ready.
 */
export class LithicProvider implements VirtualCardProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async issueCard(intent: PaymentIntent, policy: GuardrailPolicy): Promise<VirtualSeal> {
    if (intent.requestedAmount > policy.maxAmountPerTx) {
      return {
        sealId: randomUUID(),
        cardNumber: null,
        cvv: null,
        expirationDate: null,
        authorizedAmount: 0.0,
        status: "Rejected",
        rejectionReason: "Amount exceeds policy limit",
      };
    }

    // TODO: Replace with real Lithic API call
    // const card = await lithicClient.cards.create({
    //   type: "VIRTUAL",
    //   spend_limit: Math.round(intent.requestedAmount * 100),
    //   spend_limit_duration: "TRANSACTION",
    // });
    throw new Error(
      "LithicProvider is a skeleton — real Lithic API integration not yet implemented. " +
      "Set POP_PROVIDER=stripe or POP_PROVIDER=byoc for working providers."
    );
  }
}
