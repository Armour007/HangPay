import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RazorpayProvider } from "../src/providers/razorpay.js";
import { processRazorpayWebhook, pollPaymentLinkStatus } from "../src/demo/webhook.js";
import { PopStateTracker } from "../src/core/state.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the razorpay module at the top level
vi.mock("razorpay", () => {
  const mockInstance = {
    contacts: {
      create: vi.fn().mockResolvedValue({ id: "contact_123" }),
    },
    paymentLink: {
      create: vi.fn().mockResolvedValue({
        id: "plink_test123",
        short_url: "https://rzp.io/i/test123",
        status: "pending",
      }),
      fetch: vi.fn().mockResolvedValue({ id: "plink_test123", status: "paid" }),
    },
    fundAccounts: {
      create: vi.fn(),
    },
    payouts: {
      create: vi.fn(),
    },
  };
  return {
    default: vi.fn().mockImplementation(() => mockRazorpay),
  };
});

const mockRazorpay = {
  contacts: {
    create: vi.fn().mockResolvedValue({ id: "contact_123" }),
  },
  paymentLink: {
    create: vi.fn().mockResolvedValue({
      id: "plink_test123",
      short_url: "https://rzp.io/i/test123",
      status: "pending",
    }),
    fetch: vi.fn().mockResolvedValue({ id: "plink_test123", status: "paid" }),
  },
  fundAccounts: {
    create: vi.fn(),
  },
  payouts: {
    create: vi.fn(),
  },
};

vi.mock("razorpay", () => ({
  default: vi.fn().mockImplementation(() => mockRazorpay),
}));

