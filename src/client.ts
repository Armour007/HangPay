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

    this.stateTracker.recordSeal(
      seal.sealId,
      seal.authorizedAmount,
      intent.targetVendor,
      seal.status,
      maskedCard,
      seal.expirationDate,
      seal.rejectionReason,
    );

    if (seal.status !== "Rejected") {
      this.stateTracker.addSpend(intent.requestedAmount);
    }
    return seal;
  }

  async executePayment(sealId: string, amount: number): Promise<{ status: string; reason?: string; amount?: number }> {
    if (this.stateTracker.isUsed(sealId)) {
      return { status: "rejected", reason: "Burn-after-use enforced" };
    }
    this.stateTracker.markUsed(sealId);
    return { status: "success", amount };
  }
}
