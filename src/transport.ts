/**
 * S0.7 F6(A): cross-process MCP transport split.
 *
 * Threat closed: a sibling process on the same host attaches to the MCP server
 * post-launch, bypassing the launcher's policy context.
 *
 * Architecture:
 * - Launcher path = stdio pipe (default; preserves Claude Desktop config compat).
 * - Attacher path = StreamableHTTP on 127.0.0.1:<ephemeral>, gated by Bearer token.
 * - Token (256-bit) + ephemeral port written to ~/.config/hangpay/.attach_{token,port}
 *   mode 0600. Both rotate on every restart.
 *
 * The Bearer-auth middleware rejects with 401 BEFORE any MCP frame is parsed.
 */
import {
  existsSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  unlinkSync,
  statSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createNetServer } from "node:net";

export const VAULT_DIR = join(homedir(), ".config", "hangpay");
export const TOKEN_PATH = join(VAULT_DIR, ".attach_token");
export const PORT_PATH = join(VAULT_DIR, ".attach_port");

export const TOKEN_BYTES = 32; // 256-bit

export function generateAttachToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function writeAttachArtifacts(token: string, port: number): void {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  try { chmodSync(VAULT_DIR, 0o700); } catch { /* best-effort */ }
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  writeFileSync(PORT_PATH, String(port), { mode: 0o600 });
  // writeFileSync mode is masked by umask on some platforms — re-chmod to be sure.
  try { chmodSync(TOKEN_PATH, 0o600); } catch { /* best-effort */ }
  try { chmodSync(PORT_PATH, 0o600); } catch { /* best-effort */ }
}

export function clearAttachArtifacts(): void {
  for (const p of [TOKEN_PATH, PORT_PATH]) {
    try {
      if (!existsSync(p)) continue;
      const size = statSync(p).size;
      if (size > 0) {
        const fd = openSync(p, "r+");
        try {
          writeSync(fd, Buffer.alloc(size, 0));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      unlinkSync(p);
    } catch { /* best-effort */ }
  }
}

export function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not determine ephemeral port"));
      }
    });
  });
}

/**
 * Constant-time Bearer-token check for the Authorization header.
 * Returns true iff `header` exactly matches `Bearer <expectedToken>`.
 */
export function checkBearer(headerValue: string | undefined, expectedToken: string): boolean {
  if (!headerValue) return false;
  const expected = `Bearer ${expectedToken}`;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
