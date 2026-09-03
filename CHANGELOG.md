# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.10] - 2026-04-16

### Security (RT-2 Round 2 — P1 SQLite freelist PAN leak)

Four-fix bundle. Addresses the same Round 2 red-team finding as the paired Python release (`hangpay-python` v0.8.9): plaintext PAN data persisting in SQLite freelist pages and WAL/SHM sidecars after legacy schema migration, plus state-db permission hardening. TS side has no Fix 3 / Fix 6 / Fix 7 equivalents — PAN handling types, gitignore hygiene, and the keyring wipe path are Python-specific (the TS code already uses an idempotent wipe path).

**PAN leak acceptance:** 9 → 0 leaked bytes verified via PoC against `HANGPAY_state.db` post-migration (SQLite freelist + WAL + SHM sidecars). Parity with the Python fix.

**Verification:** eng local / secretary local / founder fresh install all converged on 232 pass / 5 skip for the TS suite; fresh-shell `npm ci && npm test` re-verified at pre-merge gate.

- **Fix 1 — SQLite freelist zeroing.** `PopStateTracker` constructor sets `PRAGMA secure_delete = ON` and performs a one-time `VACUUM` during legacy-schema migration (guarded by `PRAGMA user_version = 2`, idempotent). Rewrites every freelist page, including pages that still carried plaintext `card_number` residue after the legacy `DROP TABLE` + `RENAME`. `src/core/state.ts:42-48` / `:155-165`.
- **Fix 2 — Owner-only state DB permissions.** `chmod 0600` applied to `HANGPAY_state.db` plus `HANGPAY_state.db-wal` and `HANGPAY_state.db-shm` sidecars at open time. POSIX only; Windows ACLs out of scope. `src/core/state.ts:24-33`.
- **Fix 4 — Drop `masked_card` encryption.** `masked_card` is already a PCI-DSS 3.3 permitted last-4 projection. Prior AES-GCM-over-hostname-HMAC encryption added no meaningful protection over the Fix 2 `0600` file mode and impeded auditability. Stored plaintext from v0.5.10 forward. `src/core/state.ts:190-210`, `src/dashboard.ts:72-90`.
- **Fix 5 — `handleCliError` routing for MCP server fatal errors.** `mcp-server.ts` now routes its top-level catch through `handleCliError` so fatal errors render code + message + remediation with consistent exit codes, matching the other CLI entry points added in v0.5.9. `src/mcp-server.ts`.

### Notes
- `masked_card` rows written by v0.5.8 / v0.5.9 (AES-GCM-encrypted base64) will render as base64 in the dashboard after this upgrade. Not a silent failure mode — the stored string is simply no longer decoded post-Fix 4. Supported remediation: `pop-init-vault --wipe` + fresh seal generation.

### Fix 8 — Public-docs privacy hardening

Removed internal-intent threat-model and methodology docs from the public
npm/GitHub tree. These documents were written for internal review and
reference attacker playbooks and specific bypass hypotheses that should
not ship with the public package.

- Deleted: `docs/AGENT_COMMERCE_THREAT_MODEL.md`, `docs/RED_TEAM_METHODOLOGY.md`, `docs/CATEGORIES_DECISION_CRITERIA.md`
- Preserved public framing (Why exists / Scope / Contributing / Precedents) merged into `docs/internal/agent-commerce-threat-model.md` and `docs/internal/red-team-methodology.md`
- Moved: `docs/benchmark-history/` → `docs/internal/benchmark-history/`
- Cleaned up 6 dangling refs in `tests/redteam/` (pointer comments deleted, template placeholder rephrased)
- Polished `docs/GUARDRAIL_BENCHMARK.md`: TL;DR added; v0 retraction made explicit; Competitive Comparison section removed; Reproducing a run merged; terminology tightened.

**Correction (pre-existing inconsistency fixed as side effect):** An earlier draft of the related internal spec referenced a 4-bucket variant of the §B-class decision thresholds. The 3-bucket matrix in `docs/GUARDRAIL_BENCHMARK.md` §B-class decision is the authoritative source of truth; the 4-bucket variant was a stale draft and should not be cited.

**Pending (v0.5.11):** Ollama batch 1 sweep complete (290 rows, 0 errors, α recommendation). Results + per-runner table + Category-C TBD resolution will append to `docs/GUARDRAIL_BENCHMARK.md` in v0.5.11 once this release ships.

**Security rationale:** Public docs should document product behavior, not the adversary's attack surface or our internal deprecation calculus.

