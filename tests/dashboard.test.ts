import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { main } from "../src/dashboard.js";
import Database from "better-sqlite3";
import fs from "node:fs";

const TEST_DB = "test_pop_state.db";
const PORT = 3211;

async function request(path: string, method = "GET", body?: any) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: PORT,
      path,
      method,
      headers: body ? { "Content-Type": "application/json" } : {}
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({
        status: res.statusCode,
        body: data ? JSON.parse(data) : null
      }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("Dashboard API", () => {
  let server: http.Server;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_budget (date TEXT PRIMARY KEY, spent_amount REAL);
      CREATE TABLE IF NOT EXISTS issued_seals (seal_id TEXT PRIMARY KEY, amount REAL, vendor TEXT, status TEXT, masked_card TEXT, expiration_date TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
    `);
    
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("INSERT INTO daily_budget (date, spent_amount) VALUES (?, ?)").run(today, 100);
    db.prepare("INSERT INTO issued_seals (seal_id, amount, vendor, status) VALUES (?, ?, ?, ?)").run("seal_1", 50, "Amazon", "Issued");
    db.prepare("INSERT INTO issued_seals (seal_id, amount, vendor, status) VALUES (?, ?, ?, ?)").run("seal_2", 25, "Google", "Rejected");
    db.close();

    server = await main({ port: PORT, dbPath: TEST_DB, skipOpen: true });
  });

  afterAll(() => {
    server.close();
    // Give the server a moment to fully close and release the DB lock on Windows
    setTimeout(() => {
      if (fs.existsSync(TEST_DB)) {
        try { fs.unlinkSync(TEST_DB); } catch { /* best effort */ }
      }
    }, 100);
  });

  it("GET /api/budget/today returns correct format", async () => {
    const res: any = await request("/api/budget/today");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("spent", 100);
    expect(res.body).toHaveProperty("max");
    expect(res.body).toHaveProperty("remaining");
  });

  it("GET /api/seals returns all seals", async () => {
    const res: any = await request("/api/seals");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/seals?status=rejected filters correctly", async () => {
    const res: any = await request("/api/seals?status=rejected");
    expect(res.status).toBe(200);
    expect(res.body.every((s: any) => s.status.toLowerCase() === "rejected")).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it("PUT /api/settings/:key upserts", async () => {
    const res: any = await request("/api/settings/max_daily_budget", "PUT", { value: "1000" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: "max_daily_budget", value: "1000" });

    const budgetRes: any = await request("/api/budget/today");
    expect(budgetRes.body.max).toBe(1000);
    expect(budgetRes.body.remaining).toBe(900);
  });
});
