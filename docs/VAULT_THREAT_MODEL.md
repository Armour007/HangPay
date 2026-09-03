# VAULT_THREAT_MODEL.md — hangpay Vault Architecture Threat Model v0.1

> **v0.1 honesty.** This is a first-pass audit. TS code paths are cited against `src/vault.ts` and `native/src/lib.rs` at time of writing; line numbers may drift. Python paths (`HANGPAY_pay/vault.py`, `HANGPAY_pay/engine/_vault_core.pyx`) describe the mirror architecture — Python-side line-level audit is pending. Known gaps are listed in §5 rather than hidden.

## 0. Scope

This document covers the internal architecture and security properties of the **hangpay credential vault** — the encrypted storage of payment credentials at rest and in the unlock / inject window. It focuses on the cryptographic implementation, process isolation of secrets, and the **passive failure modes** that motivate the vault's existence.

## 1. Vault Architecture Summary

- **TS implementation**: TypeScript wrapper `src/vault.ts` orchestrating a native Rust `napi-rs` layer `native/src/lib.rs` for scrypt key derivation with compiled-salt hardening. AES-256-GCM via Node's `crypto.createCipheriv`.
- **Python implementation**: Python wrapper `HANGPAY_pay/vault.py` plus compiled Cython engine `HANGPAY_pay/engine/_vault_core.pyx` → `.so`. Byte-identical blob format with TS (documented in `tests/vault-interop.test.ts` on the TS side).
- **KDF (machine mode)**: `scrypt` parameters N=2^14 (16384), r=8, p=1, dkLen=32. Password = `machine_id + ":" + username`. See `src/vault.ts:105-107`, `native/src/lib.rs:22-28`.
- **KDF (passphrase mode)**: `PBKDF2-HMAC-SHA256` with 600,000 iterations, salt = `machine_id`. See `src/vault.ts:110-112`.
- **Storage**: Encrypted blob at `~/.config/hangpay/vault.enc`, written atomically (tmp + fsync + rename) with `0o600` permissions. See `src/vault.ts:248-252`.
- **Blob format**: `nonce(12) || ciphertext || tag(16)` (AES-256-GCM). See `src/vault.ts:150-155`.
- **Salt hardening (hardened builds)**: Salt is XOR-split into two compiled byte arrays `A1` and `B2` embedded in the Rust `.node` (or Cython `.so`). Reconstructed in-memory via `a1 ⊕ b2`, used once, then zeroed with the `zeroize` crate. See `native/src/lib.rs:7-8, 20, 32-33`.
- **Downgrade defense**: `.vault_mode` marker file records `hardened` / `oss` at init. `loadVault()` refuses to proceed if marker says `hardened` but the native module is missing/non-hardened. See `src/vault.ts:188-227`.

## 2. Active Attacks

### 2.1 `vault.enc` file theft (cold copy)
- **Threat**: Attacker with filesystem read access copies `vault.enc` to another machine for offline cracking.
- **Current defense**: AES-256-GCM authenticated encryption + machine-bound scrypt KDF. Decryption fails on another machine because `machine_id` (and/or `username`) differ.
- **Residual risk**: If attacker also exfiltrates `/etc/machine-id` (Linux) or the platform-UUID, only the compiled salt and username remain unknown — and in OSS builds salt is a public constant (see §5).
- **Cite**: `src/vault.ts:105-107` (derivation), `src/vault.ts:150-155` (AEAD), `native/src/lib.rs:27-30` (scrypt params).

### 2.2 Memory dump during decryption
- **Threat**: Attacker dumps the Node.js / Python process memory while the vault is unlocked, extracting the derived AES key or the plaintext credentials.
- **Current defense**: In the Rust layer, the reconstructed salt buffer and password buffer are wiped via the `zeroize` crate (`native/src/lib.rs:32-33`) immediately after scrypt. Atomic writes clear tmp files promptly.
- **Residual risk**: The derived **key** and **plaintext** necessarily live in the Node.js / Python heap for the duration of the `decipher.update`/`final` call. V8 GC does not give deterministic zeroization of heap buffers; same for CPython.
- **Cite**: `native/src/lib.rs:3, 32-33` (zeroize).

### 2.3 Native binary reverse engineering (napi `.node` / Cython `.so`)
- **Threat**: Attacker reverse-engineers the compiled native module (e.g., Ghidra, IDA Pro) to extract the two XORed salt halves and reconstruct the salt offline.
- **Current defense**: Salt stored as two `static` byte arrays (`A1`, `B2`); reconstruction happens only inside `derive_key` at runtime. Variable names obfuscated. Compiled release builds are stripped.
- **Residual risk**: A determined reverse-engineer can locate both arrays and XOR them. Obfuscation raises the bar, not a cryptographic wall.
- **Cite**: `native/src/lib.rs:7-8, 14-20`.

