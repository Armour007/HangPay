/**
 * Nova Gear — Razorpay Webhook Handler with Signature Verification
 * 
 * Handles Razorpay webhook events (payment_link.paid, payment_link.expired)
 * with signature verification and idempotency.
 */

import type { PopStateTracker } from "../core/state.js";
import { RazorpayProvider } from "../providers/razorpay.js";

export interface WebhookEvent {
  event: string;
  payload: {
    payment_link: {
      entity: {
        id: string;
        status: "paid" | "expired" | "cancelled";
        amount: number;
        currency: string;
        reference_id?: string;
      };
    };
  };
}

export interface WebhookResult {
  success: boolean;
  sealId?: string;
  outcome?: "paid" | "expired" | "cancelled" | "error" | "ignored";
  error?: string;
}

/**
 * Process a Razorpay webhook event with signature verification and idempotency.
 * 
 * @param payload - Raw webhook payload body as string
 * @param signature - Razorpay signature from x-razorpay-signature header
 * @param webhookSecret - Webhook secret from Razorpay dashboard
 * @param stateTracker - PopStateTracker instance for DB operations
 * @returns WebhookResult with outcome
 */
export async function processRazorpayWebhook(
  payload: string,
  signature: string,
  webhookSecret: string,
  stateTracker: PopStateTracker
): Promise<WebhookResult> {
  // 1. Verify webhook signature
  if (!RazorpayProvider.verifyWebhookSignature(payload, signature, webhookSecret)) {
    return { success: false, outcome: "error", error: "Invalid webhook signature" };
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(payload) as WebhookEvent;
  } catch {
    return { success: false, outcome: "error", error: "Invalid JSON payload" };
  }

  // Validate event structure
  if (!event.event || !event.payload?.payment_link?.entity?.id) {
    return { success: false, outcome: "error", error: "Invalid event structure" };
  }

  const paymentLinkEntity = event.payload.payment_link.entity;
  const paymentLinkId = paymentLinkEntity.id;
  const razorpayStatus = paymentLinkEntity.status; // "paid" | "expired" | "cancelled"

  // Find the seal by payment_link_id (stored in metadata)
  const db = stateTracker.getDb();
  const sealRow = db
    .prepare(
      `SELECT seal_id, vendor, amount, status, metadata FROM issued_seals 
       WHERE json_extract(metadata, '$.payment_link_id') = ?`
    )
    .get(paymentLinkId) as { seal_id: string; vendor: string; amount: number; status: string; metadata: string | null } | undefined;

  if (!sealRow) {
    // Seal not found — could be a race condition or invalid payment link
    // Log but don't error (idempotent: we might not have the seal yet if webhook fires before seal creation)
    console.warn(`[Webhook] No seal found for payment_link_id: ${paymentLinkId}`);
    return { success: true, outcome: "ignored" };
  }

  const sealId = sealRow.seal_id;
  const currentStatus = db
    .prepare("SELECT status FROM issued_seals WHERE seal_id = ?")
    .get(sealId) as { status: string } | undefined;

  if (!currentStatus) {
    return { success: false, outcome: "error", error: "Seal not found after lookup" };
  }

  // Idempotency: if already processed to PAID/EXPIRED, return success without double-processing
  const currentSealStatus = currentStatus.status.toUpperCase();
  if (currentSealStatus === "PAID" || currentSealStatus === "EXPIRED" || currentSealStatus === "CANCELLED") {
    return { success: true, sealId, outcome: currentSealStatus.toLowerCase() as "paid" | "expired" | "cancelled" };
  }

  // Map Razorpay status to HangPay status
  let newStatus: "PAID" | "EXPIRED" | "CANCELLED" | "ERROR";
  let outcome: "paid" | "expired" | "cancelled" | "error";

  switch (razorpayStatus) {
    case "paid":
      newStatus = "PAID";
      outcome = "paid";
      break;
    case "expired":
      newStatus = "EXPIRED";
      outcome = "expired";
      break;
    case "cancelled":
      newStatus = "CANCELLED";
      outcome = "cancelled";
      break;
    default:
      newStatus = "ERROR";
      outcome = "error";
  }

  // Update seal status
  stateTracker.updateSealStatus(sealRow.seal_id, newStatus);

  // Record audit event
  const timestamp = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO audit_log (event_type, vendor, reasoning, outcome, rejection_reason, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      "payment_webhook",
      sealRow.vendor,
      `Razorpay webhook: ${event.event}`,
      outcome,
      null,
      new Date().toISOString()
    );

  return { success: true, sealId, outcome };
}

/**
 * Fallback: Poll Razorpay for payment link status.
 * Used when webhook is not received within timeout.
 */
export async function pollPaymentLinkStatus(
  razorpayProvider: any, // RazorpayProvider instance
  paymentLinkId: string,
  maxAttempts: number = 30,
  intervalMs: number = 5000
): Promise<"paid" | "expired" | "cancelled" | "timeout"> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const link = await razorpayProvider.razorpay.paymentLink.fetch(paymentLinkId);
      const status = link.status as "paid" | "expired" | "cancelled" | "pending";
      
      if (status === "paid") return "paid";
      if (status === "expired") return "expired";
      if (status === "cancelled") return "cancelled";
      // pending -> continue polling
    } catch (e) {
      console.warn(`[Poll] Error fetching payment link ${paymentLinkId}:`, e);
    }
    
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "timeout";
}