# Contributing to hangpay

Thank you for your interest in contributing to HangPay (`hangpay`)! We are building the runtime security layer for AI agent commerce, and we welcome contributions from the community.

## Development Setup

### Prerequisites
- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **Rust**: Latest stable (required for building the native layer)

### Installation
1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/hangpay.git
   cd hangpay
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the native Rust layer:
   ```bash
   npm run build:native
   ```
4. Build the TypeScript source:
   ```bash
   npm run build
   ```

## Workflow

### Testing
We use **Vitest** for our test suite. Ensure all tests pass before submitting a PR:
```bash
npm test
```
To run tests in watch mode:
```bash
npm run test:watch
```

### Linting
We follow strict TypeScript and ESLint rules:
```bash
npm run lint
```

### Pull Request Process
1. Create a new branch: `git checkout -b feat/your-feature-name`.
2. Implement your changes and add tests.
3. Verify tests and linting pass.
4. Submit a Pull Request with a clear description of the changes and the problem they solve.

### Schema Changes

`PopStateTracker` (`src/core/state.ts`) is the single source of truth for the SQLite schema. The dashboard (`src/dashboard.ts`) delegates all table creation and migration to `PopStateTracker` on startup — it does **not** run its own `CREATE TABLE` statements against `issued_seals` or `audit_log`. If you add or modify a column:

1. Update the `CREATE TABLE` in the `PopStateTracker` constructor so fresh DBs get the new shape.
2. Add a migration branch next to the existing ones (add-column / rebuild) so legacy DBs upgrade in place. **Migrations must be idempotent** — running them on an already-migrated DB must be a no-op.
3. Use ISO 8601 UTC with a `Z` suffix for all timestamps (`new Date().toISOString()`). Do **not** use SQLite `CURRENT_TIMESTAMP`, which is ambiguous about timezone and parses as local time in browsers.
4. Add a regression test in `tests/audit-and-migration.test.ts` that constructs a pre-change DB, opens it with `PopStateTracker`, and asserts the new shape.

### DB Path Consistency

`PopClient` and the dashboard must point at the same SQLite file, or the dashboard will read from an empty DB while the MCP server writes somewhere else (this was the root cause of the v0.4.x "dashboard always shows $0" bug). When no explicit `dbPath` is passed, **always** construct `PopStateTracker` with no arguments so it uses `DEFAULT_DB_PATH` (`~/.config/hangpay/HANGPAY_state.db`). Never hardcode a relative path like `"HANGPAY_state.db"` as a default — that resolves against the process CWD and diverges depending on where the MCP server was launched from.

### Dashboard Port

The local dashboard listens on **port 8860** by default (changed from 3210 in v0.5.1). 8860 was chosen because it is less commonly occupied by other local-dev tooling than 3xxx ports, and it ties into the "pay" brand root. Override with the `--port` flag if you need to run multiple dashboards side-by-side.

### Dashboard UI (`dashboard/dashboard.js`)

All user-controlled values (seal IDs, vendor strings, rejection reasons, audit reasoning) must be rendered through `escapeHtml()` before being inserted via `innerHTML`. Never interpolate raw DB values into template strings — they pass through agent reasoning and are an XSS sink.

## Architecture Overview

`hangpay` is structured into several key layers:
- **MCP Server**: The interface for AI agents (Claude Code, OpenHands, etc.).
- **Playwright Injection Engine**: Uses Playwright's `connectOverCDP` to traverse cross-origin iframes (including Stripe sandboxed iframes) and Shadow DOM trees, injecting credentials directly.
- **Guardrails**: Hybrid Keyword + LLM logic to evaluate purchase intent and block hallucinations.
- **Vault**: AES-256-GCM encrypted storage for BYOC credentials.
- **Native Layer**: Rust-based (napi-rs) for secure key derivation and salt handling.

## Call for Contributions

We are specifically looking for help in the following areas:
- **New Payment Providers**: Implementations for more virtual card issuers (e.g., Marqeta, Airwallex).
- **Guardrail Improvements**: Better semantic analysis to catch subtle prompt injections.
- **Injection Resilience**: Enhancing the Playwright-based engine to handle more complex or obfuscated checkout forms.
- **Checkout Coverage**: Adding more "known processors" to `src/engine/known-processors.ts`.
- **Documentation**: Improving guides, adding examples, and translating docs.

## Open Discussion: masked_card Encryption

Currently, `masked_card` values (e.g., `****-4242`) are encrypted at rest in SQLite using AES-256-GCM. The dashboard API decrypts them before display.

We're seeking community input on whether this encryption is necessary:
- **Current state**: Masked card values like `****-4242` are encrypted in `HANGPAY_state.db` and decrypted on read
- **Argument for keeping**: Defense-in-depth — even masked data gets encryption
- **Argument for removing**: `****-4242` is not PCI-sensitive data (PCI DSS explicitly allows truncated PAN display). Encryption adds complexity and caused a dashboard display bug where raw ciphertext was shown instead of the masked value
- **Note**: Full card numbers are never stored in the database — only the masked form

If you have opinions on this, please open an issue or discussion. We'd love to hear from security researchers and PCI practitioners.

## Open Discussion: `request_purchaser_info` Vendor Blocking

In v0.5.2 we added the `HANGPAY_PURCHASER_INFO_BLOCKING` env var (default `true`) to control whether the vendor allowlist is enforced for billing-info auto-fill, separately from card issuance.

The default behaviour is **zero-trust**: if `target_vendor` is not in `HANGPAY_ALLOWED_CATEGORIES`, the request is rejected and an `audit_log` row with `outcome='rejected_vendor'` is written.

When `HANGPAY_PURCHASER_INFO_BLOCKING=false`, the vendor allowlist becomes advisory for billing-info only. The bypass is recorded in `audit_log` with `outcome='blocked_bypassed'` so operators still have a paper trail. **Security scan and domain-mismatch checks are NEVER bypassed by this flag** — they remain hard gates.

We are seeking community input on whether this default is right:

- **Argument for default-blocking (current)**: Vendor allowlist is the primary perimeter; billing-info exfiltration is a real risk if a hijacked agent is allowed to auto-fill on arbitrary domains. Default-deny matches the rest of the guardrail surface.
- **Argument for default-advisory**: Billing info (name, address, email, phone) is much less sensitive than a card number — many legitimate flows hit unfamiliar vendor pages (event registrations, niche marketplaces). Always-on blocking creates friction without buying much security, especially since the security scan + domain check still apply.
- **Counter-argument**: A user who genuinely needs the advisory mode can already opt in with one env var. Defaults govern the silent majority and should be safe.

If you have opinions on this — especially real-world reports of the default getting in your way, or evidence that the bypass mode is being abused — please open an issue or discussion. We will revisit the default in a future minor release based on community feedback.

## Code of Conduct
Please be respectful and professional in all interactions. We aim to foster an inclusive and welcoming environment for all contributors.

## License
By contributing, you agree that your contributions will be licensed under the project's MIT License.

