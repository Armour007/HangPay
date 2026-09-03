# HangPay Integration Guide

> **For developers** who want to embed HangPay as the financial middleware in their agentic workflows.
> This guide covers four integration patterns: **Claude Code (BYOC + CDP injection)**, **Node.js SDK**, **browser-agent middleware (Playwright / browser-use / Skyvern)**, and **OpenClaw/NemoClaw System Prompts**.

---

## 1. Claude Code — Full Setup with CDP Injection

This section covers the complete three-component setup for using HangPay with **Claude Code** (Hacker Edition / BYOC). Both MCPs share the same Chrome instance: Playwright MCP handles navigation while HangPay MCP injects card credentials directly into the DOM via CDP. The user can watch the entire flow live in the browser — the raw card number never enters Claude's context.

### Architecture

```
Chrome (--remote-debugging-port=9222)
├── Playwright MCP  ──→ agent uses for navigation
└── POP MCP         ──→ injects real card via CDP
         │
         └── Claude Code Agent (only sees ****-****-****-4242)
```

### Step 0 — Launch Chrome with CDP (must be done first, every session)

**Recommended — use `pop-launch`:**

```bash
npx pop-launch
```

`pop-launch` is included with `hangpay`. It auto-discovers Chrome on your system, launches it with the correct CDP flags, waits until the port is ready, and then prints the exact `claude mcp add` commands for your machine. Run `npx pop-launch --help` for options (`--port`, `--url`, `--print-mcp`).

<details>
<summary>Manual alternative (if you prefer to launch Chrome yourself)</summary>

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-pop-profile

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-pop-profile
```

> **Why `--user-data-dir`?** If Chrome is already running, a separate profile is required to open a new instance with CDP enabled. Without this flag, Chrome silently reuses the existing instance and CDP will not be available.

Verify that CDP is active:

```bash
curl http://localhost:9222/json/version
# Should return a JSON object with "Browser", "webSocketDebuggerUrl", etc.
```

**Shell alias** (add to `~/.zshrc` or `~/.bashrc`):

```bash
# macOS
alias chrome-cdp='"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-pop-profile'

# Linux
alias chrome-cdp='google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-pop-profile'
```

</details>

### Step 1a — Initialize the Credential Vault

Card credentials are stored in an **AES-256-GCM encrypted vault**, not in a plaintext file. Run once to set up:

```bash
npx pop-init-vault
```

You'll be prompted for your card number, CVV, expiry, and billing info (all input is hidden). Credentials are encrypted into `~/.config/hangpay/vault.enc` and the MCP server decrypts them automatically at startup — nothing else to do per session.

**Passphrase mode** (stronger — protects against agents with shell execution):

```bash
npx pop-init-vault --passphrase   # one-time setup: derives key from your passphrase
npx pop-unlock                     # run once before each MCP server session
```

`pop-unlock` stores the derived key in the OS keyring. The MCP server reads it at startup — you never type your passphrase again until the next session.

> **Security levels (lowest → highest):**
> plaintext `.env` < vault, machine key, OSS source < vault, machine key, `npm install hangpay` < vault + passphrase < Stripe Issuing (commercial, no local credentials)

### Step 1b — Configure Policy (`.env`)

Create `~/.config/hangpay/.env` for **policy and non-sensitive config only** — no card credentials here:

```bash
# ── Spending policy ──
HANGPAY_ALLOWED_CATEGORIES='["aws", "cloudflare", "openai", "github", "wikipedia", "donation"]'
HANGPAY_MAX_PER_TX=100.0
HANGPAY_MAX_DAILY=500.0
HANGPAY_BLOCK_LOOPS=true

# ── CDP injection ──
HANGPAY_AUTO_INJECT=true
HANGPAY_CDP_URL=http://localhost:9222

# ── Guardrail mode: "keyword" (default) or "llm" ──
# HANGPAY_GUARDRAIL_ENGINE=keyword

