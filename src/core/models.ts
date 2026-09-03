import { z } from "zod";

export const GuardrailPolicySchema = z.object({
  allowedCategories: z.array(z.string()).default([]),
  maxAmountPerTx: z.number().positive(),
  maxDailyBudget: z.number().positive(),
  blockHallucinationLoops: z.boolean().default(true),
  webhookUrl: z.string().nullable().default(null),
});

export type GuardrailPolicy = z.infer<typeof GuardrailPolicySchema>;

export const PaymentIntentSchema = z.object({
  agentId: z.string(),
  requestedAmount: z.number().positive(),
  targetVendor: z.string().max(200),
  reasoning: z.string().max(2000),
  pageUrl: z.string().nullable().default(null),
});

export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;

export interface VirtualSeal {
  sealId: string;
  cardNumber: string | null;
  cvv: string | null;
  expirationDate: string | null;
  authorizedAmount: number;
  status: "Issued" | "Rejected" | "Revoked" | "Used" | "Pending";
  rejectionReason: string | null;
  metadata?: Record<string, unknown>;
}

export function sealToString(seal: VirtualSeal): string {
  return `VirtualSeal(sealId=${JSON.stringify(seal.sealId)}, status=${JSON.stringify(seal.status)}, cardNumber='****-REDACTED', cvv='***', authorizedAmount=${seal.authorizedAmount})`;
}
