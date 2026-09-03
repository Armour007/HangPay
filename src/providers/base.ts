import type { PaymentIntent, GuardrailPolicy, VirtualSeal } from "../core/models.js";

export interface VirtualCardProvider {
  issueCard(intent: PaymentIntent, policy: GuardrailPolicy): Promise<VirtualSeal>;
}
