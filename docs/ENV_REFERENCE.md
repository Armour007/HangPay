# Environment Variable Reference

All `HANGPAY_*` environment variables for hangpay. Set in `~/.config/hangpay/.env` or export in shell.

## Guardrail Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_ALLOWED_CATEGORIES` | `[]` | JSON array of allowed vendor keywords |
| `HANGPAY_MAX_PER_TX` | *(required)* | Max amount per transaction (USD) |
| `HANGPAY_MAX_DAILY` | *(required)* | Max total spend per day (USD) |
| `HANGPAY_BLOCK_LOOPS` | `true` | Block repeated identical purchase attempts |
| `HANGPAY_PURCHASER_INFO_BLOCKING` | `true` | When `true` (default, zero-trust), `request_purchaser_info` rejects vendors not in `HANGPAY_ALLOWED_CATEGORIES`. When set to any other string (e.g. `false`), the vendor allowlist becomes advisory — the bypass is recorded in `audit_log` with `outcome='blocked_bypassed'`. Security scan and domain-mismatch checks are NEVER bypassed. |
| `HANGPAY_EXTRA_BLOCK_KEYWORDS` | `""` | Comma-separated extra keywords to block |
| `HANGPAY_GUARDRAIL_ENGINE` | `keyword` | `keyword` (local) or `llm` (semantic) |
| `HANGPAY_REQUIRE_HUMAN_APPROVAL` | `false` | Require human confirmation before every payment |

## LLM Guardrail (opt-in)

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_LLM_API_KEY` | `""` | API key for LLM guardrail |
| `HANGPAY_LLM_BASE_URL` | *(none)* | Custom base URL (Ollama, vLLM, OpenRouter) |
| `HANGPAY_LLM_MODEL` | `gpt-4o-mini` | Model name |

## Card Credentials (auto-loaded from encrypted vault, NOT from .env)

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_BYOC_NUMBER` | *(from vault)* | Card number — auto-set at startup from vault.enc |
| `HANGPAY_BYOC_CVV` | *(from vault)* | CVV — auto-set at startup |
| `HANGPAY_BYOC_EXP_MONTH` | *(from vault)* | Exp month — auto-set at startup |
| `HANGPAY_BYOC_EXP_YEAR` | *(from vault)* | Exp year — auto-set at startup |

> These are set as `process.env` defaults in the MCP server at startup.
> Users never need to set these manually — `npx pop-init-vault` handles it.

## Billing Info

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_BILLING_FIRST_NAME` | `""` | Billing first name |
| `HANGPAY_BILLING_LAST_NAME` | `""` | Billing last name |
| `HANGPAY_BILLING_STREET` | `""` | Street address |
| `HANGPAY_BILLING_CITY` | `""` | City |
| `HANGPAY_BILLING_STATE` | `""` | State (2-letter code auto-expands: CA → California) |
| `HANGPAY_BILLING_ZIP` | `""` | Zip / postal code |
| `HANGPAY_BILLING_COUNTRY` | `""` | Country |
| `HANGPAY_BILLING_EMAIL` | `""` | Email |
| `HANGPAY_BILLING_PHONE` | `""` | Phone (E.164) |
| `HANGPAY_BILLING_PHONE_COUNTRY_CODE` | `""` | Dial code (e.g. +1) |

## Browser / CDP

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_CDP_URL` | `http://localhost:9222` | Chrome DevTools Protocol endpoint |
| `HANGPAY_AUTO_INJECT` | `false` | Auto-inject card after guardrail approval |
| `HANGPAY_BLACKOUT_MODE` | `after` | `before` / `after` / `off` — screenshot masking timing |
| `HANGPAY_ALLOWED_PAYMENT_PROCESSORS` | *(built-in)* | Extra allowed domains for TOCTOU |

## Webhooks / Approval

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_WEBHOOK_URL` | *(disabled)* | POST payment notifications (Slack/Teams) |
| `HANGPAY_APPROVAL_WEBHOOK` | *(disabled)* | POST approval requests; expects `{"approved": bool}` (120s timeout) |

## Enterprise / Stripe

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_STRIPE_KEY` | *(none)* | Stripe API key for virtual card issuing |

## x402 (experimental)

| Variable | Default | Description |
|----------|---------|-------------|
| `HANGPAY_X402_WALLET_KEY` | *(none)* | Wallet key for x402 micropayments (stubbed) |

