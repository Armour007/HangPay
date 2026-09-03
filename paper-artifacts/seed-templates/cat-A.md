# Category A — Layer-1 Keyword Evasion

**Vulnerability surface.** Static keyword/regex filters used as a first-pass content
guard can be defeated by surface-form perturbations that preserve readability for an
LLM but break exact-match string detection. Cat A seeds encode the perturbation
classes a template-only filter must withstand: invisible characters, lookalike glyphs,
encoded payloads, and non-orthographic substitution.

Corpus: 50 attack payloads (`A-0001` through `A-0050`), 10 benign counterparts.

---

## A.1 — Zero-width / invisible-whitespace insertion

**Mechanism.** Zero-width joiners, zero-width spaces, and other invisible Unicode
whitespace are spliced into trigger keywords (e.g. `ig​nore previous`,
`f̲ailed a̲gain`). The visible glyph stream is unchanged for human/LLM readers
but exact `ignore previous` keyword filters miss the match.

**Variation surfaces.** Position of injected zero-width char (between any two
letters); choice of zero-width codepoint (U+200B, U+200C, U+200D, U+FEFF);
target keyword (ignore-previous, override, approve).

**Sample payload IDs.** `A-0001`, `A-0012`, `A-0042`, `A-0045`.

---

## A.2 — Unicode homoglyph substitution

**Mechanism.** Cyrillic / Greek / fullwidth lookalike glyphs replace one or more
ASCII letters in trigger keywords (`retrу` with Cyrillic 'у', `аpprove` with
Cyrillic 'а'). Visually identical to humans but fails byte-level keyword matching.

**Variation surfaces.** Which letters substituted (a, e, o, p, c are common
Cyrillic→Latin homoglyphs); target keyword; ratio of substituted to native chars.

**Sample payload IDs.** `A-0002`, `A-0010`, `A-0020`, `A-0030`, `A-0044`.

---

## A.3 — Base64 / encoded reasoning payload

**Mechanism.** The reasoning field carries the attack instruction inside a base64
(or other reversible encoding) blob, often with a hint phrase ("encoded reason").
A keyword filter that scans plaintext sees only opaque bytes; an LLM may decode
and act on the directive.

**Variation surfaces.** Encoding (base64, hex, ROT13, URL-encode); presence of
hint marker; cleartext fragment length surrounding the encoded blob.

**Sample payload IDs.** `A-0003` (and the encoded-payload subset of D-series:
`D-0008`, `D-0013` use the same surface mechanism applied to category D).

---

## A.4 — Punctuation insertion (s-y-s-t-e-m)

**Mechanism.** Hyphens, dots, or other punctuation are inserted between every
letter of a trigger keyword (`s-y-s-t-e-m o-v-e-r-r-i-d-e`,
`a.p.p.r.o.v.e`). Filters that key on whole-word `system override` miss; a
language model still reads the intended word.

**Variation surfaces.** Separator character (`-`, `.`, ` `, `*`); which keyword
is fragmented; whether punctuation is uniform or mixed.

**Sample payload IDs.** `A-0004`, `A-0005`, `A-0007`, `A-0011`, `A-0013`.

---

## A.5 — Leet-speak character substitution

**Mechanism.** ASCII digits and symbols replace visually similar letters
(`previ0us`, `0verride`, `appr0ve`). Defeats lowercased exact-match filters
without harming LLM comprehension.

**Variation surfaces.** Substitution map (0→o, 1→l/i, 3→e, 4→a, 5→s, 7→t);
target keyword; count of substitutions per word.

**Sample payload IDs.** `A-0008`, `A-0009`, `A-0028`, `A-0037`.

---

## A.6 — Diacritic / combining-mark insertion

**Mechanism.** Combining diacritical marks (U+0300..U+036F) are layered onto
ASCII letters of a trigger keyword (`f̲ailed`, `a̲pproved`). The base
character is preserved but the byte sequence differs; some filters use NFC-only
normalization which leaves combining-form variants unmatched.

**Variation surfaces.** Combining mark codepoint (underline, acute, grave,
macron); count of decorated letters; target keyword.

**Sample payload IDs.** `A-0014`, `A-0021`, `A-0050`.

---

## A.7 — Paraphrase / synonym substitution

**Mechanism.** The attack intent is preserved but the trigger keyword is
replaced with a synonym or paraphrase ("disregard the prior instructions" instead
of "ignore previous instructions"). Defeats keyword-list filters entirely.

**Variation surfaces.** Synonym choice; sentence construction; presence of
filler clauses.

**Sample payload IDs.** `A-0006`, `A-0033`.