### 2.4 KDF weakness (brute force on passphrase)
- **Threat**: In passphrase mode, attacker brute-forces a weak user passphrase via GPU/ASIC farm.
- **Current defense**: PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP 2023 floor). Still linear and GPU-friendly, but 600k raises per-guess cost substantially over the default 100k.
- **Residual risk**: Passphrase entropy is the ultimate limit. Users may choose weak strings despite iteration count. Consider argon2id in v0.2.
- **Cite**: `src/vault.ts:110-112`.

### 2.5 Side-channel: timing attacks on decrypt path
- **Threat**: Attacker measures decryption latency to distinguish valid vs invalid keys / tamper.
- **Current defense**: AES-GCM verifies the tag in constant time in Node's OpenSSL binding (and `RustCrypto`'s `aes-gcm` on the native path). Decryption short-circuits on tag mismatch without leaking key-comparison timing.
- **Residual risk**: Potential timing leaks in scrypt implementation or in JSON parsing of the resulting plaintext. Not currently measured.
- **Cite**: `src/vault.ts:171-180`.

### 2.6 Side-channel: cache attacks on key material
- **Threat**: Co-resident process (same physical CPU) uses FLUSH+RELOAD or similar cache-timing attack to extract AES round keys.
- **Current defense**: On x86-64 / arm64 with AES-NI / ARMv8 crypto extensions, the AES rounds are hardware-backed and cache-resistant. Both targets hangpay supports.
- **Residual risk**: Non-AES-NI fallbacks in software AES libraries are theoretically vulnerable. hangpay does not detect or refuse such fallbacks.

### 2.7 Salt recovery from binary via `strings` / static scan
- **Threat**: `strings native/hangpay-native.node | grep ...` or equivalent on the Cython `.so` extracts the salt directly.
- **Current defense**: Salt is never present as a contiguous byte sequence in the binary — only the two XOR halves exist, and neither individually is meaningful.
- **Residual risk**: Binary diffing of two hardened builds with the same salt could reveal the patterns.
- **Cite**: `native/src/lib.rs:7-8, 20`.

## 3. Passive Failure Mode (standalone — product-existential)

Passive failure is the **greatest existential threat to hangpay**, and the reason the vault architecture exists at all. An agent that never tries to attack the vault can still leak real card data — through its own reasoning traces, tool outputs, logs, or screenshots — simply by being present at the moment of unlock. The core product promise is *"the agent process never possesses raw credentials."* Every scenario below represents a way that promise can break through no adversarial intent.

