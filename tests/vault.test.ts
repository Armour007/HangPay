import { describe, it, expect } from "vitest";
import {
  encryptCredentials,
  decryptCredentials,
  parseVaultMode,
  enforceOssSaltConsent,
  filteredEnv,
  SENSITIVE_ENV_KEYS,
} from "../src/vault.js";
import { VaultDecryptFailed } from "../src/errors.js";
import { spawnSync } from "node:child_process";

describe("Vault encrypt/decrypt", () => {
  const testSalt = Buffer.from("test-salt-for-unit-tests-hangpay");

  it("round-trips credentials", () => {
    const creds = { card_number: "4111111111111111", cvv: "123", exp_month: "12", exp_year: "27" };
    const blob = encryptCredentials(creds, testSalt);
    const decrypted = decryptCredentials(blob, testSalt);
    expect(decrypted).toEqual(creds);
  });

  it("fails with wrong salt", () => {
    const creds = { card_number: "4111111111111111", cvv: "123" };
    const blob = encryptCredentials(creds, testSalt);
    const wrongSalt = Buffer.from("wrong-salt-for-testing-hangpay!!");
    expect(() => decryptCredentials(blob, wrongSalt)).toThrow();
  });

  it("fails with corrupted data", () => {
    expect(() => decryptCredentials(Buffer.from("short"), testSalt)).toThrow("corrupted");
  });

  it("encrypts with key override", () => {
    const creds = { test: "value" };
    const key = Buffer.alloc(32, 0xab);
    const blob = encryptCredentials(creds, undefined, key);
    const decrypted = decryptCredentials(blob, undefined, key);
    expect(decrypted).toEqual(creds);
  });
});

// F4/F7: vault marker schema + legacy migration (S0.7).
describe("parseVaultMode (F4/F7)", () => {
  it("returns 'unknown' for null/undefined/empty", () => {
    expect(parseVaultMode(null)).toBe("unknown");
    expect(parseVaultMode(undefined)).toBe("unknown");
    expect(parseVaultMode("")).toBe("unknown");
  });

  it("migrates legacy 'hardened' to 'machine-hardened'", () => {
    expect(parseVaultMode("hardened")).toBe("machine-hardened");
    expect(parseVaultMode("hardened\n")).toBe("machine-hardened");
  });

  it("migrates legacy 'oss' to 'machine-oss'", () => {
    expect(parseVaultMode("oss")).toBe("machine-oss");
  });

  it("passes through new-schema values", () => {
    expect(parseVaultMode("passphrase")).toBe("passphrase");
    expect(parseVaultMode("machine-hardened")).toBe("machine-hardened");
    expect(parseVaultMode("machine-oss")).toBe("machine-oss");
  });

  it("returns 'unknown' for unrecognized values", () => {
    expect(parseVaultMode("garbage")).toBe("unknown");
    expect(parseVaultMode("HARDENED")).toBe("unknown"); // case-sensitive
  });
});

// F3: OSS salt consent gate (S0.7).
describe("enforceOssSaltConsent (F3)", () => {
  function withEnv(val: string | undefined, fn: () => void) {
    const prev = process.env.HANGPAY_ACCEPT_OSS_SALT;
    if (val === undefined) delete process.env.HANGPAY_ACCEPT_OSS_SALT;
    else process.env.HANGPAY_ACCEPT_OSS_SALT = val;
    try { fn(); }
    finally {
      if (prev === undefined) delete process.env.HANGPAY_ACCEPT_OSS_SALT;
      else process.env.HANGPAY_ACCEPT_OSS_SALT = prev;
    }
  }

  it("refuses machine-oss without HANGPAY_ACCEPT_OSS_SALT=1", () => {
    withEnv(undefined, () => {
      expect(() => enforceOssSaltConsent("machine-oss")).toThrow(VaultDecryptFailed);
      expect(() => enforceOssSaltConsent("machine-oss")).toThrow(/HANGPAY_ACCEPT_OSS_SALT/);
    });
  });

  it("allows machine-oss when HANGPAY_ACCEPT_OSS_SALT=1", () => {
    withEnv("1", () => {
      expect(() => enforceOssSaltConsent("machine-oss")).not.toThrow();
    });
  });

  it("rejects non-'1' values (0, true, yes)", () => {
    for (const v of ["0", "true", "yes", ""]) {
      withEnv(v, () => {
        expect(() => enforceOssSaltConsent("machine-oss")).toThrow(/HANGPAY_ACCEPT_OSS_SALT/);
      });
    }
  });

  it("passphrase / machine-hardened / unknown bypass the gate", () => {
    withEnv(undefined, () => {
      expect(() => enforceOssSaltConsent("passphrase")).not.toThrow();
      expect(() => enforceOssSaltConsent("machine-hardened")).not.toThrow();
      expect(() => enforceOssSaltConsent("unknown")).not.toThrow();
    });
  });
});

