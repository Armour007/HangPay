# Security Policy

## Responsible Disclosure

At HangPay, we take the security of our runtime payment guardrails seriously. If you believe you have found a security vulnerability in `hangpay`, please report it to us as described below.

## Reporting a Vulnerability

Please do **not** report security vulnerabilities via public GitHub issues.

Two parallel channels (GitHub Advisory preferred, email also monitored):

1. **GitHub Security Advisory** *(preferred)*: [file privately here](https://github.com/akshay/hangpay/security/advisories/new).
2. **Email**: [security@hangpay.ai](mailto:security@hangpay.ai).

## Scope

### In-Scope
We are particularly interested in vulnerabilities related to the core security primitives of `hangpay`:
- **Vault Encryption**: Bypassing AES-256-GCM encryption or unauthorized access to `vault.enc`.
- **CDP Injection**: Vulnerabilities in the Chrome DevTools Protocol injection engine that could leak credentials to the agent process or unauthorized third parties.
- **Guardrail Bypass**: Systematic ways to bypass the Keyword or LLM guardrails (e.g., prompt injection that forces an unapproved purchase).
- **MCP Protocol**: Vulnerabilities in the Model Context Protocol implementation that could lead to privilege escalation.
- **TOCTOU Attacks**: Time-of-check to time-of-use vulnerabilities in domain verification.

### Out-of-Scope
- Vulnerabilities in the underlying browser (Chrome/Chromium).
- OS-level attacks (e.g., local root exploit to read memory).
- Social engineering or phishing.
- Theoretical vulnerabilities without a proof of concept.

## Bug Bounty Program

hangpay is currently running an internal red team hardening cycle before opening a public bounty. Researchers interested in coordinated disclosure:

- **Contact**: [security@hangpay.ai](mailto:security@hangpay.ai) (PGP key pending)
- **SLA**: Initial response within 72 hours
- **Disclosure**: 90-day coordinated disclosure default per CERT/CC

Public bounty tiers and a Hall of Fame will open after internal hardening completes. Private disclosure is welcome now — reach out and we will share scope guidance, the internal threat model, and red team methodology directly.

## Response Timeline

- **Acknowledgment**: Within 48 hours of receipt.
- **Triage**: Initial assessment and severity rating within 7 days.
- **Fix**: We aim to release a fix for critical vulnerabilities within 30 days.
- **Disclosure**: Public disclosure will occur after a fix is available and users have had time to update.

## Credit Policy

We value the work of security researchers. If you follow our disclosure policy, we will:
- Acknowledge your contribution in our security advisories and CHANGELOG.
- Respect your privacy if you wish to remain anonymous.
- Not pursue legal action against you for research conducted within the scope of this policy.

## Security Architecture

`hangpay` is designed with defense-in-depth:
- **Masking**: Card numbers are masked by default (`****-4242`).
- **Isolation**: The agent process never sees raw card credentials.
- **Native Security**: A Rust-based native layer (napi-rs) handles salt storage and key derivation.
- **Ephemeral Scope**: Approvals are single-use and domain-locked.

Thank you for helping keep the agentic commerce ecosystem safe.