### 3.1 Agent reads `console.log` / debug output capturing unlocked card
- **Scenario**: A developer left a `console.log(creds)` or a logging framework captures a tool return value that contained full credentials.
- **What agent does**: Includes the logged bytes in its chain-of-thought, ships to its LLM provider, or writes to a debug file the agent can re-read.
- **hangpay defense**: **Structural isolation** at the MCP tool boundary. Tool returns to the agent are masked (`****-4242`). Raw credentials flow from `decryptCredentials` directly to the CDP injector, never crossing the MCP response layer. See `src/mcp-server.ts` (card-request path).
- **Residual risk**: Logging *inside* the `hangpay` process (not the agent's) may reach shared observability sinks (Datadog, stdout piped to agent tool). hangpay does not currently scrub its own stdout.
- **Severity**: High. This is the single most likely real-world leak path.

### 3.2 Agent reads screenshot / screen recording of dashboard or checkout
- **Scenario**: The agent takes a screenshot for verification, and the browser has the card form filled (post-injection, pre-submit).
- **What agent does**: The LLM parses the image and "sees" the card digits in its vision context.
- **hangpay defense**: hangpay dashboard displays only masked values. Injection into the checkout DOM happens at the last moment before submit, minimizing the "unmasked window."
- **Residual risk**: A screenshot taken during that window captures plaintext digits. The browser itself is outside hangpay's process boundary. Stripe Elements cross-origin iframe is the structural defense on compatible checkouts.
- **Severity**: Medium. Narrow time window, but fully reproducible if the agent schedules a screenshot around the submit action.

### 3.3 Error message leaks vault path or partial key material
- **Scenario**: Decryption fails; an uncaught exception bubbles with a stack trace that includes a `Buffer` preview, env var path, or key-derivation intermediate.
- **What agent does**: Reports the "reason for failure" to the user, which ships the stack trace into the LLM chat log.
- **hangpay defense**: `decryptCredentials` explicitly throws `Error("Failed to decrypt vault — wrong key...")` with no payload. See `src/vault.ts:177-180`.
- **Residual risk**: Native-layer failures (e.g., `scrypt::scrypt(...).expect(...)` panic) may produce Rust panics whose strings include offsets or buffer lengths. These are not currently caught by TS sanitization before hitting stderr.
- **Severity**: Low in the common path; higher in the native-panic path (see §5).

### 3.4 Agent curious-read of `~/.config/hangpay/vault.enc`
- **Scenario**: An agent with `read_file` permissions decides to "investigate" the hangpay config directory — not malicious, just enumerating.
- **What agent does**: Reads the file bytes, tries to reason about them, possibly echoes hex to its chat log.
- **hangpay defense**: Encryption at rest. The file is an AES-256-GCM ciphertext blob — no identifiable plaintext remains. Without the machine-bound key, the bytes are computationally indistinguishable from random.
- **Residual risk**: If the same agent also reads `/etc/machine-id` and the local user's name, it has two of three key-derivation inputs. Only the compiled salt remains secret (and in OSS builds, not even that — see §5). File-read access alone is still safe; file-read + shell access is not.
- **Severity**: Low (file-read only), High (file-read + shell or hardened-binary reversal).

### 3.5 Tmp / swap / clipboard leakage post-unlock
- **Scenario**: OS swaps the process's plaintext page to `/var/vm/` or `pagefile.sys`; user manually copies a card from the dashboard to paste; atomic-write tmp file remains briefly on disk.
- **What agent does**: Scans `/tmp`, reads swapfile if running as root, or reads the OS clipboard via agent browser tools.
- **hangpay defense**: Atomic rename with `fsync` + `0o600` permissions for `vault.enc` tmp (`src/vault.ts:248-252`). No explicit `mlock` of plaintext pages. No clipboard interaction by default.
- **Residual risk**: OS swap files are outside application control. `mlock` would require root on many systems. Clipboard leak is a user-driven action, not a hangpay path — but worth documenting.
- **Severity**: Medium. Requires either root or same-user shell access.

### 3.6 Metadata leak via file timestamps
- **Scenario**: An agent monitors `stat ~/.config/hangpay/vault.enc` over time, correlating mtime changes with observed transactions.
- **What agent does**: Builds a usage-pattern profile — when hangpay is unlocked, how often, which days. Doesn't leak card data but leaks behavior.
- **hangpay defense**: None currently. `vault.enc` mtime is not touched-up.
- **Residual risk**: Full usage telemetry available to any process that can `stat` the file.
- **Severity**: Low for card security; non-trivial for behavioral privacy.

### 3.7 LLM provider receives unlock data via tool-response chain
- **Scenario**: A future MCP tool expansion accidentally returns a raw credential field (developer error).
- **What agent does**: Posts the tool response to OpenAI / Anthropic / etc. on the next turn, where it enters their logs and potentially training data.
- **hangpay defense**: Current MCP tool surface is strictly masked-only — no tool returns decrypted fields. Enforced by code review, not by type system.
- **Residual risk**: Type-system enforcement is planned for v0.2 (branded `MaskedCard` type that cannot be produced from plaintext without an explicit masking function).
- **Severity**: Medium — single developer error away.

## 4. Code-Path Defense Map

| Defense area | TS path | Python path (architecture mirror, audit pending) | Note |
|---|---|---|---|
| Encryption-at-rest | `src/vault.ts:143-156` | `HANGPAY_pay/vault.py` (encrypt_credentials) | AES-256-GCM, 12-byte random nonce |
| Decryption + auth-tag check | `src/vault.ts:158-182` | `HANGPAY_pay/vault.py` (decrypt_credentials) | GCM tag verified before plaintext exposure |
| KDF (machine mode) | `native/src/lib.rs:14-36` | `HANGPAY_pay/engine/_vault_core.pyx` (Cython) | scrypt N=2^14, r=8, p=1 |
| KDF (passphrase mode) | `src/vault.ts:110-112` | `HANGPAY_pay/vault.py` (derive_from_passphrase) | PBKDF2-HMAC-SHA256, 600k iters |
| Salt isolation (XOR halves) | `native/src/lib.rs:7-8, 20` | `HANGPAY_pay/engine/_vault_core.pyx` | `A1` + `B2` compiled into native |
| Salt / password zeroization | `native/src/lib.rs:32-33` | Cython equivalent (pending audit) | `zeroize` crate in Rust |
| Atomic vault write | `src/vault.ts:248-252` | `HANGPAY_pay/vault.py` (save_vault) | tmp + fsync + rename, mode 0o600 |
| Downgrade defense | `src/vault.ts:188-227` | `HANGPAY_pay/vault.py` (vault_mode check) | `.vault_mode` marker, `is_hardened()` gate |
| Error sanitization | `src/vault.ts:177-180` | `HANGPAY_pay/vault.py` (raise blocks) | Generic "Failed to decrypt" string |
| MCP masked-only surface | `src/mcp-server.ts` (card-request paths) | `HANGPAY_pay/mcp_server.py` | No tool returns plaintext |

## 6. References

- [THREAT_MODEL.md](./THREAT_MODEL.md) — Product-layer threat model.
- [../SECURITY.md](../SECURITY.md) — Disclosure policy and contact.
- Mirror Python repo: `project-aegis/HANGPAY_pay/vault.py`, `project-aegis/HANGPAY_pay/engine/_vault_core.pyx`.

