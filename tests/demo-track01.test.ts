import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RazorpayProvider } from "../src/providers/razorpay.js";
import { processRazorpayWebhook, pollPaymentLinkStatus } from "../src/demo/webhook.js";
import { PopStateTracker } from "../src/core/state.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Razorpay Webhook Signature Verification", () => {
  const webhookSecret = "test_webhook_secret";
  const webhookPayload = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: {
        entity: {
          id: "plink_test123",
          status: "paid",
          amount: 149900,
          currency: "INR",
        },
      },
    },
  });

  it("verifies valid signature", () => {
    const crypto = require("node:crypto");
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("base64");

    const isValid = RazorpayProvider.verifyWebhookSignature(webhookPayload, signature, webhookSecret);
    expect(isValid).toBe(true);
  });

  it("rejects invalid signature", () => {
    const isValid = RazorpayProvider.verifyWebhookSignature(webhookPayload, "invalid_signature", webhookSecret);
    expect(isValid).toBe(false);
  });

  it("rejects tampered payload", () => {
    const crypto = require("node:crypto");
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("base64");

    const tamperedPayload = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_test123",
            status: "expired",
            amount: 149900,
            currency: "INR",
          },
        },
      },
    });
    const isValid = RazorpayProvider.verifyWebhookSignature(tamperedPayload, signature, webhookSecret);
    expect(isValid).toBe(false);
  });
});

describe("Razorpay Webhook Processing", () => {
  const webhookSecret = "test_webhook_secret";

  it("processes valid payment_link.paid webhook", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    const stateTracker = new PopStateTracker(dbPath);

    try {
      const crypto = require("node:crypto");
      const webhookPayload = JSON.stringify({
        event: "payment_link.paid",
        payload: {
          payment_link: {
            entity: {
              id: "plink_webhook_123",
              status: "paid",
              amount: 149900,
              currency: "INR",
            },
          },
        },
      });

      const webhookSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(webhookPayload)
        .digest("base64");

      // First create a seal with this payment link
      stateTracker.db.prepare(
        `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "seal_webhook_123",
        18.06,
        "Nova Gear",
        "Issued",
        "****-1234",
        "12/99",
        new Date().toISOString(),
        null,
        "plink_webhook_123"
      );

      const result = await processRazorpayWebhook(webhookPayload, webhookSignature, webhookSecret, stateTracker);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("paid");
      expect(result.sealId).toBe("seal_webhook_123");

      // Verify seal status updated
      const seal = stateTracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get("seal_webhook_123") as any;
      expect(seal.status).toBe("PAID");

      // Verify audit log
      const audit = stateTracker.db.prepare("SELECT * FROM audit_log WHERE event_type = ?").get("payment_webhook") as any;
      expect(audit).toBeDefined();
      expect(audit.outcome).toBe("paid");
    } finally {
      stateTracker.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid webhook signature", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    const stateTracker = new PopStateTracker(dbPath);

    try {
      const payload = JSON.stringify({
        event: "payment_link.paid",
        payload: {
          payment_link: {
            entity: { id: "plink_test123", status: "paid", amount: 149900, currency: "INR" },
          },
        },
      });

      const result = await processRazorpayWebhook(payload, "invalid_signature", webhookSecret, stateTracker);
      expect(result.success).toBe(false);
      expect(result.outcome).toBe("error");
      expect(result.error).toBe("Invalid webhook signature");
    } finally {
      stateTracker.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects tampered payload", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    const stateTracker = new PopStateTracker(dbPath);

    try {
      const crypto = require("node:crypto");
      const webhookSecret = "test_secret";
      const webhookPayload = JSON.stringify({
        event: "payment_link.paid",
        payload: { payment_link: { entity: { id: "plink_123", status: "paid", amount: 10000, currency: "INR" } } },
      });
      const signature = crypto.createHmac("sha256", webhookSecret).update(webhookPayload).digest("base64");

      const tamperedPayload = JSON.stringify({
        event: "payment_link.paid",
        payload: { payment_link: { entity: { id: "plink_123", status: "expired", amount: 10000, currency: "INR" } } },
      });

      const result = await processRazorpayWebhook(tamperedPayload, signature, webhookSecret, stateTracker);
      expect(result.success).toBe(false);
      expect(result.outcome).toBe("error");
    } finally {
      stateTracker.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles idempotent webhook delivery (duplicate paid event)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    const stateTracker = new PopStateTracker(dbPath);

    try {
      const crypto = require("node:crypto");
      const webhookSecret = "test_secret";

      // Create seal with PAID status
      const sealId = "seal_idempotent_" + Date.now();
      stateTracker.db.prepare(
        `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(sealId, 18.06, "Nova Gear", "PAID", "****-1234", "12/99", new Date().toISOString(), null, "plink_idem");

      const webhookPayload = JSON.stringify({
        event: "payment_link.paid",
        payload: { payment_link: { entity: { id: "plink_idem", status: "paid", amount: 10000, currency: "INR" } } },
      });
      const signature = crypto.createHmac("sha256", webhookSecret).update(webhookPayload).digest("base64");

      const result = await processRazorpayWebhook(webhookPayload, signature, webhookSecret, stateTracker);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("paid");

      // Verify status unchanged
      const seal = stateTracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get(sealId) as any;
      expect(seal.status).toBe("PAID");
    } finally {
      stateTracker.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles payment_link.expired webhook", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    const stateTracker = new PopStateTracker(dbPath);

    try {
      const crypto = require("node:crypto");
      const webhookSecret = "test_secret";

      const sealId = "seal_expired_" + Date.now();
      stateTracker.db.prepare(
        `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(sealId, 18.06, "Nova Gear", "Issued", "****-1234", "12/99", new Date().toISOString(), null, "plink_expired");

      const payload = JSON.stringify({
        event: "payment_link.expired",
        payload: { payment_link: { entity: { id: "plink_expired", status: "expired", amount: 10000, currency: "INR" } } },
      });
      const signature = crypto.createHmac("sha256", webhookSecret).update(payload).digest("base64");

      const result = await processRazorpayWebhook(payload, signature, webhookSecret, stateTracker);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe("expired");

      const seal = stateTracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get(sealId) as any;
      expect(seal.status).toBe("EXPIRED");
    } finally {
      stateTracker.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Payment Link Polling", () => {
  it("polls until paid", async () => {
    const mockProvider = {
      razorpay: {
        paymentLink: {
          fetch: vi.fn()
            .mockResolvedValueOnce({ status: "pending" })
            .mockResolvedValueOnce({ status: "pending" })
            .mockResolvedValueOnce({ status: "paid" }),
        },
      },
    };

    const result = await pollPaymentLinkStatus(mockProvider, "plink_123", 5, 10);
    expect(result).toBe("paid");
  });

  it("returns expired status", async () => {
    const mockProvider = {
      razorpay: {
        paymentLink: {
          fetch: vi.fn().mockResolvedValue({ status: "expired" }),
        },
      },
    };

    const result = await pollPaymentLinkStatus(mockProvider, "plink_expired", 5, 10);
    expect(result).toBe("expired");
  });

  it("returns timeout after max attempts", async () => {
    const mockProvider = {
      razorpay: {
        paymentLink: {
          fetch: vi.fn().mockResolvedValue({ status: "pending" }),
        },
      },
    };

    const result = await pollPaymentLinkStatus(mockProvider, "plink_timeout", 3, 10);
    expect(result).toBe("timeout");
  });
});