// F1: plaintext PAN/CVV must not leak into os.environ or child processes (S0.7).
describe("filteredEnv / SENSITIVE_ENV_KEYS (F1)", () => {
  it("strips all four HANGPAY_BYOC_* keys", () => {
    const base = {
      HANGPAY_BYOC_NUMBER: "4111111111111111",
      HANGPAY_BYOC_CVV: "123",
      HANGPAY_BYOC_EXP_MONTH: "12",
      HANGPAY_BYOC_EXP_YEAR: "27",
      HARMLESS: "ok",
    };
    const out = filteredEnv(base);
    for (const k of SENSITIVE_ENV_KEYS) {
      expect(out).not.toHaveProperty(k);
    }
    expect(out.HARMLESS).toBe("ok");
  });

  it("SENSITIVE_ENV_KEYS covers all four BYOC fields and is frozen", () => {
    expect(SENSITIVE_ENV_KEYS).toContain("HANGPAY_BYOC_NUMBER");
    expect(SENSITIVE_ENV_KEYS).toContain("HANGPAY_BYOC_CVV");
    expect(SENSITIVE_ENV_KEYS).toContain("HANGPAY_BYOC_EXP_MONTH");
    expect(SENSITIVE_ENV_KEYS).toContain("HANGPAY_BYOC_EXP_YEAR");
    expect(Object.isFrozen(SENSITIVE_ENV_KEYS)).toBe(true);
  });

  it("child process spawned with filteredEnv cannot see HANGPAY_BYOC_*", () => {
    const parentEnv = {
      ...process.env,
      HANGPAY_BYOC_NUMBER: "4111111111111111",
      HANGPAY_BYOC_CVV: "123",
    };
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify({n:process.env.HANGPAY_BYOC_NUMBER,c:process.env.HANGPAY_BYOC_CVV}))",
      ],
      { env: filteredEnv(parentEnv) as NodeJS.ProcessEnv, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const seen = JSON.parse(result.stdout);
    expect(seen.n).toBeUndefined();
    expect(seen.c).toBeUndefined();
  });

  it("loadVault does not inject credentials into process.env (post-condition)", async () => {
    // We can't exercise loadVault end-to-end here (no vault on disk in CI),
    // but we can assert the module never populates HANGPAY_BYOC_* on import.
    const { loadVault } = await import("../src/vault.js");
    const before = SENSITIVE_ENV_KEYS.map((k) => process.env[k]);
    try { await loadVault(); } catch { /* expected — no vault */ }
    const after = SENSITIVE_ENV_KEYS.map((k) => process.env[k]);
    expect(after).toEqual(before);
  });
});

// F8: stale .tmp cleanup + wipeVaultArtifacts (S0.7).
describe("F8 stale-tmp cleanup + wipe", () => {
  it("cleanupStaleTempFiles is exported and is a function", async () => {
    const mod = await import("../src/vault.js");
    expect(typeof mod.cleanupStaleTempFiles).toBe("function");
    // Calling it on a non-existent VAULT_DIR must not throw.
    expect(() => mod.cleanupStaleTempFiles()).not.toThrow();
  });

  it("wipeVaultArtifacts is exported with the right shape", async () => {
    const mod = await import("../src/vault.js");
    expect(typeof mod.wipeVaultArtifacts).toBe("function");
  });
});