[0.5.10]: https://github.com/akshay/hangpay/compare/v0.5.9...v0.5.10

## [0.5.9] - 2026-04-15

### Security (S0.7 Vault Hardening — F1-F8)
- **F1 — `filteredEnv()` + `SENSITIVE_ENV_KEYS`.** Strips `HANGPAY_BYOC_NUMBER` / `HANGPAY_BYOC_CVV` / `HANGPAY_BYOC_EXP_MONTH` / `HANGPAY_BYOC_EXP_YEAR` from any env dict spawned to child processes. `loadVault()` guarantees BYOC keys never leak into `process.env`. New regression tests cover child-process inheritance.
- **F3 — OSS salt consent gate.** `machine-oss` vaults now refuse to decrypt unless `HANGPAY_ACCEPT_OSS_SALT=1` is set. Passphrase-mode vaults bypass the gate. Protects against silent weak-crypto decryption when running OSS-source builds.
- **F4 — Vault mode marker migration.** Legacy markers (`hardened` / `oss`) transparently migrate on read to `machine-hardened` / `machine-oss`; new markers `passphrase` distinguish keyring-backed vaults from machine-id vaults.
- **F6 — Typed error lifecycle (cheap parts).** Vault decryption, native-lib failures, and KDF errors now surface `VaultDecryptFailed` / `VaultNativeUnavailable` with actionable remediation. No plaintext in messages.
- **F6(A) — Transport separation.** CDP injector and vault loader no longer share an error surface — a vault failure cannot be misreported as a CDP failure.
- **F7 — Downgrade refuse.** `machine-hardened` marker + native reporting not-hardened raises `RuntimeError` on `loadVault()`; `pop-init-vault` refuses overwrite.
- **F8 — Stale `.tmp` sweep + `wipeVaultArtifacts`.** `saveVault()` sweeps `vault.enc*.tmp` siblings before atomic-writing. New `pop-init-vault --wipe` subcommand enumerates and deletes `vault.enc`, `.vault_mode`, `.machine_id`, and stale `.tmp` files.
- **Bounty policy remains private.** Three scope categories (Passive Leak / Active Attack / Vault Extraction) retained; public tier disclosure + Hall of Fame deferred until internal red team iteration completes.

### Added
- **Error Model Refactor (`src/errors.ts`).** Full `PopPayError` hierarchy: `VaultDecryptFailed` / `VaultNativeUnavailable` / `ConfigMissing` / `ConfigInvalid` / `GuardrailProviderUnreachable` / `GuardrailInvalidResponse` / `GuardrailRetryExhausted` / `InjectorTimeout` / `InjectorCDPFailure` / `LLMAPIKeyMissing`. CLI entry points route through `handleCliError()` for consistent exit codes and user-facing remediation.
- **RT-1 harness + 585-payload v1 corpus.** `tests/redteam/` with 5 runner paths (`layer1`, `layer2`, `full_mcp`, `toctou`, `hybrid`), corpus at `tests/redteam/corpus/attacks.json`, validator, aggregator, and per-runner tests.
- **`docs/CATEGORIES_DECISION_CRITERIA.md`** — S0.2a decision framework for vendor allowlist categories.
- **`docs/GUARDRAIL_BENCHMARK.md`** — formal benchmark methodology + results registry.

### Changed
- **Capability-forward documentation.** `SECURITY.md` / `docs/THREAT_MODEL.md` rewritten per CEO REVISE — legacy 20-scenario / 95% claims and §5 Known Limitations removed from the public face; threat-model prelude relocated to `docs/internal/`.
- **`.env` template quoting.** `HANGPAY_ALLOWED_CATEGORIES` JSON arrays wrapped in single quotes; `HANGPAY_BILLING_STREET` / `HANGPAY_BILLING_CITY` values with spaces double-quoted so `dotenv` parses them cleanly.

## [0.5.8] - 2026-04-14

### Added
- **`hangpay doctor` diagnostic subcommand** — 10 generic connectivity / environment checks: `node_version`, `chromium`, `cdp_port`, `config_dir`, `vault`, `env_vars`, `policy_config`, `layer1_probe`, `layer2_probe`, `injector_smoke`. Emits pass/warn/fail per check with actionable remediation; exits `0` when clean, `1` on blocker failure, `2` on internal crash. Supports `--json` for machine-readable output.
- **Remediation catalog** at `config/doctor-remediation.yaml` — text messaging decoupled from code, editable without a release.
- **`docs/DOCTOR.md`** — full documentation + KNOWN LIMITATIONS section explaining the intentional engine-classify gap (doctor ships with its own local handler; typed-engine-failure classification deferred to post-refactor round 2, pending the paused Error Model Refactor track).

