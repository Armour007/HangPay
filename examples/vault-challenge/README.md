# hangpay Vault Canary Challenge

This directory contains an **internal canary** file, `vault.enc.challenge`, designed to test the cryptographic integrity of the hangpay vault format. The external challenge will open when the public bounty program opens.

## The Challenge

The file `vault.enc.challenge` is an encrypted blob containing a JSON object with fake card data and a unique flag string. Recover the plaintext flag to demonstrate a break of the vault's cryptographic boundary.

**Flag Format**: `POPPAY_CHALLENGE_FLAG_2026_04_<hex_value>`

### Submission Process
If you successfully decrypt the flag, please file a [GitHub Security Advisory](https://github.com/akshay/hangpay/security/advisories/new) including:
1. The recovered flag string.
2. A summary of the decryption method/vulnerability used.
3. A reproduction script or proof of concept.

## Cryptographic Model

The challenge uses a **simplified discard-passphrase model**. While the production hangpay vault derives keys from stable machine identifiers and OS-level salts (see `native/src/lib.rs` for the TS repo and `HANGPAY_pay/engine/_vault_core.pyx` for the Python repo), this canary was generated with a random 32-byte passphrase that was discarded immediately after encryption.

**Encryption Specs**:
- **Algorithm**: AES-256-GCM
- **KDF**: scrypt (N=2^17, r=8, p=1, dkLen=32)
- **Binary Format**: `[salt(32) || nonce(12) || ciphertext || tag(16)]`

The `vault.enc.challenge.meta.json` file contains the exact parameters used. You can use the provided `gen-challenge.js` or `gen-challenge.py` scripts to verify the implementation and generate your own test vectors.