# ── Billing info for auto-filling name/address/contact fields on checkout pages ──
# HANGPAY_BILLING_FIRST_NAME=Bob
# HANGPAY_BILLING_LAST_NAME=Smith
# HANGPAY_BILLING_EMAIL=bob@example.com
# HANGPAY_BILLING_PHONE_COUNTRY_CODE=US     # Optional: fills country code dropdown; national number auto-derived
# HANGPAY_BILLING_PHONE=+14155551234        # E.164 format
# HANGPAY_BILLING_STREET="123 Main St"
# HANGPAY_BILLING_CITY="Redwood City"
# HANGPAY_BILLING_STATE=CA                  # Full name or abbreviation, matched fuzzily
# HANGPAY_BILLING_COUNTRY=US                # ISO code or full name, matched fuzzily
# HANGPAY_BILLING_ZIP=94043

# ── Extra payment processors to trust (built-in list covers Stripe, Zoho, Square, etc.) ──
# HANGPAY_ALLOWED_PAYMENT_PROCESSORS='["checkout.myprocessor.com"]'

# ── Custom block keywords (extends built-in list) ──
# HANGPAY_EXTRA_BLOCK_KEYWORDS=
```

> **After editing `.env`, restart your agent session** (e.g. close and reopen Claude Code). The MCP server loads configuration once at startup and does not hot-reload.

### Guardrail Mode Configuration

By default, HangPay uses the `keyword` engine — a zero-cost, zero-dependency check that blocks obvious hallucination loops and prompt injection phrases. For production or high-value workflows, switch to `llm` mode: it runs Layer 1 keyword check first (fast, no API cost), then Layer 2 LLM semantic evaluation — only use if you need semantic reasoning checks beyond keyword matching.

| | `keyword` (default) | `llm` |
|---|---|---|
| **How it works** | Blocks requests whose `reasoning` string contains suspicious keywords (e.g. "retry", "failed again", "ignore previous instructions") | Hybrid mode: Layer 1 keyword engine runs first (fast, no API cost), then Layer 2 LLM semantic evaluation |
| **What it catches** | Obvious loops, hallucination phrases, prompt injection attempts | Subtle off-topic purchases, logical inconsistencies, policy violations that keyword matching misses |
| **Cost** | Zero — no API calls, instant | Layer 1 is free; one LLM call per `request_virtual_card` invocation only if Layer 1 passes |
| **Dependencies** | None | Any OpenAI-compatible endpoint |
| **Best for** | Development, low-risk workflows, cost-sensitive setups | Production, high-value transactions, untrusted agent pipelines |

**LLM mode:**

```bash
export HANGPAY_GUARDRAIL_ENGINE=llm

# Option A: OpenAI
export HANGPAY_LLM_API_KEY=sk-...
export HANGPAY_LLM_MODEL=gpt-4o-mini          # default

# Option B: Local model via Ollama (free, private)
export HANGPAY_LLM_BASE_URL=http://localhost:11434/v1
export HANGPAY_LLM_MODEL=llama3.2
# HANGPAY_LLM_API_KEY can be set to any non-empty string for Ollama

# Option C: Any OpenAI-compatible endpoint (OpenRouter, vLLM, LM Studio...)
export HANGPAY_LLM_BASE_URL=https://openrouter.ai/api/v1
export HANGPAY_LLM_API_KEY=sk-or-...
export HANGPAY_LLM_MODEL=anthropic/claude-3-haiku
```

> **Tip:** Start with `keyword` during development. Switch to `llm` when moving to production or when the agent pipeline is handling real money or untrusted inputs.

### Step 2 — Add HangPay MCP to Claude Code

```bash
npx pop-launch --print-mcp
```

Copy the printed `claude mcp add hangpay -- ...` command and run it:

```bash
claude mcp add hangpay -- npx hangpay launch-mcp
```

> `--scope user` (optional) stores the registration in `~/.claude.json` — available in every Claude Code session. Without it, the registration is scoped to the current project.

### Step 3 — Add Playwright MCP to Claude Code

```bash
claude mcp add --scope user playwright -- npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

> **`--cdp-endpoint` is required.** It connects Playwright MCP to the **same Chrome** that HangPay uses for injection. Without it, Playwright runs its own isolated browser and HangPay cannot see the pages — injection will fail with a "could not find card fields" error. Run **once**; persists automatically.

### `request_virtual_card` Parameters

| Parameter | Required | Description |
|---|---|---|
| `requested_amount` | Yes | The transaction amount in USD. |
| `target_vendor` | Yes | The vendor or service being purchased (e.g. `"openai"`, `"Wikipedia"`). Must match an entry in `HANGPAY_ALLOWED_CATEGORIES`. |
| `reasoning` | Yes | The agent's explanation for why this purchase is needed. Evaluated by the guardrail engine. |
| `page_url` | No | The current checkout page URL. Used to cross-validate the vendor domain against known domains to detect phishing. Pass `page.url` from the browser when using Playwright MCP. |

