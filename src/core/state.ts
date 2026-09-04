import Database from "better-sqlite3";
import os from "os";
import path from "path";
import fs from "fs";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".config", "hangpay", "pop_state.db");

export class PopStateTracker {
  private db: Database.Database;
  dailySpendTotal: number;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initDb();
    this.dailySpendTotal = this.getTodaySpent();
    // RT-2 R2 N2: owner-only permissions on the DB file + WAL sidecars.
    // POSIX only; Windows ACLs are intentionally out of scope for this fix.
    // WAL + SHM sidecars exist after the initDb() write path above.
    this.applyOwnerOnlyPermissions(dbPath);
  }

  /** Expose DB for internal use (webhooks, migrations) */
  getDb(): Database.Database {
    return this.db;
  }

  private applyOwnerOnlyPermissions(dbPath: string): void {
    if (dbPath === ":memory:" || process.platform === "win32") return;
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
      } catch {
        // best effort — chmod is a hardening layer, not a hard precondition
      }
    }
  }

  private utcNowIso(): string {
    return new Date().toISOString();
  }

  private initDb(): void {
    // RT-2 R2 N1: secure_delete overwrites freed pages during DELETE and
    // VACUUM, so legacy card_number residue in the freelist is zeroed rather
    // than left as readable plaintext.
    this.db.pragma("secure_delete = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_budget (
        date TEXT PRIMARY KEY,
        spent_amount REAL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS issued_seals (
        seal_id TEXT PRIMARY KEY,
        amount REAL,
        vendor TEXT,
        status TEXT,
        masked_card TEXT,
        expiration_date TEXT,
        timestamp TEXT NOT NULL,
        rejection_reason TEXT,
        metadata TEXT,
        razorpay_payment_link_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_webhook_verified_at TEXT,
        razorpay_webhook_event TEXT,
        razorpay_webhook_idempotency_key TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        vendor TEXT,
        reasoning TEXT,
        outcome TEXT,
        rejection_reason TEXT,
        timestamp TEXT NOT NULL
      )
    `);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    let columns = this.db.prepare("PRAGMA table_info(issued_seals)").all() as any[];
    let columnNames = new Set(columns.map((c) => c.name));

    if (columnNames.has("card_number") || columnNames.has("cvv")) {
      // Add masked_card column if not already present
      if (!columnNames.has("masked_card")) {
        this.db.exec("ALTER TABLE issued_seals ADD COLUMN masked_card TEXT");
      }
      // Derive masked_card from last 4 digits of card_number
      if (columnNames.has("card_number")) {
        this.db.exec(
          "UPDATE issued_seals SET masked_card = '****-****-****-' || substr(card_number, -4) " +
          "WHERE masked_card IS NULL AND card_number IS NOT NULL"
        );
      }
      // Recreate table without card_number and cvv columns, using the new schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS issued_seals_new (
          seal_id TEXT PRIMARY KEY,
          amount REAL,
          vendor TEXT,
          status TEXT,
          masked_card TEXT,
          expiration_date TEXT,
          timestamp TEXT NOT NULL,
          rejection_reason TEXT
        )
      `);
      this.db.exec(`
        INSERT INTO issued_seals_new (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason)
        SELECT seal_id, amount, vendor, status, masked_card, expiration_date, COALESCE(timestamp, '1970-01-01T00:00:00Z'), NULL
        FROM issued_seals
      `);
      this.db.exec("DROP TABLE issued_seals");
      this.db.exec("ALTER TABLE issued_seals_new RENAME TO issued_seals");
    }

    // After legacy rebuild, or if no rebuild was needed, apply subsequent migrations.
    columns = this.db.prepare("PRAGMA table_info(issued_seals)").all() as any[];
    columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has("rejection_reason")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN rejection_reason TEXT");
    }
    
    // Normalize old timestamp format if present
    this.db.exec(`UPDATE issued_seals SET timestamp = REPLACE(timestamp, ' ', 'T') || 'Z' WHERE timestamp NOT LIKE '%T%' AND timestamp IS NOT NULL AND timestamp != ''`);
    
    // Ensure audit log table exists (harmless if already created)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        vendor TEXT,
        reasoning TEXT,
        outcome TEXT,
        rejection_reason TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    // v0.5.2 — audit_log: add outcome + rejection_reason columns if missing.
    // Idempotent: we check PRAGMA before ALTERing. Legacy rows (from v0.5.0/v0.5.1
    // before this column existed) get outcome='unknown' so the dashboard can
    // surface them without breaking. rejection_reason is left NULL for legacy
    // rows since we genuinely have no reason data for them.
    const auditColumns = this.db.prepare("PRAGMA table_info(audit_log)").all() as any[];
    const auditColumnNames = new Set(auditColumns.map((c) => c.name));
    if (!auditColumnNames.has("outcome")) {
      this.db.exec("ALTER TABLE audit_log ADD COLUMN outcome TEXT");
      this.db.exec("UPDATE audit_log SET outcome = 'unknown' WHERE outcome IS NULL");
    }
    if (!auditColumnNames.has("rejection_reason")) {
      this.db.exec("ALTER TABLE audit_log ADD COLUMN rejection_reason TEXT");
    }

    // RT-2 R2 N1: one-time VACUUM to rewrite all pages, including the freelist
    // pages that still hold plaintext card_number data after the legacy
    // DROP TABLE + RENAME. secure_delete (set in initDb) determines the fill
    // pattern for freed pages. Idempotent via user_version — re-opening an
    // already-migrated DB skips the VACUUM.
    const userVersion = (this.db.pragma("user_version", { simple: true }) as number) ?? 0;
    if (userVersion < 2) {
      this.db.exec("VACUUM");
      this.db.pragma("user_version = 2");
    }

    // v0.6.0 — Track 01: Add Razorpay payment tracking columns
    // Idempotent: check PRAGMA before ALTERing.
    columns = this.db.prepare("PRAGMA table_info(issued_seals)").all() as any[];
    columnNames = new Set(columns.map((c) => c.name));

    // Track Razorpay payment link ID from RazorpayProvider
    if (!columnNames.has("razorpay_payment_link_id")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN razorpay_payment_link_id TEXT");
    }
    // Razorpay payment ID (from webhook)
    if (!columnNames.has("razorpay_payment_id")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN razorpay_payment_id TEXT");
    }
    // Webhook verified timestamp
    if (!columnNames.has("razorpay_webhook_verified_at")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN razorpay_webhook_verified_at TEXT");
    }
    // Webhook event type that triggered the update
    if (!columnNames.has("razorpay_webhook_event")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN razorpay_webhook_event TEXT");
    }
    // Idempotency key for webhook deduplication
    if (!columnNames.has("razorpay_webhook_idempotency_key")) {
      this.db.exec("ALTER TABLE issued_seals ADD COLUMN razorpay_webhook_idempotency_key TEXT");
    }
  }

  private getTodaySpent(): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db
      .prepare("SELECT spent_amount FROM daily_budget WHERE date = ?")
      .get(today) as { spent_amount: number } | undefined;
    return row?.spent_amount ?? 0.0;
  }

  canSpend(amount: number, maxDailyBudget: number): boolean {
    const spentToday = this.getTodaySpent();
    return spentToday + amount <= maxDailyBudget;
  }

  addSpend(amount: number): void {
    const today = new Date().toISOString().slice(0, 10);
    this.db
      .prepare(
        `INSERT INTO daily_budget (date, spent_amount)
         VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET spent_amount = spent_amount + ?`
      )
      .run(today, amount, amount);
    this.dailySpendTotal = this.getTodaySpent();
  }

  recordSeal(
    sealId: string,
    amount: number,
    vendor: string,
    status: string = "Issued",
    maskedCard: string | null = null,
    expirationDate: string | null = null,
    rejectionReason: string | null = null,
    razorpayPaymentLinkId: string | null = null
  ): void {
    // RT-2 R2 Fix 4: masked_card is a PCI-DSS 3.3 permitted last-4 projection
    // (already redacted). Prior AES-GCM-over-hostname-HMAC added no meaningful
    // protection over the N2 0600 file mode and impeded auditability. Stored
    // plaintext from v0.5.10 forward.
    const timestamp = this.utcNowIso();
    this.db
      .prepare(
        `INSERT INTO issued_seals (seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason, razorpay_payment_link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(sealId, amount, vendor, status, maskedCard, expirationDate, timestamp, rejectionReason, razorpayPaymentLinkId);
  }

  getSealMaskedCard(sealId: string): string {
    const row = this.db
      .prepare("SELECT masked_card FROM issued_seals WHERE seal_id = ?")
      .get(sealId) as { masked_card: string | null } | undefined;

    if (!row || !row.masked_card) return "";
    return row.masked_card;
  }

  updateSealStatus(sealId: string, status: string): void {
    this.db
      .prepare("UPDATE issued_seals SET status = ? WHERE seal_id = ?")
      .run(status, sealId);
  }

  markUsed(sealId: string): void {
    this.db
      .prepare("UPDATE issued_seals SET status = 'Used' WHERE seal_id = ?")
      .run(sealId);
  }

  isUsed(sealId: string): boolean {
    const row = this.db
      .prepare("SELECT status FROM issued_seals WHERE seal_id = ?")
      .get(sealId) as { status: string } | undefined;
    return row?.status === "Used";
  }

  /**
   * Insert an audit log entry. Returns the new row id.
   *
   * outcome values used by mcp-server request_purchaser_info:
   *   - "approved"          — request passed all checks and was fulfilled
   *   - "rejected_vendor"   — vendor not in allowlist (and blocking enabled)
   *   - "rejected_security" — security scan blocked the request
   *   - "blocked_bypassed"  — vendor block bypassed via HANGPAY_PURCHASER_INFO_BLOCKING=false
   *   - "error_injector"    — injector unavailable (CDP down, lazy-init failed)
   *   - "error_fields"      — billing fields not found on page
   *   - "unknown"           — legacy row from before v0.5.2 (pre-outcome column)
   */
  recordAuditEvent(
    eventType: string,
    vendor: string | null = null,
    reasoning: string | null = null,
    outcome: string | null = null,
    rejectionReason: string | null = null,
  ): number {
    const timestamp = this.utcNowIso();
    const info = this.db
      .prepare(
        `INSERT INTO audit_log (event_type, vendor, reasoning, outcome, rejection_reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(eventType, vendor, reasoning, outcome, rejectionReason, timestamp);
    return Number(info.lastInsertRowid);
  }

  getAuditEvents(limit: number = 100): Array<{
    id: number;
    event_type: string;
    vendor: string | null;
    reasoning: string | null;
    outcome: string | null;
    rejection_reason: string | null;
    timestamp: string;
  }> {
    return this.db
      .prepare(
        "SELECT id, event_type, vendor, reasoning, outcome, rejection_reason, timestamp " +
        "FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ?"
      )
      .all(limit) as any;
  }

  close(): void {
    this.db.close();
  }
}
