import { randomUUID } from "node:crypto";
import type { VirtualCardProvider } from "./base.js";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

export class MockStripeProvider implements VirtualCardProvider {
  async issueCard(intent: PaymentIntent, policy: GuardrailPolicy): Promise<VirtualSeal> {
    if (intent.requestedAmount > policy.maxAmountPerTx) {
      return {
        sealId: randomUUID(),
        cardNumber: null,
        cvv: null,
        expirationDate: null,
        authorizedAmount: 0.0,
        status: "Rejected",
        rejectionReason: `Exceeds single transaction limit of ${policy.maxAmountPerTx}`,
      };
    }

    const cardNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
    const cvv = Array.from({ length: 3 }, () => Math.floor(Math.random() * 10)).join("");
    const expDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const expirationDate = `${String(expDate.getMonth() + 1).padStart(2, "0")}/${String(expDate.getFullYear()).slice(-2)}`;

    return {
      sealId: randomUUID(),
      cardNumber,
      cvv,
      expirationDate,
      authorizedAmount: intent.requestedAmount,
      status: "Issued",
      rejectionReason: null,
    };
  }
}