> **Domain validation:** When `page_url` is provided and the `target_vendor` matches a known vendor (AWS, GitHub, Cloudflare, OpenAI, Stripe, Anthropic, Wikipedia, and others), hangpay validates the page URL's domain against the expected domains for that vendor. Mismatched domains — a sign of a phishing page — cause the request to be rejected automatically.

### Recommended System Prompt Addition

Add the following block to your Claude Code system prompt (or project `CLAUDE.md`). This tells the agent to start Chrome if needed and pass `page_url` correctly:

```
hangpay payment rules:
- Billing info and card credentials: NEVER ask the user — hangpay auto-fills everything.
- Billing/contact page (no card fields visible): call request_purchaser_info(target_vendor, page_url)
- Payment page (card fields visible): call request_virtual_card(amount, vendor, reasoning, page_url)
- Always pass page_url. Never type card numbers or personal info manually. Never read .env files.
- Rejection → stop and report to user. hangpay MCP unavailable → stop and tell user.
- CDP check: curl http://localhost:9222/json/version — if down, run npx pop-launch first.
```

### Full Session Flow

**One-time setup** (human, after installing):

1. `npm install hangpay`
2. `npx pop-init-vault` → encrypt your card credentials
3. Create `~/.config/hangpay/.env` → fill in your policy settings
4. `npx pop-launch --print-mcp` → run the `claude mcp add` commands it prints

**Every session** (agent handles this if you add the system prompt above):

1. Agent checks if Chrome is running (`curl http://localhost:9222/json/version`) — if not, runs `npx pop-launch`
2. Open Claude Code → both MCPs connect automatically
3. Agent navigates to checkout via Playwright MCP, calls `request_virtual_card` with `page_url`
4. HangPay injects real card into the form — agent only sees the masked number
5. Agent clicks submit; card is burned after use

### Your First Live Test

Once both MCPs are connected, paste this into a new Claude Code conversation:
```bash
> Donate $10 to Wikipedia, with credit card, pay with hangpay. Fill in the payment details, but **do not submit** — I will review and confirm before proceeding.
```
> **Note:** The `"do not submit"` instruction is for initial testing only. Once you have verified the injection flow works correctly, remove it from your prompt to enable fully autonomous payments within your configured policy limits.

**Expected flow:** Agent navigates → selects $10 → clicks "Donate by credit/debit card" → calls `request_virtual_card` → HangPay injects card + billing details via CDP → agent waits for your confirmation.

> **If the request is rejected with "Vendor not in allowed categories":** Add `donation` to `HANGPAY_ALLOWED_CATEGORIES` in your `.env`, then start a new Claude Code session (no need to re-register the MCP — a new session restarts the server and reloads `.env` automatically).

---

## 2. Node.js SDK Integration

For automation scripts that use a custom Node.js agent loop, embed the hangpay client directly as payment middleware.

### Pattern: PopClient as Script Middleware

```typescript
import { PopClient } from 'hangpay';
import { MockProvider } from 'hangpay/providers';
import type { GuardrailPolicy, PaymentIntent } from 'hangpay';

async function runAutomatedWorkflow() {
  // 1. Initialize HangPay at the start of your script
  const policy: GuardrailPolicy = {
    allowedCategories: ['SaaS', 'API', 'Cloud'],
    maxAmountPerTx: 50.0,
    maxDailyBudget: 200.0,
    blockHallucinationLoops: true,
  };

  const client = new PopClient({
    provider: new MockProvider(),
    policy,
    dbPath: 'HANGPAY_state.db',
  });

  // 2. When your script needs to make a purchase, go through HangPay
  const intent: PaymentIntent = {
    agentId: 'node-script-001',
    requestedAmount: 15.0,
    targetVendor: 'openai',
    reasoning: 'Topping up API credits to continue the data pipeline run.',
  };

  const seal = await client.processPayment(intent);

  if (seal.status === 'Rejected') {
    console.log(`Payment blocked: ${seal.rejectionReason}`);
    return; // halt script — do NOT proceed with a fallback
  }

  console.log(`Approved. Seal: ${seal.sealId} | Card: ****-****-****-${seal.cardNumber.slice(-4)}`);

  // 3. Use the sealId to execute (burn-after-use enforced)
  const result = await client.executePayment(seal.sealId, 15.0);
  console.log(`Execution result: ${result.status}`);
}

runAutomatedWorkflow();
```

