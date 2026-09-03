/**
 * S0.7 F6(A) transport split: token gen, file persistence, Bearer checker.
 */
import { describe, it, expect } from "vitest";
import { existsSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

import {
  generateAttachToken,
  pickEphemeralPort,
  checkBearer,
  TOKEN_BYTES,
} from "../src/transport.js";

describe("F6(A) generateAttachToken", () => {
  it("returns 64 hex chars (256-bit)", () => {
    const t = generateAttachToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t.length).toBe(TOKEN_BYTES * 2);
  });

  it("is unique across calls", () => {
    expect(generateAttachToken()).not.toBe(generateAttachToken());
  });
});

describe("F6(A) pickEphemeralPort", () => {
  it("returns a port that is immediately re-bindable", async () => {
    const port = await pickEphemeralPort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });
});

describe("F6(A) checkBearer", () => {
  const token = "a".repeat(64);

  it("accepts exact Bearer match", () => {
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
  });

  it("rejects missing header", () => {
    expect(checkBearer(undefined, token)).toBe(false);
    expect(checkBearer("", token)).toBe(false);
  });

  it("rejects wrong token of same length (timing-safe path)", () => {
    expect(checkBearer(`Bearer ${"b".repeat(64)}`, token)).toBe(false);
  });

  it("rejects wrong-length token (length-prefilter)", () => {
    expect(checkBearer(`Bearer short`, token)).toBe(false);
    expect(checkBearer(`Bearer ${token}extra`, token)).toBe(false);
  });

  it("rejects missing 'Bearer ' prefix", () => {
    expect(checkBearer(token, token)).toBe(false);
  });
});

describe("F6(A) write/clear attach artifacts", () => {
  // We do NOT exercise writeAttachArtifacts directly because TOKEN_PATH is
  // hardcoded to ~/.config/pop-pay; running it in CI would clobber a dev's
  // real attach state. End-to-end coverage lives in the Py parity tests
  // where VAULT_DIR is monkeypatched to tmp_path. We assert the exports
  // exist with the right shape.
  it("exports write/clear functions", async () => {
    const mod = await import("../src/transport.js");
    expect(typeof mod.writeAttachArtifacts).toBe("function");
    expect(typeof mod.clearAttachArtifacts).toBe("function");
  });
});
