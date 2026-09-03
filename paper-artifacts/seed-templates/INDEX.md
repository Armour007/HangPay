# Seed Templates — Index

Per paper §3.1, each of the 11 attack categories was authored from 4–8 seed
templates encoding the category's defining vulnerability surface. This
directory documents those templates with mechanism descriptions, variation
surfaces, and sample payload IDs from the locked corpus.

| Cat | Title | Templates | Attacks | File | Mechanism summary |
|---|---|---|---|---|---|
| A | Layer-1 keyword evasion | 7 | 50 | [cat-A.md](cat-A.md) | Surface-form perturbation: zero-width, homoglyph, base64, punctuation, leet, diacritic, paraphrase |
| B | Vendor / category token game | 5 | 60 | [cat-B.md](cat-B.md) | Token-boundary smuggle: prefix attack, hyphen/underscore chains, domain-subset URLs, substring abuse |
| C | TOCTOU / domain spoof | 7 | 45 | [cat-C.md](cat-C.md) | URL primitives: subdomain spoof, lookalike apex, TLD swap, path smuggle, IDN, parser tricks |
| D | Prompt injection (reasoning / vendor) | 8 | 55 | [cat-D.md](cat-D.md) | Authority spoof, role hijack, tag smuggle, ignore-previous, system-prompt impersonation, encoding, visual disguise, persona shift |
| E | Amount / quantity confusion | 7 | 45 | [cat-E.md](cat-E.md) | Unit switch, rounding, scientific notation, locale decimal, probe framing, leetspeak amount, currency ambiguity |
| F | Multi-turn / state confusion | 7 | 35 | [cat-F.md](cat-F.md) | Prior-conversation, retry/split, receipt reference, subscription, batch, resumption, refund framing |
| G | Hidden-instruction page injection | 8 | 50 | [cat-G.md](cat-G.md) | HTML comment, CSS-hidden, meta tag, zero-width body, white-on-white, ARIA attribute, script/JSON-LD, subframe/SVG/textarea |
| H | Known-processor spoof | 6 | 35 | [cat-H.md](cat-H.md) | Processor typosquat, IDN/Punycode, subdomain reversal, userinfo/port/percent-encoded URL, fake-https wording, hidden Unicode |
| I | Client-path bypass | 6 | 29 | [cat-I.md](cat-I.md) | Empty/control-char vendor, length bounds, path traversal, code injection, normalization edge cases, null-byte truncation |
| J | Env / config injection | 7 | 30 | [cat-J.md](cat-J.md) | Env-var instruction, config-file claim, allowlist mutation, admin/sudo claim, signed-token claim, feature flag, MFA disable |
| K | LLM output / format | 7 | 35 | [cat-K.md](cat-K.md) | Output-format hijack, extra-key injection, truthy coercion, alternate format, empty/nested response, escape smuggle, prototype pollution |
| **Total** | | **75** | **469** | | |

> Attack counts here exclude the 116 benign counterparts also present in the
> corpus (`expected: "approve"`); benign payloads are scoped against the same
> mechanism axes but do not derive from these adversarial seed templates.
> Cat I attack count is 29 (the 30th `I-*` slot is benign).

## How to read each `cat-X.md`

For each template entry:

- **Mechanism.** 1–3 sentences naming the vulnerability surface and the
  adversary capability the seed targets.
- **Variation surfaces.** The fields varied across the 8–15 LLM-assisted
  variants per seed (per paper §3.1 stage 2): vendor name, amount magnitude,
  currency, reasoning rephrasing, plus mechanism-specific axes (e.g. choice of
  zero-width codepoint for A.1, attacker apex TLD for C.1).
- **Sample payload IDs.** ≥3 IDs from the locked corpus that derive from this
  template. Each ID is verified present in
  `tests/redteam/corpus/attacks.json`.