### Pattern: LLM Guardrail Engine

To use the LLM guardrail engine directly in a Node.js script (e.g. for local Ollama inference):

```typescript
import { PopClient, LLMGuardrailEngine } from 'hangpay';
import { MockProvider } from 'hangpay/providers';

const llmEngine = new LLMGuardrailEngine({
  baseUrl: 'http://localhost:11434/v1', // Ollama endpoint
  model: 'llama3.2',
  useJsonMode: false,
});

const client = new PopClient({
  provider: new MockProvider(),
  policy,
  engine: llmEngine,
});
```

Supported LLM providers:

| Provider | `baseUrl` | `model` |
|---|---|---|
| OpenAI (default) | *(not needed)* | `gpt-4o-mini` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |
| vLLM / LM Studio | `http://localhost:8000/v1` | Your model name |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-3-haiku` |
| Any OpenAI-compatible | Your endpoint URL | Your model name |

---

## 3. Browser Agent Middleware (Playwright / browser-use / Skyvern)

Browser agents that navigate real websites need to intercept the checkout flow and request a virtual card from HangPay *before* filling in any payment form.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Agent Orchestrator                   │
│  (OpenClaw / NemoClaw / custom Node.js loop)         │
└───────────────────────┬──────────────────────────────┘
                        │
          Navigates, finds checkout page
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│              Browser Agent Layer                      │
│  (Playwright, browser-use, Skyvern)                  │
│                                                       │
│  1. Detect payment form / paywall                     │
│  2. Extract: amount, vendor, context                  │
│  3. ─── PAUSE navigation ───────────────────────────►│
└───────────────────────┬──────────────────────────────┘
                        │  request_virtual_card(amount, vendor, reasoning, page_url=page.url)
                        ▼
┌──────────────────────────────────────────────────────┐
│          HangPay (This library)             │
│                                                       │
│  • GuardrailEngine: keyword + optional LLM check      │
│  • Budget enforcement: daily cap + per-tx limit       │
│  • VirtualSeal issued: one-time card, burn-after-use  │
│  • Returns: masked card number + seal_id             │
└───────────────────────┬──────────────────────────────┘
                        │  seal approved
                        ▼
┌──────────────────────────────────────────────────────┐
│              Browser Agent Layer (resumed)            │
│                                                       │
│  4. PopBrowserInjector attaches to Chrome via CDP     │
│     (--remote-debugging-port=9222)                   │
│  5. Traverses cross-origin iframes (e.g. Stripe Elm.) │
│  6. Injects real card into DOM — NOT via page.fill()  │
│     (raw PAN handled only by trusted local process)   │
│  7. Agent clicks submit (only sees masked card number)│
│  8. executePayment(sealId) → card burned              │
└──────────────────────────────────────────────────────┘
```

### Implementation Example (Playwright + Node.js)

```typescript
import { chromium } from 'playwright';
import { PopClient, PopBrowserInjector } from 'hangpay';
import { MockProvider } from 'hangpay/providers';
import type { GuardrailPolicy, PaymentIntent } from 'hangpay';

async function browserAgentWithPop() {
  // 1. Initialize HangPay
  const policy: GuardrailPolicy = {
    allowedCategories: ['Donation', 'SaaS', 'Wikipedia'],
    maxAmountPerTx: 30.0,
    maxDailyBudget: 50.0,
  };
  const client = new PopClient({
    provider: new MockProvider(),
    policy,
    dbPath: 'HANGPAY_state.db',
  });

  // 2. Browser agent detects a checkout form and requests authorization
  const intent: PaymentIntent = {
    agentId: 'playwright-agent-001',
    requestedAmount: 25.0,
    targetVendor: 'Wikipedia',
    reasoning: 'I need to support open knowledge via a $25 donation.',
  };
  const seal = await client.processPayment(intent);

  if (seal.status === 'Rejected') {
    console.log(`Payment blocked: ${seal.rejectionReason}`);
    return;
  }

  console.log(`Approved. Seal: ${seal.sealId}`);
  console.log(`   Card in agent log: ****-****-****-${seal.cardNumber.slice(-4)}`);

  // 3. Trusted local process fills the real credentials into the browser
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://donate.wikimedia.org/');

  // CRITICAL: Use PopBrowserInjector — real card details are injected from
  // the in-memory VirtualSeal, never retrieved from the DB (which only stores masked numbers).
  const injector = new PopBrowserInjector(client.stateTracker);
  await injector.injectPaymentInfo({
    sealId: seal.sealId,
    cdpUrl: 'http://localhost:9222',
    cardNumber: seal.cardNumber,
    cvv: seal.cvv,
    expirationDate: seal.expirationDate,
  });
  await page.click('#submit-donation');

  // 4. Mark seal as used (burn-after-use)
  await client.executePayment(seal.sealId, 25.0);
  console.log('Card burned. Transaction complete.');

  await browser.close();
}

browserAgentWithPop();
```