### Security
- **F5 — PAN redaction in structured logs.** `redactPanInString()` strips 12–19-digit runs from any free-form string routed through `src/engine/injector.ts`' `log()` helper, defense-in-depth against upstream error messages echoing card data into stdout/stderr.
- **Bounty program set to private.** Reports go to `security@hangpay.ai`; scope retained as three categories (Passive Leak / Active Attack / Vault Extraction); public tiers and Hall of Fame will open after internal red team completes iterative hardening rounds.
- **`check_env_vars` is format-only and content-blind.** Reports `present (hidden)` / `missing` for all `HANGPAY_LLM_*` secrets (no length, prefix, or hash). JSON-array envs report entry count only.
- **`check_layer2_probe` is TCP-only.** Opens and closes a connection to the LLM host — no HTTP request is issued, no API key is ever transmitted, no quota is burned.
- **Internal vault canary `examples/vault-challenge/vault.enc.challenge`** — internal cryptographic boundary target for the vault-extraction bounty category; external challenge opens with public bounty. AES-256-GCM blob with discarded scrypt passphrase, fake card data, and a unique flag string. Includes reproducible `gen-challenge.js` / `gen-challenge.py` generators. See `examples/vault-challenge/README.md`.

### Documentation
- **`docs/VAULT_THREAT_MODEL.md` v0.1** — vault-layer threat model covering active attacks (file theft, memory dump, binary RE, KDF brute force, side channels, salt recovery) and a standalone **passive failure mode** section with 7 concrete scenarios (log/screenshot leaks, error-message leaks, agent curious-read, tmp/swap/clipboard leaks, metadata, LLM provider chat-log leak). Cites `src/vault.ts` and `native/src/lib.rs` code paths. Python-side line-level audit flagged as pending in §5.
- **`docs/HALL_OF_FAME.md`** — placeholder; published when bounty program opens publicly.

## [0.5.7] - 2026-04-13

### Fixed
- **Dual-publish workflow regression**: 0.5.6 failed to publish because the new workflow had drifted from the v0.5.5 working config. Reverted `actions/checkout` and `actions/setup-node` from `@v4` back to `@v6`, `node-version` from `'20'` back to `'24'`, and removed the explicit `--provenance --access public` flags (Trusted Publisher auto-enables provenance; `access` is set via `publishConfig` in `package.json`). Dual-publish structure (primary → scoped → verify) preserved.

### Notes
- 0.5.6 tag exists but no tarball was published to the registry (`E404` on PUT after sigstore attestation was signed). This 0.5.7 release ships the same content as 0.5.6 plus the workflow fix.

## [0.5.6] - 2026-04-13

### Changed
- **README restructured to CLI-first**: MCP server demoted to a sub-section; Install section is fully collapsed (Homebrew / curl / npm / npx each in its own `<details>`, no default-expanded recommendation).
- **Install paths expanded**: Homebrew tap (`brew install akshay/tap/hangpay`) and `curl | sh` bootstrap installer (`install.sh`) added alongside existing npm / npx paths.
- **`package.json` metadata refresh**: description and keywords rewritten CLI-first (added `cli`, `command-line`, `agent-tool`, `payment-cli`, `browser-agent`).

### Added
- **Scoped mirror package `@akshay/mcp-server-hangpay`**: new `scoped-mirror/` sub-project, a thin re-export of `hangpay` at the exact same version, matching Anthropic's MCP `@scope/mcp-server-<name>` naming convention. Tracks the primary package on every release.
- **Dual-publish workflow**: `.github/workflows/publish.yml` now publishes both `hangpay` and `@akshay/mcp-server-hangpay` via OIDC / Trusted Publisher (`--provenance --access public`), with a `verify` gate that `npm view`s both before the release is considered successful. Any job failure fails the whole release.
- **`.mcp.json`** at repo root for Open Plugins standard compliance (Cursor Directory discovery).
- **`glama.json`** for Glama.ai listing metadata (`maintainers: ["akshay"]`).
- **Homebrew tap auto-bump workflow** (`.github/workflows/dispatch-tap-bump.yml`): on release, computes the npm tarball SHA256 and dispatches a formula update to `akshay/homebrew-tap`.
- **Runtime demo GIF** in README hero (cross-repo reference to `hangpay-python/assets/runtime_demo.gif` — not duplicated as a binary here).
- **Cross-link to Python repo** in README (same vault format, safe to switch runtimes).
- **`.claude/settings.json`** with a conservative per-binary allow-list replacing the previous `Bash(*)` wildcard.

