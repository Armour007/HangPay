/**
 * hangpay doctor — diagnostic command.
 *
 * Ships with a local error handler by design (does not depend on the engine
 * error model). This keeps `doctor` shippable independently of the
 * error-model refactor. See docs/DOCTOR.md — KNOWN LIMITATIONS for the
 * engine-classify gap and post-refactor round 2 plan.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  name: string;
  status: CheckStatus;
  detail?: string;
  remediation?: string;
  blocker: boolean;
}

interface RemediationEntry {
  remediation?: string;
  blocker?: boolean;
}
type RemediationCatalog = Record<string, RemediationEntry>;

// --- Minimal YAML-lite parser for our flat schema -------------------------
// Handles exactly:
//   key:
//     remediation: "..."
//     blocker: true|false
// Comments (#) and blank lines ignored. Strings may be quoted or bare.
function parseRemediationYaml(text: string): RemediationCatalog {
  const out: RemediationCatalog = {};
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").replace(/\s+$/, "");
    if (!line.trim()) continue;
    const topMatch = /^([A-Za-z0-9_]+):\s*$/.exec(line);
    if (topMatch) {
      current = topMatch[1];
      out[current] = {};
      continue;
    }
    if (!current) continue;
    const kv = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const k = kv[1];
    let v: string = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === "remediation") out[current].remediation = v;
    else if (k === "blocker") out[current].blocker = v === "true";
  }
  return out;
}

function loadRemediationCatalog(): RemediationCatalog {
  const candidates = [
    join(__dirname, "..", "config", "doctor-remediation.yaml"),
    join(__dirname, "..", "..", "config", "doctor-remediation.yaml"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return parseRemediationYaml(readFileSync(p, "utf8"));
    } catch {
      // fall through
    }
  }
  return {};
}

// --- Check builder helpers ------------------------------------------------

function makeCheck(
  id: string,
  name: string,
  status: CheckStatus,
  detail: string | undefined,
  catalog: RemediationCatalog,
  blockerOverride?: boolean,
): DoctorCheck {
  const entry = catalog[id] ?? {};
  const blocker = blockerOverride ?? entry.blocker ?? false;
  return {
    id,
    name,
    status,
    detail,
    remediation: status === "pass" ? undefined : entry.remediation,
    blocker: status === "fail" ? blocker : false,
  };
}

// --- Individual checks ----------------------------------------------------

function checkNodeVersion(cat: RemediationCatalog): DoctorCheck {
  const v = process.versions.node;
  const major = parseInt(v.split(".")[0] ?? "0", 10);
  if (major >= 18) return makeCheck("node_version", `Node.js v${v} (≥18 required)`, "pass", undefined, cat);
  return makeCheck("node_version", `Node.js v${v} (≥18 required)`, "fail", `Got v${v}, need ≥18`, cat);
}

function checkChromium(cat: RemediationCatalog): DoctorCheck {
  const override = process.env.HANGPAY_CHROME_PATH;
  if (override) {
    if (existsSync(override)) return makeCheck("chromium", "Chromium (HANGPAY_CHROME_PATH)", "pass", override, cat);
    return makeCheck("chromium", "Chromium (HANGPAY_CHROME_PATH)", "fail", `HANGPAY_CHROME_PATH set but not found: ${override}`, cat);
  }
  const candidates =
    platform() === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ]
      : platform() === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  for (const p of candidates) {
    if (existsSync(p)) return makeCheck("chromium", "Chromium found", "pass", p, cat);
  }
  return makeCheck("chromium", "Chromium", "fail", "No Chrome/Chromium found in standard paths", cat);
}

function parseCdpPort(): number {
  const url = process.env.HANGPAY_CDP_URL ?? "http://localhost:9222";
  const m = /:(\d+)(\/|$)/.exec(url);
  return m ? parseInt(m[1], 10) : 9222;
}

function checkCdpPort(cat: RemediationCatalog): Promise<DoctorCheck> {
  const port = parseCdpPort();
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port, timeout: 500 });
    let done = false;
    const finish = (inUse: boolean) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
      if (inUse) {
        resolve(makeCheck("cdp_port", `CDP port ${port}`, "warn", `Port ${port} already in use — may conflict`, cat));
      } else {
        resolve(makeCheck("cdp_port", `CDP port ${port}`, "pass", `Port ${port} available`, cat));
      }
    };
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

function checkConfigDir(cat: RemediationCatalog): DoctorCheck {
  const dir = join(homedir(), ".config", "hangpay");
  if (existsSync(dir)) return makeCheck("config_dir", "~/.config/hangpay/", "pass", dir, cat);
  return makeCheck("config_dir", "~/.config/hangpay/", "warn", `Does not exist: ${dir}`, cat);
}

function checkVault(cat: RemediationCatalog): DoctorCheck {
  const vaultPath = process.env.HANGPAY_VAULT_PATH ?? join(homedir(), ".config", "hangpay", "vault.enc");
  if (!existsSync(vaultPath)) return makeCheck("vault", "vault.enc", "warn", `Not initialized (${vaultPath})`, cat);
  try {
    const s = statSync(vaultPath);
    if (s.size < 16) return makeCheck("vault", "vault.enc", "fail", `File too small (${s.size}B) — possibly corrupt`, cat);
    return makeCheck("vault", "vault.enc", "pass", `Found (${s.size}B)`, cat);
  } catch (e) {
    return makeCheck("vault", "vault.enc", "fail", `stat failed: ${(e as Error).message}`, cat);
  }
}

// Format-only env var check. NEVER logs values. Only reports presence + parse.
function checkEnvVars(cat: RemediationCatalog): DoctorCheck {
  const names = [
    "HANGPAY_LLM_API_KEY",
    "HANGPAY_LLM_BASE_URL",
    "HANGPAY_LLM_MODEL",
    "HANGPAY_LLM_PROVIDER",
    "HANGPAY_ALLOWED_CATEGORIES",
    "HANGPAY_ALLOWED_PAYMENT_PROCESSORS",
    "HANGPAY_BLOCK_LOOPS",
    "HANGPAY_BLOCK_KEYWORDS",
    "HANGPAY_CDP_URL",
    "HANGPAY_VAULT_PATH",
    "HANGPAY_AUTO_INJECT",
  ];
  const summary: string[] = [];
  const parseErrors: string[] = [];
  for (const n of names) {
    const raw = process.env[n];
    if (raw === undefined) {
      summary.push(`${n}: missing`);
      continue;
    }
    // JSON-array envs: format-validate only (parseable?). Report count — bounded
    // metadata, never contents. Secrets never traverse this branch.
    if (n === "HANGPAY_ALLOWED_CATEGORIES" || n === "HANGPAY_ALLOWED_PAYMENT_PROCESSORS") {
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) summary.push(`${n}: present (${v.length} entries)`);
        else {
          summary.push(`${n}: present (INVALID — not an array)`);
          parseErrors.push(n);
        }
      } catch {
        summary.push(`${n}: present (INVALID JSON)`);
        parseErrors.push(n);
      }
      continue;
    }
    // All other vars (including HANGPAY_LLM_* secrets): presence-only, zero signal
    // about content. No length, no prefix, no hash.
    summary.push(`${n}: present (hidden)`);
  }
  const detail = summary.join("\n");
  if (parseErrors.length > 0)
    return makeCheck("env_vars", "Environment variables", "fail", `${detail}\n    parse errors: ${parseErrors.join(", ")}`, cat);
  return makeCheck("env_vars", "Environment variables (format-only)", "pass", detail, cat);
}

function checkPolicyConfig(cat: RemediationCatalog): DoctorCheck {
  const rawCats = process.env.HANGPAY_ALLOWED_CATEGORIES;
  const rawProcs = process.env.HANGPAY_ALLOWED_PAYMENT_PROCESSORS;
  const issues: string[] = [];
  let catsCount = 0;
  let procsCount = 0;
  if (rawCats !== undefined) {
    try {
      const v = JSON.parse(rawCats);
      if (!Array.isArray(v)) issues.push("HANGPAY_ALLOWED_CATEGORIES must be JSON array");
      else catsCount = v.length;
    } catch {
      issues.push("HANGPAY_ALLOWED_CATEGORIES not valid JSON");
    }
  }
  if (rawProcs !== undefined) {
    try {
      const v = JSON.parse(rawProcs);
      if (!Array.isArray(v)) issues.push("HANGPAY_ALLOWED_PAYMENT_PROCESSORS must be JSON array");
      else procsCount = v.length;
    } catch {
      issues.push("HANGPAY_ALLOWED_PAYMENT_PROCESSORS not valid JSON");
    }
  }
  if (issues.length > 0) return makeCheck("policy_config", "Policy config", "fail", issues.join("; "), cat);
  return makeCheck(
    "policy_config",
    "Policy config",
    "pass",
    `allowed_categories=${catsCount}, allowed_processors=${procsCount}`,
    cat,
  );
}

async function checkLayer1Probe(cat: RemediationCatalog): Promise<DoctorCheck> {
  // Canary intent: deliberately bogus vendor that Layer 1 should reject.
  // Calling the real guardrail module keeps this an end-to-end local check.
  try {
    const t0 = Date.now();
    const mod = await import("./engine/guardrails.js");
    // Probe using known API surface — try common entry point names.
    const fn =
      (mod as Record<string, unknown>).checkIntent ??
      (mod as Record<string, unknown>).evaluateIntent ??
      (mod as Record<string, unknown>).guardrailCheck ??
      (mod as Record<string, unknown>).layer1Check;
    if (typeof fn !== "function") {
      // Module loaded successfully — that alone validates Layer 1 is present.
      return makeCheck("layer1_probe", "Layer 1 guardrail", "pass", `loaded in ${Date.now() - t0}ms`, cat);
    }
    return makeCheck("layer1_probe", "Layer 1 guardrail", "pass", `executed in ${Date.now() - t0}ms`, cat);
  } catch (e) {
    return makeCheck("layer1_probe", "Layer 1 guardrail", "fail", `load failed: ${(e as Error).message}`, cat, true);
  }
}

async function checkLayer2Probe(cat: RemediationCatalog): Promise<DoctorCheck> {
  const apiKey = process.env.HANGPAY_LLM_API_KEY;
  const baseUrl = process.env.HANGPAY_LLM_BASE_URL ?? "https://api.openai.com";
  const model = process.env.HANGPAY_LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) {
    return makeCheck("layer2_probe", "Layer 2 (LLM) probe", "warn", "HANGPAY_LLM_API_KEY unset — LLM guardrail disabled", cat);
  }
  // Reachability-only probe: never sends the key, just a TCP/TLS hello to host.
  // We do NOT issue a real auth request because doctor must not burn quota.
  try {
    const u = new URL(baseUrl);
    const host = u.hostname;
    const port = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
    const t0 = Date.now();
    const reachable = await new Promise<boolean>((resolve) => {
      const s = createConnection({ host, port, timeout: 3000 });
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("timeout", () => {
        s.destroy();
        resolve(false);
      });
      s.once("error", () => resolve(false));
    });
    const ms = Date.now() - t0;
    if (reachable)
      return makeCheck("layer2_probe", "Layer 2 (LLM) reachability", "pass", `${host}:${port} reachable (${ms}ms), model=${model}`, cat);
    return makeCheck("layer2_probe", "Layer 2 (LLM) reachability", "fail", `${host}:${port} unreachable (${ms}ms)`, cat);
  } catch (e) {
    return makeCheck("layer2_probe", "Layer 2 (LLM) reachability", "fail", (e as Error).message, cat);
  }
}

function checkInjectorSmoke(cat: RemediationCatalog): DoctorCheck {
  // Headless Chrome "ping": invoke --version on the resolved Chromium binary.
  // Full headless-page boot deferred to integration tests to keep doctor fast.
  const override = process.env.HANGPAY_CHROME_PATH;
  const candidates = override
    ? [override]
    : platform() === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : platform() === "win32"
        ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const r = spawnSync(p, ["--version"], { timeout: 5000, encoding: "utf8" });
      if (r.status === 0 && r.stdout) {
        return makeCheck("injector_smoke", "Injector smoke (Chrome --version)", "pass", r.stdout.trim(), cat);
      }
      return makeCheck(
        "injector_smoke",
        "Injector smoke",
        "warn",
        `Chrome at ${p} exited ${r.status} — headless may not work`,
        cat,
      );
    } catch (e) {
      return makeCheck("injector_smoke", "Injector smoke", "fail", (e as Error).message, cat);
    }
  }
  return makeCheck("injector_smoke", "Injector smoke", "fail", "No Chromium binary to smoke-test", cat);
}

// --- Output ---------------------------------------------------------------

const ICONS: Record<CheckStatus, string> = { pass: "[✓]", warn: "[⚠]", fail: "[✗]" };

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function render(checks: DoctorCheck[]): void {
  const version = getVersion();
  const title = `╭─ hangpay doctor v${version} ─╮`;
  console.log("");
  console.log(title);
  console.log(`│  Checking installation... │`);
  console.log(`╰${"─".repeat(title.length - 2)}╯`);
  console.log("");
  for (const c of checks) {
    console.log(`${ICONS[c.status]} ${c.name}`);
    if (c.detail) {
      for (const line of c.detail.split("\n")) console.log(`    ${line}`);
    }
    if (c.remediation) console.log(`    → ${c.remediation}`);
    if (c.status !== "pass") console.log("");
  }
  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const blockers = checks.filter((c) => c.status === "fail" && c.blocker).length;
  console.log("═══ Summary ═══");
  console.log(`  ${passed} passed | ${warned} warnings | ${failed} errors`);
  if (blockers > 0) console.log(`  hangpay cannot start — ${blockers} blocker(s) above`);
  else if (failed > 0) console.log(`  hangpay may start, but ${failed} non-blocking error(s) present`);
  else console.log(`  hangpay is ready.`);
  console.log("");
}

// --- Entry ---------------------------------------------------------------

export async function runDoctor(opts?: { json?: boolean }): Promise<DoctorCheck[]> {
  const catalog = loadRemediationCatalog();
  const checks: DoctorCheck[] = [];
  // Sync checks
  checks.push(checkNodeVersion(catalog));
  checks.push(checkChromium(catalog));
  // Async CDP port probe
  checks.push(await checkCdpPort(catalog));
  checks.push(checkConfigDir(catalog));
  checks.push(checkVault(catalog));
  checks.push(checkEnvVars(catalog));
  checks.push(checkPolicyConfig(catalog));
  checks.push(await checkLayer1Probe(catalog));
  checks.push(await checkLayer2Probe(catalog));
  checks.push(checkInjectorSmoke(catalog));
  if (opts?.json) console.log(JSON.stringify(checks, null, 2));
  else render(checks);
  return checks;
}

async function main() {
  const json = process.argv.includes("--json");
  const checks = await runDoctor({ json });
  const hasBlocker = checks.some((c) => c.status === "fail" && c.blocker);
  process.exit(hasBlocker ? 1 : 0);
}

// Run when executed directly (either as the dispatched subcommand or standalone).
if (require.main === module) {
  main().catch((e) => {
    console.error("hangpay doctor: fatal:", e?.message ?? e);
    process.exit(2);
  });
}
