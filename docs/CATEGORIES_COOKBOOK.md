# HANGPAY_ALLOWED_CATEGORIES Cookbook

`HANGPAY_ALLOWED_CATEGORIES` is your agent's spending policy — set it once, and your agent
operates autonomously within it without asking for per-transaction approval.
This cookbook explains how matching works, common patterns, and the tradeoffs you need
to understand before choosing a configuration strategy.

---

## How Matching Works

When your agent calls `request_virtual_card` or `request_purchaser_info`, HangPay
runs two independent checks before approving any payment:

### Check 1 — Vendor Name Match (policy gate)

The agent-provided `target_vendor` string is matched against your `HANGPAY_ALLOWED_CATEGORIES`
list. **This is lexical (token-based), not semantic.** The system does not know that
"Maker Faire" is a type of "event" — you have to tell it.

Three sub-checks run in order, first match wins:

| Sub-check | Example | Passes? |
|---|---|---|
| Exact match | `"aws"` in `["aws"]` | Yes |
| Token match | `"AWS"` → token `"aws"` in `["aws"]` | Yes |
| Token-subset | `"Maker Faire Bay Area 2026"` tokens ⊇ `"Maker Faire"` tokens | Yes |

> **What does NOT work:** semantic labels like `"Event"` or `"SaaS"` will only match if
> those exact words appear in the vendor name the agent sends. `"Event"` does NOT match
> `"Maker Faire Bay Area 2026"` because "event" is not a token in that string.

### Check 2 — Domain Guard (TOCTOU)

After the policy gate passes, HangPay checks that the browser's current page domain
actually belongs to the approved vendor. This prevents a compromised or misdirected agent
from spending money on a lookalike site.

For **known vendors** (AWS, Cloudflare, GitHub, OpenAI, Stripe, Wikipedia, etc.),
strict domain suffix matching is used — `wikipedia.attacker.com` will never satisfy
vendor `"wikipedia"`.

For **unknown vendors**, a fallback runs: vendor name tokens are matched against domain labels,
including substring matching for compound names (e.g. `"maker"` found inside `"makerfaire.com"`).

---

## Pattern 1 — Specific Named Vendors (Recommended)

Add the brand's most recognizable token — the part that actually appears in its domain.

```env
HANGPAY_ALLOWED_CATEGORIES='["aws", "cloudflare", "openai", "github", "stripe", "Wikipedia", "Maker Faire", "PyCon"]'
```

**How to pick the right token:**

1. Find the vendor's official domain (e.g. `makerfaire.com`)
2. Extract the meaningful part, ignoring TLD: `makerfaire`
3. Pick the token from your intended vendor name that is a substring of that domain label: `Maker` ✓

**Worked examples:**

| You want to buy | Add to categories | Official domain | Why it works |
|---|---|---|---|
| Maker Faire Bay Area tickets | `"Maker Faire"` | `makerfaire.com` | "maker" ⊂ "makerfaire" |
| PyCon Taiwan registration | `"PyCon"` | `tw.pycon.org` | "pycon" = domain label |
| AWS compute | `"aws"` | `amazonaws.com` | Known vendor, strict match |
| Wikipedia donation | `"Wikipedia"` | `wikipedia.org` | Known vendor, strict match |
| Stripe Atlas | `"Stripe"` | `stripe.com` | Known vendor, strict match |
| DigitalOcean droplet | `"DigitalOcean"` | `digitalocean.com` | Known vendor, strict match |

---

## Pattern 2 — Semantic / Broad Categories (Use with Caution)

Semantic labels like `"Event"`, `"donation"`, or `"SaaS"` only work if the agent
passes that exact word as (part of) the `target_vendor` argument — which it typically
will not do for a real vendor name.

**When semantic labels DO work:**

`"donation"` works well in practice because agents often call:
```
target_vendor="Wikipedia donation"  →  token "donation" matches category "donation"
```

`"Event"` works only if the agent passes something like `target_vendor="Event ticket"`.
For real event names like `"Maker Faire Bay Area 2026"`, it does nothing.

**Implication:** Do not rely on broad labels to cover an entire class of vendors.
Use them only as a supplement for cases where the agent actually uses that word.

---

## Pattern 3 — Development / Permissive Mode

If you are testing and want to skip vendor restrictions temporarily, you can
set `HANGPAY_ALLOWED_CATEGORIES` very broadly and also disable the domain guard:

```env
HANGPAY_ALLOWED_CATEGORIES='["*"]'
HANGPAY_TOCTOU_DISABLED=true
```

> **Warning:** This removes both the policy gate and the domain binding.
> Your agent can spend on any vendor on any page. Only use this in a sandboxed
> test environment with a low `HANGPAY_MAX_PER_TX` limit.

---

## Real-World Config Examples

### Developer tooling setup
```env
HANGPAY_ALLOWED_CATEGORIES='["aws", "cloudflare", "github", "openai", "anthropic", "vercel", "netlify", "digitalocean"]'
HANGPAY_MAX_PER_TX=200.0
HANGPAY_MAX_DAILY=500.0
```

