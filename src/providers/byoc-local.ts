import { randomUUID } from "node:crypto";
import type { VirtualCardProvider } from "./base.js";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

export class LocalVaultProvider implements VirtualCardProvider {
  readonly cardNumber: string;
  readonly expMonth: string;
  readonly expYear: string;
  readonly cvv: string;
  readonly billingInfo: Record<string, string>;

  constructor(creds?: {
    card_number?: string;
    cvv?: string;
    exp_month?: string;
    exp_year?: string;
  }) {
    // Prefer explicitly injected creds (vault path). Env fallback is for users
    // who set HANGPAY_BYOC_* manually in .env without a vault. Plaintext PAN/CVV
    // no longer round-trips through process.env when coming from vault (S0.7 F1).
    this.cardNumber = creds?.card_number ?? process.env.HANGPAY_BYOC_NUMBER ?? "";
    this.expMonth = creds?.exp_month ?? process.env.HANGPAY_BYOC_EXP_MONTH ?? "";
    this.expYear = creds?.exp_year ?? process.env.HANGPAY_BYOC_EXP_YEAR ?? "";
    this.cvv = creds?.cvv ?? process.env.HANGPAY_BYOC_CVV ?? "";

    if (!this.cardNumber || !this.expMonth || !this.expYear || !this.cvv) {
      throw new Error(
        "Missing BYOC credentials. Configure via vault (`hangpay init-vault`) or env (HANGPAY_BYOC_NUMBER, HANGPAY_BYOC_EXP_MONTH, HANGPAY_BYOC_EXP_YEAR, HANGPAY_BYOC_CVV)."
      );
    }

    this.billingInfo = {
      firstName: process.env.HANGPAY_BILLING_FIRST_NAME?.trim() ?? "",
      lastName: process.env.HANGPAY_BILLING_LAST_NAME?.trim() ?? "",
      street: process.env.HANGPAY_BILLING_STREET?.trim() ?? "",
      city: process.env.HANGPAY_BILLING_CITY?.trim() ?? "",
      state: process.env.HANGPAY_BILLING_STATE?.trim() ?? "",
      country: process.env.HANGPAY_BILLING_COUNTRY?.trim() ?? "",
      zip: process.env.HANGPAY_BILLING_ZIP?.trim() ?? "",
      email: process.env.HANGPAY_BILLING_EMAIL?.trim() ?? "",
      phone: process.env.HANGPAY_BILLING_PHONE?.trim() ?? "",
      phoneCountryCode: process.env.HANGPAY_BILLING_PHONE_COUNTRY_CODE?.trim() ?? "",
    };
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

    return {
      sealId: randomUUID(),
      cardNumber: this.cardNumber,
      cvv: this.cvv,
      expirationDate: `${this.expMonth}/${this.expYear}`,
      authorizedAmount: intent.requestedAmount,
      status: "Issued",
      rejectionReason: null,
    };
  }
}