### Notes
- No source-code changes. This is a packaging / distribution / documentation release and the first production run of the dual-publish workflow.

## [0.5.4] - 2026-04-10

### Fixed
- **`mcpName` case mismatch with MCP Registry**: registry preserves GitHub org case (`akshay`), not lowercase. Updated `mcpName` from `io.github.akshay/hangpay` to `io.github.akshay/hangpay` so the npm-advertised MCP name matches the Official MCP Registry entry.

## [0.5.3] - 2026-04-10

### Changed
- **MCP marketplace listing metadata**: added `mcpName: io.github.akshay/hangpay` to package.json for Official MCP Registry discovery, added `smithery.yaml` config schema for Smithery listing, bundled `assets/logo-400x400.png` for marketplace display.
- **GitHub org migration**: updated repository, homepage, bugs, README badges, SECURITY advisory link, and docs references from `akshay/hangpay` to `akshay/hangpay`.

## [0.5.2] - 2026-04-10

### Fixed
- **`request_purchaser_info` still blocked unapproved vendors after v0.5.0:** v0.5.0 was supposed to turn vendor blocking into pure audit logging, but the handler kept its original `return` guard, so the billing-info auto-fill was still hard-rejected when the vendor was absent from `HANGPAY_ALLOWED_CATEGORIES`. Vendor blocking is now explicitly controlled by `HANGPAY_PURCHASER_INFO_BLOCKING` (default `true`, zero-trust). **Security scan and domain-mismatch checks are never bypassed by this flag.**
- **Audit log rows did not record outcome/reason:** v0.5.0 wrote a single audit row at the top of the handler saying "this was attempted" without recording what actually happened. Operators had no way to tell a rejection from a success in the dashboard. The handler now emits exactly one audit row per call at the resolved exit point with `outcome` (`approved` / `rejected_vendor` / `rejected_security` / `blocked_bypassed` / `error_injector` / `error_fields`) and `rejection_reason` (human-readable context when relevant).

### Added
- **`HANGPAY_PURCHASER_INFO_BLOCKING` env var (default `true`):** explicit toggle for `request_purchaser_info` vendor allowlist enforcement. When set to any other string (e.g. `false`), the vendor check becomes advisory and the bypass is audited as `outcome='blocked_bypassed'`. Documented in `docs/ENV_REFERENCE.md` and `CONTRIBUTING.md` (Open Discussion section inviting community feedback on the default).
- **`audit_log.outcome` + `audit_log.rejection_reason` columns:** new columns on `audit_log`. Migration is idempotent and additive — existing rows written by v0.5.0 / v0.5.1 get `outcome='unknown'` so the dashboard can still surface them without breaking. `PopStateTracker.recordAuditEvent()` signature extended with `outcome` and `rejectionReason` args (backwards-compatible — both default to `null`).
- **Dashboard AUDIT_LOG — OUTCOME + REASON columns:** new columns in the dashboard audit table with color coding (`approved` green, rejected/error red, `blocked_bypassed` orange, `unknown` gray).
- **State-level test coverage** for `audit_log` outcome persistence and the legacy audit_log migration.

### Changed
- **Schema migration:** opening a legacy DB now also runs an additive `ALTER TABLE audit_log ADD COLUMN outcome TEXT` / `ADD COLUMN rejection_reason TEXT` pair (idempotent via `PRAGMA table_info` check). `src/dashboard.ts` does the same defensively so launching the dashboard before the tracker can't break the `/api/audit` SELECT.

## [0.5.1] - 2026-04-10

### Changed
- **Dashboard default port 3210 → 8860.** 8860 is less commonly occupied by other local-dev tooling than 3xxx ports, and ties into the "pay" brand root. Override with `--port` as before. Users running the dashboard with no explicit `--port` will need to update bookmarks to `http://localhost:8860`.

## [0.5.0] - 2026-04-10

### Added
- **`audit_log` table:** informational audit trail for MCP tool invocations. Every `request_purchaser_info` call now logs `event_type`, `vendor`, `reasoning`, and an ISO 8601 UTC timestamp. Non-blocking — failures to log never interrupt the main flow.
- **Dashboard AUDIT_LOG section:** new table rendering `/api/audit` events (id, event_type, vendor, reasoning, timestamp).
- **`PopStateTracker.recordAuditEvent()` / `.getAuditEvents()`:** public API for emitting and reading audit events.

