/**
 * R2/F-SC1 fix: resolve + load hangpay's .env config from an explicit,
 * trusted location only — NEVER from the current working directory.
 *
 * Before this fix, mcp-server.ts fell back to a bare `config()` call
 * (dotenv's default cwd-search) whenever ~/.config/hangpay/.env did not
 * exist. An attacker-planted .env in an untrusted repo/CWD could override
 * HANGPAY_MAX_DAILY, HANGPAY_REQUIRE_HUMAN_APPROVAL, or redirect HANGPAY_LLM_BASE_URL to
 * an attacker-controlled endpoint (auto-approve + credential exfiltration).
 *
 * Extracted into its own module (rather than left inline in mcp-server.ts)
 * so it can be unit-tested in isolation — mcp-server.ts runs a full MCP
 * server as a side effect of being imported and cannot safely be imported
 * from a test.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolution order (first match wins; a CWD .env is never consulted):
 *   1. HANGPAY_CONFIG env var, if set — explicit override path.
 *   2. ~/.config/hangpay/.env, if it exists — the default config location.
 *   3. Neither exists — no dotenv file is loaded; the real process
 *      environment is used as-is (no cwd search).
 *
 * Returns the path that was loaded, or null if none was found.
 */
export function loadPopConfig(): string | null {
  const explicit = process.env.HANGPAY_CONFIG;
  if (explicit) {
    config({ path: explicit });
    return explicit;
  }

  const configEnv = join(homedir(), ".config", "hangpay", ".env");
  if (existsSync(configEnv)) {
    config({ path: configEnv });
    return configEnv;
  }

  return null;
}
