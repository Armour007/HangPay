# Category I — Client-Path Bypass

**Vulnerability surface.** The MCP client sends structured intents whose
field values may be malformed in ways the server-side guard's parser does
not anticipate. Cat I seeds encode malformed-input primitives that target
input validation, length bounds, character classes, and field-injection
sinks.

Corpus: 29 attack payloads (`I-0001` through `I-0030`), 6 benign
counterparts.

---

## I.1 — Empty / whitespace-only / control-char vendor

**Mechanism.** Vendor field is empty, whitespace-only, or contains
non-printable control characters (`'   '`, `'\x00'`, tab/newline only).
A guard that trusts non-empty input or that strips control chars before
checking presence may approve.

**Variation surfaces.** Whitespace type (space / tab / newline / NBSP);
control-char codepoint; presence of trailing visible bytes.

**Sample payload IDs.** `I-0001`, `I-0006`, `I-0016`, `I-0021`, `I-0024`,
`I-0029`.

---

## I.2 — Length-bound abuse (max length / overlong / amount extremes)

**Mechanism.** Vendor or reasoning is filled to or beyond the schema's
max-length bound; amount is set to extremes (0.01 cent, 9_999_999.99).
Triggers off-by-one bugs in length-truncated comparisons and amount-cap
checks.

**Variation surfaces.** Field targeted (vendor / reasoning); padding char;
amount magnitude (huge / tiny).

**Sample payload IDs.** `I-0003`, `I-0007`, `I-0008`, `I-0009`, `I-0022`,
`I-0025`, `I-0026`, `I-0027`.

---

## I.3 — Path-traversal / URL injection in vendor

**Mechanism.** Vendor string contains path-traversal tokens
(`aws/../malware`) or a full URL embedded as the vendor name. Targets
guards that interpolate vendor into a filesystem or URL context.

**Variation surfaces.** Traversal sequence (`../`, `..\\`, encoded forms);
URL scheme injected (`http://`, `file://`).

**Sample payload IDs.** `I-0002`, `I-0014`, `I-0023`.

---

## I.4 — Code injection in vendor field

**Mechanism.** Vendor contains executable-looking content — `<script>`
tags, JSON object, JS expression — testing whether the guard interpolates
vendor into HTML, JSON, or eval contexts without escaping.

**Variation surfaces.** Injection language (script / JSON / SQL / shell);
length; payload.

**Sample payload IDs.** `I-0013`, `I-0015`, `I-0030`.

---

## I.5 — Unicode normalization / NFD–NFC / surrogate / bidi

**Mechanism.** Vendor string uses combining-form vs precomposed-form
mismatches (NFC vs NFD), unpaired surrogate halves, or bidirectional
override characters (`‮` reverses display order). Defeats
normalization-naive equality tests.

**Variation surfaces.** Normalization form (NFC / NFD / NFKD);
codepoint pair; presence of bidi or RTL override.

**Sample payload IDs.** `I-0010`, `I-0011`, `I-0017`, `I-0018`, `I-0028`.

---

## I.6 — Null-byte / trailing-null / tab smuggle

**Mechanism.** Vendor contains a null byte (`Stripe\x00Admin`) so that
C-string-style truncation gives "Stripe" while full-string comparison
gives the malicious form; or trailing-null / tab smuggle to defeat trim.

**Variation surfaces.** Truncating byte (`\x00`, `\t`, `\r`); position in
string; bytes after the null.

**Sample payload IDs.** `I-0004`, `I-0005`, `I-0020`.

