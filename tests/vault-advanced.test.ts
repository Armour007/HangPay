import { describe, it, expect } from "vitest";
import {
  encryptCredentials,
  decryptCredentials,
  deriveKeyFromPassphrase,
  vaultExists,
  OSS_WARNING,
} from "../src/vault.js";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Passphrase mode (mirrors Python test_passphrase_vault.py)
// ---------------------------------------------------------------------------
describe("Vault passphrase mode", () => {
  it("passphrase key differs from machine-derived key", () => {
    const testSalt = Buffer.from("test-salt-for-unit-tests-pop-pay");
    const creds = { test: "value" };

    const passphraseKey = deriveKeyFromPassphrase("my-secure-passphrase");
    const blob = encryptCredentials(creds, testSalt);

    // Passphrase-derived key should not decrypt machine-derived vault
    expect(() => decryptCredentials(blob, undefined, passphraseKey)).toThrow();
  });

  it("passphrase encrypt/decrypt round-trip", () => {
    const key = deriveKeyFromPassphrase("test-passphrase-123");
    const creds = { card_number: "4111111111111111", cvv: "999" };
    const blob = encryptCredentials(creds, undefined, key);
    const decrypted = decryptCredentials(blob, undefined, key);
    expect(decrypted).toEqual(creds);
  });

  it("wrong passphrase fails", () => {
    const key1 = deriveKeyFromPassphrase("correct-passphrase");
    const key2 = deriveKeyFromPassphrase("wrong-passphrase");
    const creds = { secret: "data" };
    const blob = encryptCredentials(creds, undefined, key1);
    expect(() => decryptCredentials(blob, undefined, key2)).toThrow();
  });

  it("different passphrases produce different keys", () => {
    const key1 = deriveKeyFromPassphrase("passphrase-one");
    const key2 = deriveKeyFromPassphrase("passphrase-two");
    expect(key1.equals(key2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vault encryption edge cases
// ---------------------------------------------------------------------------
describe("Vault encryption – edge cases", () => {
  const testSalt = Buffer.from("test-salt-for-unit-tests-pop-pay");

  it("handles empty credentials object", () => {
    const creds = {};
    const blob = encryptCredentials(creds, testSalt);
    const decrypted = decryptCredentials(blob, testSalt);
    expect(decrypted).toEqual({});
  });

  it("handles large credentials", () => {
    const creds: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      creds[`field_${i}`] = `value_${i}_${"x".repeat(100)}`;
    }
    const blob = encryptCredentials(creds, testSalt);
    const decrypted = decryptCredentials(blob, testSalt);
    expect(decrypted).toEqual(creds);
  });

  it("handles unicode in credentials", () => {
    const creds = { name: "日本語テスト", address: "台灣台北市" };
    const blob = encryptCredentials(creds, testSalt);
    const decrypted = decryptCredentials(blob, testSalt);
    expect(decrypted).toEqual(creds);
  });

  it("each encryption produces different blob (random nonce)", () => {
    const creds = { test: "value" };
    const blob1 = encryptCredentials(creds, testSalt);
    const blob2 = encryptCredentials(creds, testSalt);
    expect(blob1.equals(blob2)).toBe(false);
  });

  it("blob has correct structure: 12-byte nonce + ciphertext + 16-byte tag", () => {
    const creds = { test: "value" };
    const blob = encryptCredentials(creds, testSalt);
    // Minimum size: 12 (nonce) + 1 (ciphertext) + 16 (tag) = 29
    expect(blob.length).toBeGreaterThanOrEqual(29);
  });

  it("tampered ciphertext fails", () => {
    const creds = { test: "value" };
    const blob = encryptCredentials(creds, testSalt);
    // Flip a byte in the ciphertext portion
    const tampered = Buffer.from(blob);
    tampered[15] ^= 0xff;
    expect(() => decryptCredentials(tampered, testSalt)).toThrow();
  });

  it("tampered tag fails", () => {
    const creds = { test: "value" };
    const blob = encryptCredentials(creds, testSalt);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptCredentials(tampered, testSalt)).toThrow();
  });

  it("tampered nonce fails", () => {
    const creds = { test: "value" };
    const blob = encryptCredentials(creds, testSalt);
    const tampered = Buffer.from(blob);
    tampered[0] ^= 0xff;
    expect(() => decryptCredentials(tampered, testSalt)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OSS warning and vault existence
// ---------------------------------------------------------------------------
describe("Vault utilities", () => {
  it("OSS_WARNING is a non-empty string", () => {
    expect(typeof OSS_WARNING).toBe("string");
    expect(OSS_WARNING.length).toBeGreaterThan(0);
    expect(OSS_WARNING).toContain("SECURITY NOTICE");
  });

  it("vaultExists returns boolean", () => {
    // Just verify it returns a boolean (won't necessarily be true in test env)
    expect(typeof vaultExists()).toBe("boolean");
  });
});