describe("RazorpayProvider", () => {
  let provider: RazorpayProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RazorpayProvider("rzp_test_key", "test_secret");
  });

  it("creates a payment link for valid intent", async () => {
    const intent = {
      agentId: "test-agent",
      requestedAmount: 100,
      targetVendor: "Nova Gear",
      reasoning: "Test purchase",
      pageUrl: null,
    };
    const policy = {
      allowedCategories: ["nova-gear"],
      maxAmountPerTx: 1000,
      maxDailyBudget: 5000,
      blockHallucinationLoops: true,
      webhookUrl: null,
    };

    const seal = await provider.issueCard(intent, policy);

    expect(seal.status).toBe("Issued");
    expect(seal.metadata?.payment_link_id).toBe("plink_test123");
    expect(seal.metadata?.payment_link_url).toBe("https://rzp.io/i/test123");
    expect(seal.metadata?.currency).toBe("INR");
  });

  it("rejects payment exceeding max amount per transaction", async () => {
    const intent = {
      agentId: "test-agent",
      requestedAmount: 2000,
      targetVendor: "Nova Gear",
      reasoning: "Test purchase",
      pageUrl: null,
    };
    const policy = {
      allowedCategories: ["nova-gear"],
      maxAmountPerTx: 1000,
      maxDailyBudget: 5000,
      blockHallucinationLoops: true,
      webhookUrl: null,
    };

    const seal = await provider.issueCard(intent, policy);

    expect(seal.status).toBe("Rejected");
    expect(seal.rejectionReason).toBe("Amount exceeds policy limit");
  });

  it("fetches payment link status", async () => {
    const status = await provider.fetchPaymentLinkStatus("plink_test123");
    expect(status).toBe("paid");
  });

  it("fetches payment link details", async () => {
    const link = await provider.fetchPaymentLink("plink_test123");
    expect(link).toEqual({ id: "plink_test123", status: "paid" });
  });
});

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
    const crypto = require("node:crypto");
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("base64");

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
  let stateTracker: PopStateTracker;
  let tmpDir: string;
  const webhookSecret = "test_webhook_secret";

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "hangpay-webhook-test-"));
    const dbPath = join(tmpDir, "test.db");
    stateTracker = new PopStateTracker(dbPath);
  });

  afterEach(() => {
    stateTracker.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const createSeal = (sealId: string, paymentLinkId: string, status: string = "Issued") => {
    const db = stateTracker.getDb();
    db.prepare(
      `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sealId,
      1499 / 83,
      "Nova Gear",
      "Issued",
      "****-1234",
      "12/99",
      new Date().toISOString(),
      null,
      "plink_test123"
    );
  };

  it("processes valid payment_link.paid webhook", async () => {
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

    const crypto = require("node:crypto");
    const webhookSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload)
      .digest("base64");

    // First create a seal with this payment link
    const dbPath = join(tmpdir(), "test_webhook.db");
    const tracker = new PopStateTracker(dbPath);
    tracker.db.prepare(
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
      "plink_test123"
    );

    const crypto2 = require("node:crypto");
    const webhookPayload2 = JSON.stringify({
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
    const webhookSignature2 = crypto2
      .createHmac("sha256", webhookSecret)
      .update(webhookPayload2)
      .digest("base64");

    const result = await processRazorpayWebhook(webhookPayload2, webhookSignature2, webhookSecret, tracker);

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("paid");
    expect(result.sealId).toBe("seal_webhook_123");

    // Verify seal status updated
    const seal = tracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get("seal_webhook_123") as any;
    expect(seal.status).toBe("PAID");

    // Verify audit log
    const audit = tracker.db.prepare("SELECT * FROM audit_log WHERE event_type = ?").get("payment_webhook") as any;
    expect(audit).toBeDefined();
    expect(audit.outcome).toBe("paid");

    tracker.close();
  });

  it("rejects invalid webhook signature", async () => {
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
  });

  it("rejects tampered payload", async () => {
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
  });

  it("handles idempotent webhook delivery (duplicate paid event)", async () => {
    const crypto = require("node:crypto");
    const webhookSecret = "test_secret";

    // Create seal with PAID status
    const tracker = new PopStateTracker(join(tmpdir(), "idempotent_test.db"));
    tracker.db.prepare(
      `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("seal_idempotent", 18.06, "Nova Gear", "PAID", "****-1234", "12/99", new Date().toISOString(), null, "plink_idem");

    const crypto2 = require("node:crypto");
    const webhookPayload = JSON.stringify({
      event: "payment_link.paid",
      payload: { payment_link: { entity: { id: "plink_idem", status: "paid", amount: 10000, currency: "INR" } } },
    });
    const signature = crypto2.createHmac("sha256", webhookSecret).update(webhookPayload).digest("base64");

    const result = await processRazorpayWebhook(webhookPayload, signature, webhookSecret, tracker);

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("paid");

    // Verify status unchanged
    const seal = tracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get("seal_idempotent") as any;
    expect(seal.status).toBe("PAID");

    tracker.close();
  });

  it("handles payment_link.expired webhook", async () => {
    const tracker = new PopStateTracker(join(tmpdir(), "expired_test.db"));
    tracker.db.prepare(
      `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("seal_expired", 18.06, "Nova Gear", "Issued", "****-1234", "12/99", new Date().toISOString(), null, "plink_expired");

    const crypto = require("node:crypto");
    const webhookSecret = "test_secret";
    const payload = JSON.stringify({
      event: "payment_link.expired",
      payload: { payment_link: { entity: { id: "plink_expired", status: "expired", amount: 10000, currency: "INR" } } },
    });
    const signature = crypto.createHmac("sha256", webhookSecret).update(JSON.stringify({ event: "payment_link.expired", payload: { payment_link: { entity: { id: "plink_expired", status: "expired", amount: 10000, currency: "INR" } } } })).digest("base64");

    const result = await processRazorpayWebhook(payload, signature, webhookSecret, tracker);

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("expired");

    const seal = tracker.db.prepare("SELECT status FROM issued_seals WHERE seal_id = ?").get("seal_expired") as any;
    expect(seal.status).toBe("EXPIRED");

    tracker.close();
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