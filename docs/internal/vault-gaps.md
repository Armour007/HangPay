# Vault Known Gaps (v0.1 honest)

*Extracted from `docs/VAULT_THREAT_MODEL.md` §5 — moved to internal-facing docs per CEO REVISE privacy path (2026-04-15). Public face is capability-forward; this document catalogs the honest open-gap set for bounty researchers and internal v2 planning.*

- **OSS salt visibility**: In source builds (non-hardened `A1`/`B2` = `None`), `derive_key` returns `None` on the native path. Fallback uses a public OSS salt visible in source. Attacker with the `vault.enc` file + OSS install + knowledge of machine_id + username can reconstruct the key via the same KDF path. Documented limitation. Mitigation: install from npm / PyPI wheels (hardened) or use `--passphrase` mode.
- **Node.js / CPython memory residency**: Plaintext credentials and derived key live in the managed heap during the cipher call. Neither V8 nor CPython guarantees deterministic zeroization. Mitigating this requires writing the full decrypt → inject pipeline in native code (roadmap item).
- **Native panic path bypasses TS error sanitization**: A `scrypt::scrypt(...).expect(...)` or similar panic in the Rust layer can produce a panic message with buffer offsets that hits stderr before TS sees the `Error`. Action: wrap native calls with `catch_unwind` in the Rust layer; return typed `Result` to napi.
- **No `mlock` of plaintext pages**: Plaintext credential pages can be swapped to disk under memory pressure. Requires `CAP_IPC_LOCK` on Linux / being root on macOS; not feasible in userland install.
- **No scrubbing of hangpay's own stdout/stderr**: If a consuming tool pipes hangpay logs into the agent's view, any accidental log of non-masked data escapes structural isolation. Action: add central log-scrubber that matches PAN / CVV / expiry patterns.
- **Machine-ID collisions in virtualized environments**: Docker images with a baked `/etc/machine-id` produce identical keys across deployments. Not an attack vector per se, but breaks the "vault is machine-bound" mental model. Mitigation: document recommended Docker flow (passphrase mode, not machine mode).
- **Metadata (timestamps, file size) not masked**: §3.6 — out of scope for v0.1.
- **Python-side code-line audit pending**: The TS implementation is audited here; Python is architecturally mirrored (same blob format, same KDF params, same salt-hardening pattern) but line-level defenses in `_vault_core.pyx` and `HANGPAY_pay/vault.py` have not been individually cross-referenced. Planned follow-up.
- **Clipboard path**: If user copies card from dashboard to paste manually, clipboard is readable by many agent browser tools. User-education issue; not a technical fix in v0.1.