### Conference / event attendee agent
```env
HANGPAY_ALLOWED_CATEGORIES='["Maker Faire", "PyCon", "DEF CON", "Black Hat", "NeurIPS", "WWDC"]'
HANGPAY_MAX_PER_TX=500.0
HANGPAY_MAX_DAILY=1000.0
```

### Donation / philanthropy agent
```env
HANGPAY_ALLOWED_CATEGORIES='["Wikipedia", "Wikimedia", "donation", "Internet Archive", "EFF"]'
HANGPAY_MAX_PER_TX=50.0
HANGPAY_MAX_DAILY=100.0
```

### Mixed personal agent
```env
HANGPAY_ALLOWED_CATEGORIES='["aws", "cloudflare", "openai", "github", "donation", "Wikipedia", "Wikimedia", "Maker Faire", "Event"]'
HANGPAY_MAX_PER_TX=100.0
HANGPAY_MAX_DAILY=500.0
```

---

## Third-Party Payment Processors

Many vendors outsource their checkout to a third-party payment processor.
When this happens, the final payment page domain will not match the vendor's own domain —
which would normally trigger a TOCTOU block.

hangpay ships with a built-in allowlist of known-safe processors. If a checkout page
redirects to any of these domains, the domain guard passes automatically (the vendor
intent was already verified by the policy gate):

| Processor | Domain | Used by |
|---|---|---|
| Stripe | `stripe.com` | Countless SaaS, e-commerce |
| Stripe Elements | `js.stripe.com` | Embedded card forms |
| Zoho Payments | `zohosecurepay.com` | Maker Faire, Zoho Commerce merchants |
| Square | `squareup.com`, `square.com` | Retail, events |
| PayPal | `paypal.com` | General |
| Braintree | `braintreegateway.com` | PayPal subsidiary |
| Adyen | `adyen.com` | Enterprise e-commerce |
| Checkout.com | `checkout.com` | Enterprise |
| Paddle | `paddle.com` | SaaS subscriptions |
| FastSpring | `fastspring.com` | Software / digital goods |
| Gumroad | `gumroad.com` | Creators, digital products |
| Recurly | `recurly.com` | Subscription billing |
| Chargebee | `chargebee.com` | Subscription billing |
| Eventbrite | `eventbrite.com` | Events & ticketing |
| Tito | `ti.to` | Tech conferences (RailsConf, etc.) |
| Luma | `lu.ma` | Tech meetups & events |
| Universe | `universe.com` | Ticketing |
| 2Checkout | `2checkout.com` | Software & digital |
| Authorize.net | `authorize.net` | Hosted payment forms |

If your vendor uses a processor not on this list, add it to your `.env`:

```env
HANGPAY_ALLOWED_PAYMENT_PROCESSORS='["checkout.mybank.com", "pay.myprocessor.io"]'
```

> **Want to add a processor to the built-in list?**
> Open a PR at `github.com/akshay/hangpay` — include the processor name,
> domain, and one or two example vendors that use it.

---

## Known Limitations

**Semantic categories are not supported without LLM guardrails.**
The default `keyword` engine cannot infer that "Maker Faire" is an "Event".
If you need true semantic category enforcement (e.g. "approve any ticket purchase under $200"),
enable the LLM guardrail engine:

```env
HANGPAY_GUARDRAIL_ENGINE=llm
HANGPAY_LLM_API_KEY=sk-...
```

With the LLM engine enabled, the `HANGPAY_ALLOWED_CATEGORIES` list still acts as a fast
pre-filter, but the LLM layer can apply semantic reasoning for edge cases.

**Multi-word categories require all tokens to appear in the vendor name.**
`"Maker Faire"` matches `"Maker Faire Bay Area 2026"` (both tokens present).
`"San Francisco Event"` would require all three tokens — likely too specific to be useful.
Prefer the shortest unambiguous name fragment: `"Maker Faire"` not `"Maker Faire Bay Area"`.

**Adding a vendor does not guarantee injection will succeed.**
The domain guard is a second, independent layer. Even if your category list matches,
injection will be blocked if the current page domain does not correspond to the approved vendor.
This is intentional — it protects against prompt injection attacks that redirect your agent
to a lookalike checkout page.

---

## Quick Diagnostic

If a payment is blocked unexpectedly, check which layer rejected it:

1. **Policy gate rejected** → your `HANGPAY_ALLOWED_CATEGORIES` does not match the vendor name
   the agent passed. Fix: add a token that appears in both the vendor name and the domain.

2. **Domain guard rejected** → the page domain did not match the approved vendor.
   Fix: make sure the agent passes `page_url` to the tool, and confirm the official domain
   contains one of your category tokens as a substring.

3. **Budget rejected** → `HANGPAY_MAX_PER_TX` or `HANGPAY_MAX_DAILY` exceeded.
   Fix: raise the limit in `~/.config/hangpay/.env` and restart the MCP server.

