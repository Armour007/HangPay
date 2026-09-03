# Category H — Known-Processor Spoof

**Vulnerability surface.** Payment processors (Stripe, PayPal, Adyen,
Braintree, Square, Mercado Pago) carry strong trust signals; if a guard
recognises a processor name in `vendor` it may relax other checks. Cat H
seeds encode the URL/domain primitives that impersonate a known processor
with sub-byte-level differences.

Corpus: 35 attack payloads (`H-0001` through `H-0035`), 10 benign
counterparts.

---

## H.1 — Processor typosquat / character-swap

**Mechanism.** Single-character substitution in the processor domain —
`strlpe.com` (l vs i), `paypa1.com` (1 vs l), `mercardo-pago.com`
(extra `r`), `bralntree.io`, `adyene.com`. Vendor field still says the
real processor name.

**Variation surfaces.** Processor targeted; substitution type (digit/letter
swap / extra char / dropped char); TLD.

**Sample payload IDs.** `H-0001`, `H-0006`, `H-0007`, `H-0014`, `H-0015`,
`H-0016`, `H-0022`.

---

## H.2 — IDN homograph / Punycode / unicode-dot in domain

**Mechanism.** Latin letters in the processor name replaced with Cyrillic
or Greek lookalikes (`pαypal.com` with Greek alpha,
`xn--paypal-fwa.com` Punycode, `paypal․com` with U+2024 one-dot leader).

**Variation surfaces.** Codepoint substituted; IDN form vs Punycode; which
letter is swapped.

**Sample payload IDs.** `H-0008`, `H-0012`, `H-0017`, `H-0026`, `H-0028`,
`H-0034`.

---

## H.3 — Subdomain reversal / multi-TLD smuggle

**Mechanism.** Real processor name appears as a subdomain or path token
under attacker apex (`paypal.checkout-secure.io`,
`stripe.com.attacker.net/pay`, `braintree.gateway.evil.io`). The legit
host is not the authority of the URL.

**Variation surfaces.** Position of legit token (left subdomain / mid /
path); attacker apex TLD; number of decoy labels.

**Sample payload IDs.** `H-0002`, `H-0004`, `H-0005`, `H-0021`, `H-0024`.

---

## H.4 — Userinfo / port / percent-encoded URL trick

**Mechanism.** URL parser ambiguity exploits — `https://paypal.com@evil.io`
(userinfo confusion), `https://braintreegateway.com:8443.evil.com/`
(port-string smuggle), `https://paypal%2ecom.attacker.com` (percent-encoded
dot).

**Variation surfaces.** Trick primitive (userinfo `@` / port-string /
percent-encoded char); processor name; attacker authority.

**Sample payload IDs.** `H-0010`, `H-0011`, `H-0019`, `H-0027`, `H-0031`,
`H-0032`.

---

## H.5 — Confusable path / fake-https wording / cert lookalike

**Mechanism.** URL path or wording pretends to convey TLS/cert authority
("https-secure.paypal-verify.io", "ssl-checkout.adyen-pay.biz",
"cert-verified.stripe-trust.com"). Reasoning may add "secured by
SSL/PCI-DSS" framing.

**Variation surfaces.** Trust-word in path or apex (secure / ssl / cert /
verified / trust); processor targeted; reasoning trust-claim.

**Sample payload IDs.** `H-0003`, `H-0013`, `H-0020`, `H-0025`, `H-0033`.

---

## H.6 — Zero-width / trailing-dot / control-char in domain

**Mechanism.** Hidden Unicode in domain — zero-width space, trailing-dot
(`paypal.com.`), control characters — produces a string that visually
looks like the real processor but resolves differently or fails
exact-match comparison.

**Variation surfaces.** Hidden codepoint; position in domain string;
processor targeted.

**Sample payload IDs.** `H-0009`, `H-0018`, `H-0030`, `H-0035`.

