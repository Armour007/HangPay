import { randomUUID } from "node:crypto";
import type { VirtualCardProvider } from "./base.js";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

export class StripeIssuingProvider implements VirtualCardProvider {
  private stripe: any;
  private cardholderId: string | null = null;

  constructor(apiKey: string) {
    // Lazy import — stripe is an optional dependency
    try {
      const Stripe = require("stripe");
      this.stripe = new Stripe(apiKey);
    } catch {
      throw new Error("stripe package required. Install with: npm install stripe");
    }
  }

  async issueCard(intent: PaymentIntent, policy: GuardrailPolicy): Promise<VirtualSeal> {
    try {
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

      if (!this.cardholderId) {
        const cardholder = await this.stripe.issuing.cardholders.create({
          type: "individual",
          name: "POP Agent",
          billing: {
            address: {
              line1: "123 AI St",
              city: "San Francisco",
              state: "CA",
              postal_code: "94105",
              country: "US",
            },
          },
        });
        this.cardholderId = cardholder.id;
      }

      const card = await this.stripe.issuing.cards.create({
        cardholder: this.cardholderId,
        type: "virtual",
        currency: "usd",
        spending_controls: {
          spending_limits: [
            {
              amount: Math.round(intent.requestedAmount * 100),
              interval: "all_time",
            },
          ],
        },
      });

      return {
        sealId: randomUUID(),
        cardNumber: `****${card.last4}`,
        cvv: "***",
        expirationDate: `${card.exp_month}/${card.exp_year}`,
        authorizedAmount: intent.requestedAmount,
        status: "Issued",
        rejectionReason: null,
      };
    } catch (e: any) {
      return {
        sealId: randomUUID(),
        cardNumber: null,
        cvv: null,
        expirationDate: null,
        authorizedAmount: 0.0,
        status: "Rejected",
        rejectionReason: String(e.message ?? e),
      };
    }
  }
}
