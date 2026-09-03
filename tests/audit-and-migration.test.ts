/**
 * Tests for the v0.5.0 dashboard audit overhaul.
 *
 * Covers:
 * - ISO 8601 UTC timestamp format (Bug 1)
 * - rejection_reason persistence (Bug 2)
 * - daily_budget update path + Bug 3 root cause regression
 * - audit_log table + recordAuditEvent / getAuditEvents
 * - Schema migration from legacy DBs (upgrade safety)
 */
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PopStateTracker } from "../src/core/state.js";
import { PopClient } from "../src/client.js";
import { MockStripeProvider } from "../src/providers/stripe-mock.js";
import type { GuardrailPolicy, PaymentIntent } from "../src/core/models.js";

const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function makeTempDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hangpay-${label}-`));
  return path.join(dir, "pop_state.db");
}

function cleanupDbPath(dbPath: string): void {
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {
    // best effort
  }
}

describe("v0.5.0 dashboard audit overhaul", () => {
  // -------------------------------------------------------------------
  // Bug 1: ISO 8601 timestamps
  // -------------------------------------------------------------------
  describe("Bug 1: ISO 8601 timestamps", () => {
    it("recordSeal writes ISO 8601 with Z suffix", () => {
      const dbPath = makeTempDbPath("iso-seal");
      const t = new PopStateTracker(dbPath);
      t.recordSeal("s1", 10, "aws", "Issued");
      const verify = new Database(dbPath);
      const row = verify.prepare("SELECT timestamp FROM issued_seals WHERE seal_id = ?").get("s1") as any;
      expect(row).toBeDefined();
      expect(row.timestamp).toMatch(ISO_Z_RE);
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("recordAuditEvent writes ISO 8601 with Z suffix", () => {
      const dbPath = makeTempDbPath("iso-audit");
      const t = new PopStateTracker(dbPath);
      t.recordAuditEvent("purchaser_info_requested", "aws", "test");
      const events = t.getAuditEvents();
      expect(events).toHaveLength(1);
      expect(events[0].timestamp).toMatch(ISO_Z_RE);
      t.close();
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // Bug 2: rejection_reason
  // -------------------------------------------------------------------
  describe("Bug 2: rejection_reason", () => {
    it("recordSeal persists rejection_reason", () => {
      const dbPath = makeTempDbPath("rej");
      const t = new PopStateTracker(dbPath);
      t.recordSeal("r1", 0, "aws", "Rejected", null, null, "daily budget exceeded");
      const verify = new Database(dbPath);
      const row = verify.prepare("SELECT status, rejection_reason FROM issued_seals WHERE seal_id = ?").get("r1") as any;
      expect(row.status).toBe("Rejected");
      expect(row.rejection_reason).toBe("daily budget exceeded");
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("rejection_reason defaults to null when not provided", () => {
      const dbPath = makeTempDbPath("rej-null");
      const t = new PopStateTracker(dbPath);
      t.recordSeal("s1", 10, "aws", "Issued");
      const verify = new Database(dbPath);
      const row = verify.prepare("SELECT rejection_reason FROM issued_seals WHERE seal_id = ?").get("s1") as any;
      expect(row.rejection_reason).toBeNull();
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // Bug 3: MCP-server/dashboard DB path mismatch
  // -------------------------------------------------------------------
  describe("Bug 3: PopClient dbPath default", () => {
    it("PopClient without explicit dbPath uses PopStateTracker DEFAULT_DB_PATH (not './pop_state.db')", async () => {
      // Regression test: previously client.ts defaulted to the relative
      // "pop_state.db" which caused the MCP server to write to CWD while
      // the dashboard read from ~/.config/hangpay/pop_state.db.
      const policy: GuardrailPolicy = {
        allowedCategories: ["aws"],
        maxAmountPerTx: 100,
        maxDailyBudget: 500,
        blockHallucinationLoops: true,
      };
      const client = new PopClient(new MockStripeProvider(), policy);
      // @ts-expect-error access private field via indexed access for test
      const actualPath = client.stateTracker["db"].name as string;
      const expected = path.join(os.homedir(), ".config", "hangpay", "pop_state.db");
      expect(actualPath).toBe(expected);
      client.stateTracker.close();
    });

    it("PopClient with explicit dbPath uses it and addSpend updates daily_budget in the same file", async () => {
      const dbPath = makeTempDbPath("bug3");
      const policy: GuardrailPolicy = {
        allowedCategories: ["aws"],
        maxAmountPerTx: 100,
        maxDailyBudget: 500,
        blockHallucinationLoops: true,
      };
      const client = new PopClient(new MockStripeProvider(), policy, undefined, dbPath);
      const intent: PaymentIntent = {
        agentId: "test",
        requestedAmount: 25,
        targetVendor: "aws",
        reasoning: "test",
        pageUrl: null,
      };
      await client.processPayment(intent);

      // Dashboard would read from this same file
      const verify = new Database(dbPath);
      const today = new Date().toISOString().slice(0, 10);
      const row = verify.prepare("SELECT spent_amount FROM daily_budget WHERE date = ?").get(today) as any;
      expect(row).toBeDefined();
      expect(row.spent_amount).toBe(25);
      verify.close();
      client.stateTracker.close();
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // audit_log
  // -------------------------------------------------------------------
  describe("audit_log", () => {
    it("audit_log table is created on init", () => {
      const dbPath = makeTempDbPath("audit-table");
      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const cols = verify.prepare("PRAGMA table_info(audit_log)").all() as any[];
      const names = new Set(cols.map((c) => c.name));
      expect(names).toEqual(new Set(["id", "event_type", "vendor", "reasoning", "outcome", "rejection_reason", "timestamp"]));
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("recordAuditEvent returns row id", () => {
      const dbPath = makeTempDbPath("audit-rowid");
      const t = new PopStateTracker(dbPath);
      const id1 = t.recordAuditEvent("purchaser_info_requested", "aws");
      const id2 = t.recordAuditEvent("purchaser_info_requested", "github");
      expect(id1).toBe(1);
      expect(id2).toBe(2);
      t.close();
      cleanupDbPath(dbPath);
    });

    it("getAuditEvents returns rows in descending order", () => {
      const dbPath = makeTempDbPath("audit-order");
      const t = new PopStateTracker(dbPath);
      t.recordAuditEvent("purchaser_info_requested", "a", "first");
      t.recordAuditEvent("purchaser_info_requested", "b", "second");
      t.recordAuditEvent("purchaser_info_requested", "c", "third");
      const events = t.getAuditEvents();
      expect(events.map((e) => e.reasoning)).toEqual(["third", "second", "first"]);
      t.close();
      cleanupDbPath(dbPath);
    });

    it("getAuditEvents respects limit", () => {
      const dbPath = makeTempDbPath("audit-limit");
      const t = new PopStateTracker(dbPath);
      for (let i = 0; i < 5; i++) {
        t.recordAuditEvent("purchaser_info_requested", `v${i}`);
      }
      expect(t.getAuditEvents(2)).toHaveLength(2);
      t.close();
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // v0.5.2 — audit_log outcome + rejection_reason
  // -------------------------------------------------------------------
  describe("audit_log outcome + rejection_reason", () => {
    it("recordAuditEvent persists outcome and rejection_reason", () => {
      const dbPath = makeTempDbPath("audit-outcome");
      const t = new PopStateTracker(dbPath);
      t.recordAuditEvent(
        "purchaser_info_requested",
        "aws",
        "buying compute",
        "approved",
      );
      t.recordAuditEvent(
        "purchaser_info_requested",
        "shady.example.com",
        "n/a",
        "rejected_vendor",
        "vendor 'shady.example.com' not in POP_ALLOWED_CATEGORIES",
      );
      const events = t.getAuditEvents();
      expect(events).toHaveLength(2);
      expect(events[0].outcome).toBe("rejected_vendor");
      expect(events[0].rejection_reason).toBe(
        "vendor 'shady.example.com' not in POP_ALLOWED_CATEGORIES",
      );
      expect(events[1].outcome).toBe("approved");
      expect(events[1].rejection_reason).toBeNull();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("legacy audit_log (no outcome/rejection_reason columns) gets migrated, existing rows default to 'unknown'", () => {
      const dbPath = makeTempDbPath("audit-legacy");
      const legacy = new Database(dbPath);
      legacy.exec(
        `CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          vendor TEXT,
          reasoning TEXT,
          timestamp TEXT NOT NULL
        )`,
      );
      legacy
        .prepare(
          "INSERT INTO audit_log (event_type, vendor, reasoning, timestamp) VALUES (?, ?, ?, ?)",
        )
        .run("purchaser_info_requested", "aws", "legacy row", "2026-04-01T12:00:00Z");
      legacy.close();

      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const cols = (verify.prepare("PRAGMA table_info(audit_log)").all() as any[]).map(
        (c) => c.name,
      );
      expect(cols).toContain("outcome");
      expect(cols).toContain("rejection_reason");
      verify.close();

      const events = t.getAuditEvents();
      expect(events).toHaveLength(1);
      expect(events[0].vendor).toBe("aws");
      expect(events[0].outcome).toBe("unknown");
      expect(events[0].rejection_reason).toBeNull();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("audit_log migration is idempotent and preserves data across opens", () => {
      const dbPath = makeTempDbPath("audit-idem");
      const legacy = new Database(dbPath);
      legacy.exec(
        `CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          vendor TEXT,
          reasoning TEXT,
          timestamp TEXT NOT NULL
        )`,
      );
      legacy
        .prepare(
          "INSERT INTO audit_log (event_type, vendor, reasoning, timestamp) VALUES (?, ?, ?, ?)",
        )
        .run("purchaser_info_requested", "aws", "legacy", "2026-04-01T12:00:00Z");
      legacy.close();

      const t1 = new PopStateTracker(dbPath);
      t1.recordAuditEvent(
        "purchaser_info_requested",
        "github",
        null,
        "approved",
      );
      t1.close();

      const t2 = new PopStateTracker(dbPath);
      const events = t2.getAuditEvents();
      expect(events).toHaveLength(2);
      const byVendor = Object.fromEntries(events.map((e) => [e.vendor, e.outcome]));
      expect(byVendor).toEqual({ aws: "unknown", github: "approved" });

      const verify = new Database(dbPath);
      const cols = new Set(
        (verify.prepare("PRAGMA table_info(audit_log)").all() as any[]).map((c) => c.name),
      );
      expect(cols).toEqual(
        new Set([
          "id",
          "event_type",
          "vendor",
          "reasoning",
          "outcome",
          "rejection_reason",
          "timestamp",
        ]),
      );
      verify.close();
      t2.close();
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // Migration from legacy DB
  // -------------------------------------------------------------------
  describe("schema migration from legacy DB", () => {
    function makeLegacyDb(label: string, withCardNumber: boolean): string {
      const dbPath = makeTempDbPath(label);
      const db = new Database(dbPath);
      if (withCardNumber) {
        db.exec(
          `CREATE TABLE issued_seals (
            seal_id TEXT PRIMARY KEY, amount REAL, vendor TEXT, status TEXT,
            card_number TEXT, cvv TEXT, expiration_date TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )`
        );
        db.prepare(
          "INSERT INTO issued_seals (seal_id, amount, vendor, status, card_number, cvv, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run("vlegacy-1", 99, "stripe", "Issued", "4111111111111111", "123", "2026-03-15 10:00:00");
      } else {
        db.exec(
          `CREATE TABLE issued_seals (
            seal_id TEXT PRIMARY KEY, amount REAL, vendor TEXT, status TEXT,
            masked_card TEXT, expiration_date TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )`
        );
        db.prepare(
          "INSERT INTO issued_seals (seal_id, amount, vendor, status, timestamp) VALUES (?, ?, ?, ?, ?)"
        ).run("legacy-1", 50, "aws", "Issued", "2026-04-01 12:00:00");
      }
      db.close();
      return dbPath;
    }

    it("adds rejection_reason column to legacy DB", () => {
      const dbPath = makeLegacyDb("mig-rej", false);
      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const cols = (verify.prepare("PRAGMA table_info(issued_seals)").all() as any[]).map((c) => c.name);
      expect(cols).toContain("rejection_reason");
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("converts legacy timestamp format to ISO 8601", () => {
      const dbPath = makeLegacyDb("mig-ts", false);
      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const row = verify.prepare("SELECT timestamp FROM issued_seals WHERE seal_id = ?").get("legacy-1") as any;
      expect(row.timestamp).toBe("2026-04-01T12:00:00Z");
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("creates audit_log table for legacy DB", () => {
      const dbPath = makeLegacyDb("mig-audit", false);
      const t = new PopStateTracker(dbPath);
      t.recordAuditEvent("purchaser_info_requested", "test");
      expect(t.getAuditEvents()).toHaveLength(1);
      t.close();
      cleanupDbPath(dbPath);
    });

    it("very-legacy migration (card_number/cvv → masked_card) preserves data", () => {
      const dbPath = makeLegacyDb("mig-vlegacy", true);
      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const cols = (verify.prepare("PRAGMA table_info(issued_seals)").all() as any[]).map((c) => c.name);
      expect(cols).not.toContain("card_number");
      expect(cols).not.toContain("cvv");
      expect(cols).toContain("rejection_reason");
      const row = verify.prepare("SELECT masked_card, timestamp FROM issued_seals WHERE seal_id = ?").get("vlegacy-1") as any;
      expect(row.masked_card).toBe("****-****-****-1111");
      expect(row.timestamp).toMatch(ISO_Z_RE);
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("migration is idempotent (running twice does not double-apply)", () => {
      const dbPath = makeLegacyDb("mig-idem", false);
      const t1 = new PopStateTracker(dbPath);
      const verify1 = new Database(dbPath);
      const ts1 = (verify1.prepare("SELECT timestamp FROM issued_seals WHERE seal_id = ?").get("legacy-1") as any).timestamp;
      verify1.close();
      t1.close();

      const t2 = new PopStateTracker(dbPath);
      const verify2 = new Database(dbPath);
      const ts2 = (verify2.prepare("SELECT timestamp FROM issued_seals WHERE seal_id = ?").get("legacy-1") as any).timestamp;
      verify2.close();
      t2.close();
      expect(ts2).toBe(ts1);
      expect(ts2.split("Z").length - 1).toBe(1); // exactly one Z
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // RT-2 R2 N1 — VACUUM + secure_delete scrub freelist PAN residue
  // -------------------------------------------------------------------
  describe("RT-2 R2 N1: VACUUM + secure_delete", () => {
    it("secure_delete is enabled on the tracker's connection", () => {
      // better-sqlite3: secure_delete is per-connection, not persisted in the
      // DB header. The guarantee is that every PopStateTracker connection has
      // it on before any DELETE / VACUUM runs. The downstream behavioral test
      // ("scrubs card_number plaintext from freelist") is what verifies the
      // effect end-to-end.
      const dbPath = makeTempDbPath("secdel-fresh");
      const t = new PopStateTracker(dbPath);
      // @ts-expect-error access private db for test-only verification
      const val = t["db"].pragma("secure_delete", { simple: true });
      expect(val).toBe(1);
      t.close();
      cleanupDbPath(dbPath);
    });

    it("user_version is bumped to 2 on a fresh DB", () => {
      const dbPath = makeTempDbPath("uv-fresh");
      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      expect(verify.pragma("user_version", { simple: true })).toBe(2);
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("legacy migration scrubs card_number plaintext from freelist", () => {
      const dbPath = makeTempDbPath("scrub-freelist");
      const legacy = new Database(dbPath);
      legacy.exec(
        `CREATE TABLE issued_seals (
          seal_id TEXT PRIMARY KEY, amount REAL, vendor TEXT, status TEXT,
          card_number TEXT, cvv TEXT, expiration_date TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
      const pans = ["4111111111111111", "5555555555554444", "378282246310005"];
      const stmt = legacy.prepare(
        "INSERT INTO issued_seals (seal_id, amount, vendor, status, card_number, cvv, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      pans.forEach((pan, i) =>
        stmt.run(`s${i}`, 10, "aws", "Issued", pan, "123", "2026-03-01 10:00:00"),
      );
      legacy.close();

      const bytesBefore = fs.readFileSync(dbPath);
      for (const pan of pans) {
        expect(bytesBefore.includes(Buffer.from(pan))).toBe(true);
      }

      const t = new PopStateTracker(dbPath);
      t.close();

      const bytesAfter = fs.readFileSync(dbPath);
      for (const pan of pans) {
        expect(bytesAfter.includes(Buffer.from(pan))).toBe(false);
      }
      cleanupDbPath(dbPath);
    });

    it("legacy migration preserves masked_card rows through VACUUM", () => {
      const dbPath = makeTempDbPath("preserve-rows");
      const legacy = new Database(dbPath);
      legacy.exec(
        `CREATE TABLE issued_seals (
          seal_id TEXT PRIMARY KEY, amount REAL, vendor TEXT, status TEXT,
          card_number TEXT, cvv TEXT, expiration_date TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
      legacy
        .prepare(
          "INSERT INTO issued_seals (seal_id, amount, vendor, status, card_number, cvv, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run("s-preserve", 42, "aws", "Issued", "4111111111111111", "123", "2026-03-01 10:00:00");
      legacy.close();

      const t = new PopStateTracker(dbPath);
      const verify = new Database(dbPath);
      const row = verify
        .prepare("SELECT masked_card, amount, vendor FROM issued_seals WHERE seal_id = ?")
        .get("s-preserve") as any;
      expect(row.masked_card).toBe("****-****-****-1111");
      expect(row.amount).toBe(42);
      expect(row.vendor).toBe("aws");
      verify.close();
      t.close();
      cleanupDbPath(dbPath);
    });

    it("reopen does not re-run VACUUM once user_version is already 2", () => {
      const dbPath = makeTempDbPath("uv-noop");
      const t1 = new PopStateTracker(dbPath);
      t1.close();

      const verify1 = new Database(dbPath);
      expect(verify1.pragma("user_version", { simple: true })).toBe(2);
      verify1.close();

      const sizeBefore = fs.statSync(dbPath).size;
      const mtimeBefore = fs.statSync(dbPath).mtimeMs;

      const t2 = new PopStateTracker(dbPath);
      t2.close();

      const verify2 = new Database(dbPath);
      expect(verify2.pragma("user_version", { simple: true })).toBe(2);
      verify2.close();

      // If VACUUM re-ran, mtime would update with a rewrite. With user_version
      // gate, reopen should be a no-op relative to the file.
      const sizeAfter = fs.statSync(dbPath).size;
      expect(sizeAfter).toBe(sizeBefore);
      // mtime must not go backward; if VACUUM ran it would typically rewrite.
      // We assert equality — the user_version fast path avoids any rewrite.
      expect(fs.statSync(dbPath).mtimeMs).toBe(mtimeBefore);
      cleanupDbPath(dbPath);
    });
  });

  // -------------------------------------------------------------------
  // RT-2 R2 N2 — chmod 0600 on state DB + WAL + SHM (POSIX)
  // -------------------------------------------------------------------
  describe("RT-2 R2 N2: owner-only file permissions", () => {
    const isPosix = process.platform !== "win32";

    it.skipIf(!isPosix)("state DB file mode is 0600 on a fresh DB", () => {
      const dbPath = makeTempDbPath("mode-fresh");
      const t = new PopStateTracker(dbPath);
      t.close();
      const mode = fs.statSync(dbPath).mode & 0o777;
      expect(mode).toBe(0o600);
      cleanupDbPath(dbPath);
    });

    it.skipIf(!isPosix)("WAL + SHM sidecars are chmod 0600 while tracker is open", () => {
      const dbPath = makeTempDbPath("mode-wal");
      const t = new PopStateTracker(dbPath);
      // CREATE TABLE + VACUUM during init already created sidecars. Assert
      // mode while tracker is still open — better-sqlite3 checkpoints + cleans
      // up -wal / -shm on close.
      let checkedAny = false;
      for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
        if (fs.existsSync(sidecar)) {
          expect(fs.statSync(sidecar).mode & 0o777).toBe(0o600);
          checkedAny = true;
        }
      }
      expect(checkedAny).toBe(true);
      t.close();
      cleanupDbPath(dbPath);
    });

    it.skipIf(!isPosix)("permissions are re-applied on reopen", () => {
      const dbPath = makeTempDbPath("mode-reapply");
      const t1 = new PopStateTracker(dbPath);
      t1.close();
      // Simulate a permission drift (e.g. older build, manual chmod).
      fs.chmodSync(dbPath, 0o644);
      expect(fs.statSync(dbPath).mode & 0o777).toBe(0o644);
      const t2 = new PopStateTracker(dbPath);
      t2.close();
      expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
      cleanupDbPath(dbPath);
    });
  });
});
