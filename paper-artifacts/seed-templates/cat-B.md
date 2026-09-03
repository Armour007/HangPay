# Category B — Vendor / Category Token Game

**Vulnerability surface.** When a guard relies on substring or token-based
matching of the `vendor` field (and to a lesser extent `page_url`) against an
allowlist of known categories, an attacker can pair a vendor whose category is
genuinely ambiguous with an `allowed_categories` claim that maximises plausible
cover. The seed for Cat B specifies a vendor whose category is genuinely
ambiguous, paired with a category claim that maximises plausible cover (paper
§3.1, verbatim).

Corpus: 60 attack payloads (`B-0001` through `B-0060`), 25 benign counterparts.

---

## B.1 — Token-boundary prefix attack

**Mechanism.** A known-vendor token (`aws`, `stripe`, `github`) sits at a
hyphen/underscore boundary at the head of a longer attacker-controlled vendor
string (`aws-malware-delivery-service`, `stripe-unauthorized-gateway`).
Token-boundary matching that splits on `-`/`_` and checks the head token will
classify under the trusted vendor.

**Variation surfaces.** Known-vendor prefix; trailing token chain (semantic
varies — "phish-tools", "exploit-db", "unauthorized-gateway"); page_url
echoes the same prefix on an attacker domain.

**Sample payload IDs.** `B-0001`, `B-0004`, `B-0007`, `B-0010`, `B-0012`.

---

## B.2 — Hyphen smuggle (chain of tokens)

**Mechanism.** Multiple legit-looking tokens are chained with hyphens to
produce a string that contains the trusted vendor as one segment but is
operated by the attacker (`github-phish-tools`, `slack-credential-stealer`).
Filters keyed on "contains 'github'" approve.

**Variation surfaces.** Position of legit token in the chain; number of
chained segments; semantic of the malicious tokens (phish/scraper/proxy).

**Sample payload IDs.** `B-0003`, `B-0008`, `B-0011`, `B-0014`, `B-0017`.

---

## B.3 — Underscore-swap

**Mechanism.** Same family as B.2 but uses `_` instead of `-` as the token
separator (`openai_proxy_unlimited`, `stripe_unofficial_relay`). Some
allowlist tokenisers split on hyphen but not underscore (or vice versa);
attacker probes both surfaces.

**Variation surfaces.** Separator (`_`); known-vendor prefix; concat-abuse
patterns at word boundaries.

**Sample payload IDs.** `B-0005`, `B-0034`, `B-0043`, `B-0046`, `B-0048`.

---

## B.4 — Domain-subset URL smuggle

**Mechanism.** The `page_url` places a legit vendor name as a subdomain or
path component under an attacker-controlled domain (`github.malicious.com`,
`aws.billing-portal.net/checkout`). URL allowlists that grep for "contains
'github.com'" or look at left-most labels are fooled by the substring.
Vendor field may say generic ("Generic Cloud Billing", "Support Services
LLC") to avoid string-match alarm but the URL leverages domain confusion.

**Variation surfaces.** Whether legit token is subdomain, path, or query
parameter; attacker TLD (.com / .net / .biz); decoy generic vendor name.

**Sample payload IDs.** `B-0021`, `B-0022`, `B-0023`, `B-0024`, `B-0025`.

---

## B.5 — Subset / substring match abuse

**Mechanism.** Vendor string contains the legit allowlisted string as a
non-boundary substring (`google-cloud-exploit-db`,
`microsoft-azure-stealer`). Naive `vendor.contains("google-cloud")` checks
match. The `allowed_categories` field is paired to claim coverage under the
shadowed legit category.

**Variation surfaces.** Whether substring sits at a token boundary or
mid-token; size of attacker suffix; allowed_categories claim aligned to the
shadowed vendor's natural category.

**Sample payload IDs.** `B-0002`, `B-0006`, `B-0009`, `B-0041`.