### Fixed
- **Bug 1 — timestamps now ISO 8601 with `Z` suffix:** `issued_seals.timestamp` previously used SQLite `CURRENT_TIMESTAMP` which is ambiguous about timezone. New inserts use `new Date().toISOString()`. Legacy rows are migrated in-place on first open.
- **Bug 2 — `rejection_reason` column now persisted:** dashboard REJECTION_LOG previously showed an empty REASON column. Root cause was two-fold: (a) `issued_seals` had no `rejection_reason` column; (b) `dashboard.js` `renderRejected()` didn't emit a REASON cell even though the HTML header declared one. Both fixed. All three rejection paths in `client.ts` now pass the reason through. Migration adds the column to legacy DBs.
- **Bug 3 — dashboard "today spending" always $0 / utilization 0%:** Root cause (empirically verified, not hypothesized): `PopClient` constructor in `src/client.ts` defaulted `dbPath` to the relative string `"HANGPAY_state.db"`, so when the MCP server was launched from one working directory it wrote to `<cwd>/HANGPAY_state.db` while the dashboard read from `~/.config/hangpay/HANGPAY_state.db` (the `PopStateTracker` default). `addSpend` was firing correctly — it was just writing to a file the dashboard never opened. Fix: drop the hardcoded default; when no `dbPath` is passed, construct `PopStateTracker` with no arg so both sides converge on `DEFAULT_DB_PATH`. Regression test added.
- **Dashboard XSS hardening:** `dashboard.js` used to inject raw values (seal_id, vendor, rejection_reason, audit reasoning) into `innerHTML`. All user-data cells now pass through `escapeHtml()`.
- **Dashboard/tracker schema drift:** `dashboard.ts` used to run its own inline `CREATE TABLE` which didn't know about new columns. It now delegates schema creation + migration to `PopStateTracker`, so the dashboard and MCP server always agree on schema even if the dashboard is launched first against a legacy DB.

### Changed
- **Schema migration (upgrade-safe):** opening a legacy DB now (1) rebuilds `issued_seals` if it still has `card_number`/`cvv` columns (very-legacy path, preserves masked data); (2) adds `rejection_reason` if missing; (3) rewrites legacy `YYYY-MM-DD HH:MM:SS` timestamps to ISO 8601 Z format; (4) creates `audit_log` table. Migration is idempotent.
- **Dashboard port 3210:** no functional change, but documented: port was chosen arbitrarily during initial dashboard bring-up and is kept for continuity with existing user bookmarks.

## [0.3.3] - 2026-04-09

### Fixed
- Card injection in Stripe multi-iframe layouts (Zoho Checkout). Fields are now filled independently across sibling iframes instead of requiring all fields in a single frame.

### Changed
- Removed `page_snapshot` as standalone MCP tool. Security scan is now automatically embedded in `request_virtual_card` and `request_purchaser_info`.
- MCP server exposes 3 tools (was 4): `request_virtual_card`, `request_purchaser_info`, `request_x402_payment`.

## [0.2.0] - 2026-04-05

### Added
- Major documentation overhaul with professional MCP standards.
- Platform setup guides for Claude Code, Cursor, Windsurf, and VS Code.
- Status badges (npm, License, CI, Node.js) to README.

## [0.1.2] - 2026-04-04

### Changed
- Hardened CI workflows with environment protection and explicit permissions.
- Moved salt injection to environment variables for improved security.

## [0.1.1] - 2026-04-04

### Added
- Automated npm publish workflow using OIDC trusted publishing.
- Repository metadata and `.npmignore` configuration.

## [0.1.0] - 2026-04-03

### Added
- Initial TypeScript + Rust port from the Python repository.
- **MCP Server**: Full Model Context Protocol implementation.
- **CDP Injection Engine**: Advanced DOM traversal supporting iframes and Shadow DOM.
- **CLI Commands**:
  - `pop-launch`: Starts Chrome with CDP and MCP.
  - `pop-init-vault`: Securely initializes the encrypted credential vault.
  - `pop-unlock`: Unlocks the vault using the OS keyring.
- **Security**: AES-256-GCM encryption for credentials and Rust native layer via napi-rs.
- **Testing**: Comprehensive suite with 170+ tests covering SSRF, TOCTOU, and vault interop.
- **Docker**: Containerized setup with headless Chromium.
- **New Tools**: Added `page_snapshot` for security scanning of checkout pages.