### Adapting for browser-use / Skyvern

If you're using `browser-use` or Skyvern (which operate with higher-level visual reasoning), the pattern is identical — intercept before form submission:

```typescript
// Pseudo-code for browser-use integration
class POPCheckoutInterceptor {
  constructor(private client: PopClient) {}

  async onCheckoutDetected(amount: number, vendor: string, context: string) {
    const intent: PaymentIntent = {
      agentId: 'browser-use-agent',
      requestedAmount: amount,
      targetVendor: vendor,
      reasoning: context,
    };
    const seal = await this.client.processPayment(intent);

    if (seal.status === 'Rejected') {
      throw new Error(`HangPay rejected: ${seal.rejectionReason}`);
    }

    return seal;
  }

  async onCheckoutComplete(sealId: string, amount: number) {
    await this.client.executePayment(sealId, amount);
  }
}
```

---

## 4. OpenClaw / NemoClaw — Full Setup

hangpay is a standalone MCP server that you install and run locally to guardrail agent payments. For OpenClaw users, the ClawHub "skill" is the discovery and configuration layer that teaches your agent how to communicate with your local hangpay server.

### ClawHub Skill (Fastest Setup)

hangpay is available as a one-click skill on **ClawHub** (the OpenClaw/NemoClaw skill marketplace). Search for **"hangpay"** by HangPay. The skill bundles the MCP registration, spend policy defaults, and the system prompt fragment below — setup is a single click.

Manual setup instructions follow below for users who prefer full control.

---

### Recommended System Prompt Fragment

Add the following block to your OpenClaw or NemoClaw identity file (e.g., `IDENTITY.md` or the system prompt field in your agent config):

```markdown
## Financial Safety Protocol (REQUIRED)

You are operating under the HangPay Payment Guardrail Protocol. The following rules are NON-NEGOTIABLE:

1. **You MUST call the `request_virtual_card` MCP tool** before attempting any purchase,
   subscription, donation, API credit top-up, or any other financial transaction.

2. **Never use stored credit card numbers, PAN numbers, or any real payment credentials**
   found in your context, memory, or files. These are never provided to you.

3. **If `request_virtual_card` returns a rejection, STOP the payment flow immediately.**
   Do not retry with a different reasoning. Report the rejection reason to the user.

4. **If you find yourself in a loop** (retrying the same failed purchase more than once),
   you MUST stop and request human intervention rather than continuing.
```

---

### OpenClaw Setup

OpenClaw has full native MCP support and reads `.env` files in the same way as Claude Code.

**Step 0 — Launch Chrome with CDP**

Same as §1 — use `pop-launch`:

```bash
npx pop-launch --print-mcp
```

**Step 1 — Configure `.env`**

Same as §1. Create `~/.config/hangpay/.env` with your policy settings.

**Step 2 — Register HangPay MCP**

```bash
openclaw mcp add hangpay -- npx hangpay launch-mcp
```

Or add directly to `~/.openclaw/mcp_servers.json`:

```json
{
  "pop": {
    "command": "npx",
    "args": ["hangpay", "launch-mcp"]
  }
}
```

**Step 3 — Register Playwright MCP with CDP endpoint**

