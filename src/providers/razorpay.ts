import { randomUUID } from "node:crypto";
import type { VirtualCardProvider } from "./base.js";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

export class RazorpayProvider implements VirtualCardProvider {
  private razorpay: any;
  private contactId: string | null = null;
  private accountId: string | null = null;

  constructor(keyId: string, keySecret: string) {
    // Lazy import — razorpay is an optional dependency
    try {
      const Razorpay = require("razorpay");
      this.razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
    } catch {
      throw new Error("razorpay package required. Install with: npm install razorpay");
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

      // For Razorpay, we create a payment link or virtual card via RazorpayX
      // Since Razorpay doesn't have direct virtual card issuing like Stripe,
      // we create a payment link that the agent can use
      if (!this.contactId) {
        const contact = await this.razorpay.contacts.create({
          name: "HangPay Agent",
          email: "agent@hangpay.dev",
          contact: "9999999999",
          type: "vendor",
          reference_id: "hangpay_agent_001",
        });
        this.contactId = contact.id;
      }

      // Create a payment link for the exact amount
      const paymentLink = await this.razorpay.paymentLink.create({
        amount: Math.round(intent.requestedAmount * 100), // Razorpay expects paise
        currency: "INR",
        accept_partial: false,
        description: `Nova Gear: ${intent.targetVendor}`,
        customer: {
          name: "HangPay Agent",
          contact: "9999999999",
          email: "agent@hangpay.dev",
        },
        notify: {
          sms: true,
          email: true,
        },
        reminder_enable: true,
        notes: {
          hangpay_seal: "true",
          vendor: intent.targetVendor,
          amount: String(intent.requestedAmount),
        },
        callback_url: "https://hangpay.dev/callback",
        callback_method: "get",
      });

      // Generate a virtual card representation from the payment link
      // In production, this would integrate with RazorpayX virtual cards
      const virtualCardLast4 = this.generateVirtualCardLast4(paymentLink.id);

      return {
        sealId: randomUUID(),
        cardNumber: `****${virtualCardLast4}`,
        cvv: "***",
        expirationDate: "12/99", // Payment links don't expire like cards
        authorizedAmount: intent.requestedAmount,
        status: "Issued",
        rejectionReason: null,
        metadata: {
          provider: "razorpay",
          payment_link_id: paymentLink.id,
          payment_link_url: paymentLink.short_url,
          currency: "INR",
        },
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

  /**
   * Fetch payment link status from Razorpay for polling fallback.
   * Returns the payment link status: "paid" | "expired" | "cancelled" | "pending"
   */
  async fetchPaymentLinkStatus(paymentLinkId: string): Promise<"paid" | "expired" | "cancelled" | "pending" | "error"> {
    try {
      const link = await this.razorpay.paymentLink.fetch(paymentLinkId);
      return link.status as "paid" | "expired" | "cancelled" | "pending";
    } catch (e: any) {
      console.error(`[RazorpayProvider] Failed to fetch payment link ${paymentLinkId}:`, e);
      return "error";
    }
  }

  /**
   * Fetch full payment link details from Razorpay.
   */
  async fetchPaymentLink(paymentLinkId: string): Promise<any> {
    try {
      return await this.razorpay.paymentLink.fetch(paymentLinkId);
    } catch (e: any) {
      console.error(`[RazorpayProvider] Failed to fetch payment link ${paymentLinkId}:`, e);
      return null;
    }
  }

  private generateVirtualCardLast4(paymentLinkId: string): string {
    // Generate a deterministic last 4 from payment link ID
    let hash = 0;
    for (let i = 0; i < paymentLinkId.length; i++) {
      hash = ((hash << 5) - hash) + paymentLinkId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 10000).toString().padStart(4, "0");
  }

  // RazorpayX Payout functionality
  async createPayout(
    amount: number,
    currency: string,
    recipient: {
      account_number: string;
      ifsc: string;
      name: string;
      email?: string;
      contact?: string;
    },
    purpose: string = "vendor_payout"
  ): Promise<{ success: boolean; payoutId?: string; error?: string }> {
    try {
      const fundAccount = await this.razorpay.fundAccounts.create({
        contact_id: this.contactId,
        account_type: "bank_account",
        bank_account: {
          name: recipient.name,
          account_number: recipient.account_number,
          ifsc: recipient.ifsc,
        },
      });

      const payout = await this.razorpay.payouts.create({
        account_number: process.env.HANGPAY_RAZORPAYX_ACCOUNT_ID || "2323230044123456",
        amount: Math.round(amount * 100),
        currency,
        fund_account_id: fundAccount.id,
        purpose,
        queue_if_low_balance: true,
        reference_id: `hangpay_payout_${Date.now()}`,
        narration: `HangPay payout to ${recipient.name}`,
      });

      return { success: true, payoutId: payout.id };
    } catch (e: any) {
      return { success: false, error: String(e.message ?? e) };
    }
  }

  // Verify Razorpay webhook signature
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    webhookSecret: string
  ): boolean {
    const crypto = require("node:crypto");
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}