import { randomUUID } from "node:crypto";
import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "./core/models.js";
import type { VirtualCardProvider } from "./providers/base.js";
import { GuardrailEngine } from "./engine/guardrails.js";
import { PopStateTracker } from "./core/state.js";
import { PopPayLLMError } from "./errors.js";

export class PopClient {
  provider: VirtualCardProvider;
  policy: GuardrailPolicy;
  stateTracker: PopStateTracker;
  engine: GuardrailEngine;

  constructor(
    provider: VirtualCardProvider,
    policy: GuardrailPolicy,
    engine?: GuardrailEngine,
    dbPath?: string
  ) {
    this.provider = provider;
    this.policy = policy;
    // When dbPath is undefined, PopStateTracker uses its own DEFAULT_DB_PATH
    // (~/.config/hangpay/pop_state.db) — same path as the dashboard reader.
    // Passing a hardcoded relative default here caused the MCP server to write
    // to ./pop_state.db in the CWD while the dashboard read from ~/.config,
    // which is why npm dashboard "today spending" was stuck at $0.
    this.stateTracker = dbPath ? new PopStateTracker(dbPath) : new PopStateTracker();
    this.engine = engine ?? new GuardrailEngine();
  }

  async processPayment(intent: PaymentIntent): Promise<VirtualSeal> {
    // Check daily budget
    if (!this.stateTracker.canSpend(intent.requestedAmount, this.policy.maxDailyBudget)) {
      const seal: VirtualSeal = {
        sealId: randomUUID(),
        cardNumber: null,
        cvv: null,
        expirationDate: null,
        authorizedAmount: 0.0,
        status: "Rejected",
        rejectionReason: "Daily budget exceeded",
      };
      this.stateTracker.recordSeal(
        seal.sealId,
        seal.authorizedAmount,
        intent.targetVendor,
        seal.status,
        null,
        null,
        seal.rejectionReason,
      );
      return seal;
    }

    // Evaluate intent. Typed PopPayLLMError (RetryExhausted / ProviderUnreachable /
    // InvalidResponse) must surface as evaluation-failure, not a guardrail block —
    // otherwise quota burn or transport faults masquerade as policy rejections.
    let approved: boolean;
    let reason: string;
    try {
      [approved, reason] = await this.engine.evaluateIntent(intent, this.policy);
    } catch (e) {
      if (e instanceof PopPayLLMError) {
        const seal: VirtualSeal = {
          sealId: randomUUID(),
          cardNumber: null,
          cvv: null,
          expirationDate: null,
          authorizedAmount: 0.0,
          status: "Rejected",
          rejectionReason: `evaluation_failed:${e.code}:${e.message}`,
        };
        this.stateTracker.recordSeal(
          seal.sealId,
          seal.authorizedAmount,
          intent.targetVendor,
          seal.status,
          null,
          null,
          seal.rejectionReason,
        );
        return seal;
      }
      throw e;
    }
    if (!approved) {
      const seal: VirtualSeal = {
        sealId: randomUUID(),
        cardNumber: null,
        cvv: null,
        expirationDate: null,
        authorizedAmount: 0.0,
        status: "Rejected",
        rejectionReason: reason,
      };
      this.stateTracker.recordSeal(
        seal.sealId,
        seal.authorizedAmount,
        intent.targetVendor,
        seal.status,
        null,
        null,
        seal.rejectionReason,
      );
      return seal;
    }

    // Issue card — record as Pending until injection confirms
    const seal = await this.provider.issueCard(intent, this.policy);
    const maskedCard = seal.cardNumber
      ? `****-****-****-${seal.cardNumber.slice(-4)}`
      : "****-****-****-????";

    if (seal.status !== "Rejected") {
      seal.status = "Pending";
    }

    // Extract Razorpay payment link ID from metadata if present
    const razorpayPaymentLinkId = seal.metadata?.payment_link_id as string | undefined;

    this.stateTracker.recordSeal(
      seal.sealId,
      seal.authorizedAmount,
      intent.targetVendor,
      seal.status,
      maskedCard,
      seal.expirationDate,
      seal.rejectionReason,
      razorpayPaymentLinkId ?? null
    );

    if (seal.status !== "Rejected") {
      this.stateTracker.addSpend(intent.requestedAmount);
    }
    return seal;
  }

  /**
   * Poll Razorpay payment link status until paid, expired, cancelled, or timeout.
   * This is a fallback for when webhook is not received.
   */
  async pollPaymentLinkStatus(
    sealId: string,
    paymentLinkId: string,
    maxAttempts: number = 30,
    intervalMs: number = 5000
  ): Promise<"paid" | "expired" | "cancelled" | "timeout" | "error"> {
    // Check if provider is RazorpayProvider
    const provider = this.provider as any;
    if (typeof provider.fetchPaymentLinkStatus !== "function") {
      return "error";
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await provider.fetchPaymentLinkStatus(paymentLinkId);
        
        if (status === "paid") {
          this.stateTracker.updateSealStatus(sealId, "Paid");
          await this.recordPaymentCompletion(sealId, "paid", paymentLinkId);
          return "paid";
        }
        if (status === "expired") {
          this.stateTracker.updateSealStatus(sealId, "Expired");
          await this.recordPaymentCompletion(sealId, "expired", paymentLinkId);
          return "expired";
        }
        if (status === "cancelled") {
          this.stateTracker.updateSealStatus(sealId, "Cancelled");
          await this.recordPaymentCompletion(sealId, "cancelled", paymentLinkId);
          return "cancelled";
        }
        // pending -> continue polling
      } catch (e) {
        console.error(`[PopClient] Error polling payment link ${paymentLinkId}:`, e);
      }
      
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return "timeout";
  }

  /**
   * Record payment completion in audit trail and update seal metadata.
   */
  private async recordPaymentCompletion(
    sealId: string,
    outcome: "paid" | "expired" | "cancelled",
    paymentLinkId: string
  ): Promise<void> {
    const statusMap: Record<string, "Paid" | "Expired" | "Cancelled"> = {
      paid: "Paid",
      expired: "Expired",
      cancelled: "Cancelled",
    };
    
    const newStatus = statusMap[outcome];
    this.stateTracker.updateSealStatus(sealId, newStatus);
    
    // Update Razorpay-specific metadata
    const now = new Date().toISOString();
    this.stateTracker.getDb()
      .prepare(
        `UPDATE issued_seals SET 
          razorpay_webhook_verified_at = ?,
          razorpay_webhook_event = ?
        WHERE seal_id = ?`
      )
      .run(new Date().toISOString(), `payment_link.${outcome}`, sealId);
    
    // Record audit event
    this.stateTracker.recordAuditEvent(
      "payment_webhook",
      null, // vendor will be looked up from seal
      `Razorpay payment link ${outcome}`,
      outcome,
      null
    );
  }

  async executePayment(sealId: string, amount: number): Promise<{ status: string; reason?: string; amount?: number }> {
    if (this.stateTracker.isUsed(sealId)) {
      return { status: "rejected", reason: "Burn-after-use enforced" };
    }
    this.stateTracker.markUsed(sealId);
    return { status: "success", amount };
  }
}