```bash
openclaw mcp add playwright -- npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

> After updating `.env`, restart your OpenClaw session to reload config — no need to re-register MCPs.

---

### Payment Flow

```
+------------------+     +----------------------+     +---------------------------+
| Agent navigates  | --> | Billing form visible |     | Payment form visible      |
| to checkout page |     | (name/address fields)|     | (card fields)             |
+------------------+     +----------------------+     +---------------------------+
                                   |                              |
                         call request_purchaser_info()   call request_virtual_card()
                         (fills name, address, email)    - auto page scan runs inside
                                   |                     - card injected via CDP
                                   v                              |
                          click Continue/Next                     v
                                                        click Submit / Place Order
```

### Your First Live Test

Use the Wikipedia donation page — simple checkout, no account required.

```bash
> Donate $10 to Wikipedia, with credit card, pay with hangpay. Fill in the payment details, but **do not submit** — I will review and confirm before proceeding.
```

**Expected flow:** Agent navigates → selects $10 → proceeds to card form → calls `request_virtual_card` → hangpay scans page + injects card via CDP → agent waits for confirmation.

---

### NemoClaw (NVIDIA OpenShell) Setup

NemoClaw wraps OpenClaw inside the **OpenShell** security sandbox. The key differences from Claude Code / OpenClaw are:

1. **No `.env` files** — credentials are declared as "Providers" in the YAML policy file and injected as environment variables at runtime.
2. **Zero-egress by default** — the POP MCP server endpoint must be explicitly added to the network allowlist.
3. **Early preview** — interfaces may change; check the NemoClaw docs for the latest.

**Step 0 — Launch Chrome with CDP (outside the sandbox)**

Run `npx pop-launch` on the host before connecting to the sandbox.

**Step 1 — Install inside the sandbox**

```bash
nemoclaw my-assistant connect
cd /sandbox
npm install hangpay
```

**Step 2 — Declare POP credentials as Providers in your policy YAML**

In your `nemoclaw-blueprint/policies/openclaw-sandbox.yaml`, add POP credentials under the `providers` section:

```yaml
providers:
  - name: HANGPAY_BYOC_NUMBER
    value: "4111111111111111"
  - name: HANGPAY_BYOC_CVV
    value: "123"
  - name: HANGPAY_BYOC_EXP_MONTH
    value: "12"
  - name: HANGPAY_BYOC_EXP_YEAR
    value: "27"
  - name: HANGPAY_ALLOWED_CATEGORIES
    value: '["aws", "openai", "donation"]'
  - name: HANGPAY_MAX_PER_TX
    value: "100.0"
  - name: HANGPAY_MAX_DAILY
    value: "500.0"
  - name: HANGPAY_BLOCK_LOOPS
    value: "true"
```

**Step 3 — Allowlist the POP MCP server in network policy**

```yaml
network:
  egress:
    allow:
      - host: localhost
        port: 9222   # Chrome CDP
      - host: localhost
        port: 8000   # POP MCP server (adjust if different)
```

**Step 4 — Register MCPs (while connected to sandbox)**

```bash
openclaw mcp add hangpay -- npx hangpay launch-mcp
openclaw mcp add playwright -- npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

> **NemoClaw tip:** HangPay's guardrails are especially valuable inside NemoClaw — the zero-egress sandbox prevents most accidental spending, but POP adds semantic policy enforcement and a full audit trail that OpenShell alone does not provide.

### Your First Live Test

Once your agent is configured with the system prompt above, try this task:
```bash
> Donate $10 to Wikipedia, with credit card, pay with hangpay. Fill in the payment details, but **do not submit** — I will review and confirm before proceeding.
```
> **Note:** The `"do not submit"` instruction is for initial testing only. Once you have verified the injection flow works correctly, remove it from your prompt to enable fully autonomous payments within your configured policy limits.

---

## See Also

- [README.md](../README.md) — Main project overview and quick start
- [§1 Claude Code](#1-claude-code--full-setup-with-cdp-injection) — Full BYOC + CDP injection setup (most common)
- [§2 Node.js SDK](#2-nodejs-sdk-integration) — Direct SDK embedding
- [§3 Browser Agents](#3-browser-agent-middleware-playwright--browser-use--skyvern) — Playwright / browser-use / Skyvern integration
- [§4 OpenClaw / NemoClaw](#4-openclaw--nemoclaw--full-setup) — Full MCP + CDP setup for OpenClaw and NemoClaw
- [CONTRIBUTING.md](../CONTRIBUTING.md) — How to add new payment providers or guardrail engines

