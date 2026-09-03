import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import Database from "better-sqlite3";
import { PopStateTracker } from "./core/state.js";

export interface DashboardOptions {
  port: number;
  dbPath: string;
}

export async function main(options: DashboardOptions & { skipOpen?: boolean }) {
  const { port, dbPath, skipOpen } = options;

  // Delegate schema creation + migrations to the canonical tracker so
  // dashboard and MCP server always agree on the schema, even if the
  // dashboard is launched first against a legacy DB.
  const bootTracker = new PopStateTracker(dbPath);
  bootTracker.close();

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const server = http.createServer((req, res) => {
    const { method, url } = req;
    const pathname = url ? new URL(url, `http://localhost:${port}`).pathname : "";

    // Static File Serving
    if (method === "GET" && (pathname === "/" || pathname.startsWith("/dashboard") || !pathname.startsWith("/api"))) {
      let filePath = pathname === "/" ? "/index.html" : pathname;
      if (filePath.startsWith("/dashboard/")) {
        filePath = filePath.replace("/dashboard/", "/");
      }
      
      const fullPath = path.join(__dirname, "..", "dashboard", filePath);
      
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const mimeTypes: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".jpg": "image/jpeg",
        };
        res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
    }

    // API Routes
    if (method === "GET" && pathname === "/api/budget/today") {
      const today = new Date().toISOString().slice(0, 10);
      const spentRow = db.prepare("SELECT spent_amount FROM daily_budget WHERE date = ?").get(today) as { spent_amount: number } | undefined;
      const spent = spentRow?.spent_amount ?? 0;
      
      const maxRow = db.prepare("SELECT value FROM dashboard_settings WHERE key = 'max_daily_budget'").get() as { value: string } | undefined;
      const max = maxRow ? parseFloat(maxRow.value) : 500;
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ spent, max, remaining: max - spent }));
      return;
    }

    if (method === "GET" && pathname === "/api/seals") {
      const searchParams = new URL(url!, `http://localhost:${port}`).searchParams;
      const statusFilter = searchParams.get("status");

      const columns = "seal_id, amount, vendor, status, masked_card, expiration_date, timestamp, rejection_reason";
      let seals: any[];
      if (statusFilter) {
        seals = db.prepare(`SELECT ${columns} FROM issued_seals WHERE LOWER(status) = LOWER(?) ORDER BY timestamp DESC`).all(statusFilter);
      } else {
        seals = db.prepare(`SELECT ${columns} FROM issued_seals ORDER BY timestamp DESC`).all();
      }

      // RT-2 R2 Fix 4: masked_card is now stored plaintext. Legacy
      // base64-encrypted values from v0.5.9 and earlier render as base64;
      // a reset-state CLI path is the supported remediation.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(seals));
      return;
    }

    if (method === "GET" && pathname === "/api/audit") {
      const searchParams = new URL(url!, `http://localhost:${port}`).searchParams;
      let limit = parseInt(searchParams.get("limit") ?? "100", 10);
      if (isNaN(limit) || limit <= 0) limit = 100;
      // Defensive: if the dashboard opens a legacy DB before the tracker has
      // run its migration, add the new columns so the SELECT below doesn't
      // blow up. Idempotent via PRAGMA check.
      const auditCols = db.prepare("PRAGMA table_info(audit_log)").all() as any[];
      const auditColNames = new Set(auditCols.map((c) => c.name));
      if (!auditColNames.has("outcome")) {
        db.exec("ALTER TABLE audit_log ADD COLUMN outcome TEXT");
      }
      if (!auditColNames.has("rejection_reason")) {
        db.exec("ALTER TABLE audit_log ADD COLUMN rejection_reason TEXT");
      }
      const rows = db
        .prepare(
          "SELECT id, event_type, vendor, reasoning, outcome, rejection_reason, timestamp FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ?"
        )
        .all(limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    }

    if (method === "PUT" && pathname.startsWith("/api/settings/")) {
      const key = pathname.replace("/api/settings/", "");
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { value } = JSON.parse(body);
          db.prepare("INSERT INTO dashboard_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
            .run(key, value.toString(), value.toString());
          
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ key, value }));
        } catch (e) {
          res.writeHead(400);
          res.end("Invalid JSON");
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  return new Promise<http.Server>((resolve) => {
    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      if (!skipOpen) {
        console.log(`Dashboard running at ${url}`);
        const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${start} ${url}`);
      }
      resolve(server);
    });
  });
}

