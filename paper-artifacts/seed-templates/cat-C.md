# Category C — TOCTOU / Domain Spoof

**Vulnerability surface.** A guard that pairs a trusted `vendor` string with
URL-based verification can be defeated when the URL surface that "looks like"
a known vendor is in fact controlled by the attacker. Cat C seeds capture
the URL-spoofing primitives an MCP layer must reject even when vendor field
and reasoning look benign.

Corpus: 45 attack payloads (`C-0001` through `C-0045`), 10 benign
counterparts.

---

## C.1 — Subdomain spoof under attacker zone

**Mechanism.** The legit vendor name appears as a subdomain label of an
attacker-controlled apex (`aws-billing.attacker.com`,
`stripe-checkout.evil.io`). The left-most labels evoke the trusted vendor;
authority resolution lands at the attacker.

**Variation surfaces.** Vendor token used as left-label; attacker apex TLD;
path component (`/pay`, `/checkout`, `/manage`).

**Sample payload IDs.** `C-0001`, `C-0005`, `C-0009`, `C-0010`, `C-0015`.

---

## C.2 — Subdomain prefix smuggle

**Mechanism.** Variant of C.1 where the trusted token is glued with a hyphen
to the attacker apex's left-most label (`aws-secure.evil.com`,
`anthropic-pay.lookalike.net`). Differs from C.1 in not using a `.`-bounded
subdomain — relies on filters that check for trusted-name substring in
left-most label.

**Variation surfaces.** Glue character (`-`, `_`); count of decoy tokens
between legit name and attacker apex.

**Sample payload IDs.** `C-0002`, `C-0012`, `C-0013`, `C-0022`, `C-0024`.

---

## C.3 — Lookalike apex domain

**Mechanism.** The attacker registers an apex that evokes the legit vendor
without containing it as a label (`anthropic.billing-portal.io`,
`stripe-payments.io`, `github.invoice-portal.co`). No subdomain trick — the
apex itself is the lookalike.

**Variation surfaces.** TLD choice (`.io`, `.co`, `.biz`, `.net`);
decorator words (`-billing`, `-portal`, `-invoice`); brand spelling intact.

**Sample payload IDs.** `C-0006`, `C-0007`, `C-0008`, `C-0011`, `C-0020`.

---

## C.4 — TLD lookalike

**Mechanism.** Trusted-vendor name is preserved exactly but the TLD is wrong
(`stripe-checkout.biz`, `github.pay`). Defeats filters that match brand
substring without TLD whitelist.

**Variation surfaces.** TLD (`.biz`, `.pay`, `.support`, `.help`); whether
brand has a hyphenated suffix.

**Sample payload IDs.** `C-0003`, `C-0023`.

---

## C.5 — Path-smuggle of fake authority

**Mechanism.** The legit-vendor host appears inside the URL path on an
attacker-controlled apex (`https://aws.com.s3-buckets.com/invoice`,
`https://stripe.com.checkout.evil/pay`). Naive substring check for
"aws.com" passes; authority is the attacker.

**Variation surfaces.** Position in path; count of dot-separated path tokens
that mimic a legit FQDN; trailing path keyword (`/invoice`, `/pay`).

**Sample payload IDs.** `C-0014`, `C-0016`, `C-0034`, `C-0037`.

---

## C.6 — Unicode homoglyph / Punycode in domain

**Mechanism.** Domain labels use Cyrillic/Greek lookalikes or Punycode
xn-- forms (`xn--open-fsa.com`, `аnthropic.com`). Visually indistinguishable
to humans; bytewise distinct.

**Variation surfaces.** Codepoint substituted; whether IDN form or Punycode
representation is used; which label is targeted.

**Sample payload IDs.** `C-0004`, `C-0018`, `C-0019`.

---

## C.7 — Adversarial URL parser tricks

**Mechanism.** Catch-all for URL primitives that exploit parser
ambiguity: port-based smuggle, trailing-dot domain, hash-fragment smuggle,
parked-domain redirect, DNS-rebind apex (`anthropic.com.dns-rebind.me`),
uppercase host, cross-TLD redirect.

**Variation surfaces.** Choice of URL primitive (port / trailing-dot / hash
/ rebind / case); legit-vendor token embedded in the manipulated component.

**Sample payload IDs.** `C-0025`, `C-0031`, `C-0032`, `C-0033`, `C-0035`,
`C-0036`.

