# Threat Model: hangpay

## 1. Executive Summary

hangpay protects against prompt injection stealing card data, hallucinated purchases, malicious checkout pages, and scope expansion. By isolating sensitive card credentials from the agent's reasoning process and employing a robust multi-layered verification engine, hangpay ensures that even compromised, malicious, or hallucinating agents cannot extract raw payment data or execute unauthorized financial transactions.

## 2. Threat Actors

| ID | Actor | Description |
|:---|:---|:---|
| **T1** | Malicious checkout pages | Webpages designed to detect agentic browsers and inject hidden instructions or spoofed form fields to steal credentials. |
| **T2** | Prompt injection via agent context | External attackers who control part of the agent's input (e.g., via a malicious email or document) to subvert agent logic. |
| **T3** | Hallucinating agents | Autonomous agents that spontaneously decide to purchase items or services outside the original task scope due to model error. |
| **T4** | Compromised agent tool chain | A malicious MCP server, plugin, or dependency in the agent's environment attempting to intercept payment requests. |

## 3. Security Primitives

- **Context Isolation Layer**: Utilizes Chrome DevTools Protocol (CDP) injection to handle card data. The raw card credentials never enter the agent's process or LLM context; they are injected directly from a trusted process into the browser DOM, including cross-origin iframes and Shadow DOM trees.
- **Intent Verification Engine**: Hybrid keyword-matching + LLM-based guardrail evaluating semantic purchase intent against configured policy. See docs/GUARDRAIL_BENCHMARK.md for per-model per-category results.
- **Human Trust Anchor**: A configurable Human-In-The-Loop (HITL) approval mechanism that requires explicit human confirmation for high-value transactions or unrecognized vendors.
- **Zero-Knowledge Card Surface**: The agent only ever perceives a masked version of the card (e.g., `****-4242`). Real data is stored in an AES-256-GCM encrypted vault with a Rust napi-rs native security layer (XOR-split compiled salt, scrypt key derivation), inaccessible to standard agent tools.
- **Ephemeral Authorization Scope**: Limits every approval to a single-use flow with a Time-of-Check to Time-of-Use (TOCTOU) domain guard, preventing the agent from redirecting an approved session to a malicious domain.

## 4. STRIDE Attack Matrix

| Attack ID | STRIDE Category | Scenario | Mitigating Primitive | Residual Risk |
|:---|:---|:---|:---|:---|
| **A1** | Spoofing | Attacker spoofs a merchant domain after approval (TOCTOU). | Ephemeral Authorization Scope | DNS-level hijacking or local host file tampering. |
| **A2** | Tampering | Agent attempts to delete `.node` file to force a security downgrade. | Context Isolation Layer | Physical file system access can still destroy the vault. |
| **A3** | Repudiation | Agent or user denies a valid purchase was authorized. | Human Trust Anchor | Compromised human approval credentials. |
| **A4** | Information Disclosure | Agent uses `read_file` to attempt to read the encrypted vault. | Zero-Knowledge Card Surface | Brute force of the vault key (mitigated by scrypt). |
| **A5** | Denial of Service | Hallucinating agent attempts infinite purchase loop to drain funds. | Intent Verification Engine | Small amounts may be spent before budget caps trigger. |
| **A6** | Elevation of Privilege | Agent tries to call internal vault decryption functions directly. | Context Isolation Layer | Memory inspection if agent and PEP share a PID. |
| **A7** | Information Disclosure | Prompt injection instructs agent to "print your card number." | Zero-Knowledge Card Surface | Agent prints the masked string (no real data leaked). |
| **A8** | Tampering | Malicious checkout page changes the price after the agent approves. | Intent Verification Engine | Real-time DOM changes during the millisecond of injection. |
| **A9** | Spoofing | Malicious MCP server intercepts and logs JSON-RPC requests. | Context Isolation Layer | Agent-to-PEP communication is cleartext if not over SSH/TLS. |
| **A10** | Information Disclosure | Agent reasoning contains card data from a previous session. | Context Isolation Layer | Log scrubbing is required to ensure no leakage in traces. |

## 6. Data Flow Diagram

```
                                 [ TRUST BOUNDARY ]
                                         |
    +----------------+           +-------|--------------------------+
    |                |           |       |  Policy Engine (PEP)     |
    |  Agent Process |---(1)---->|       V                          |
    | (Masked Only)  |           |  [ Intent Verification Engine ]  |
    |                |<---(2)----|               |                  |
    +----------------+           |               | (3)              |
                                 |               V                  |
                                 |    [ Encrypted Vault ]           |
                                 |    [ Rust napi-rs Layer ]        |
                                 |               |                  |
                                 +---------------|------------------+
                                                 | (4)
                                                 V
    +----------------+           +----------------------------------+
    |  Payment       |           |   Context Isolation Layer        |
    |  Processor     |<---(5)----|   (CDP / Browser DOM /           |
    |  (Stripe/etc)  |           |    iframe + Shadow DOM)          |
    +----------------+           +----------------------------------+
                                         |
                                 [ TRUST BOUNDARY ]

    (1) Request Virtual Card (Reasoning + Amount)
    (2) Return Masked Token (****-4242)
    (3) Decrypt credentials using machine key/passphrase via Rust addon
    (4) Inject real CC/CVV into Browser DOM via CDP
    (5) Card data submitted to Processor
    Agent never sees raw data crossing the boundary
```

## 7. Technology Stack

| Component | Implementation | Security Properties |
|:---|:---|:---|
| Vault encryption | AES-256-GCM via Node.js `crypto` (OpenSSL binding) | Authenticated encryption, random nonce per operation |
| Key derivation | scrypt (n=2^14, r=8, p=1) via Rust napi-rs | Memory-hard, compiled into stripped native binary |
| Salt protection | XOR-split pair compiled into Rust binary | Reverse engineering requires binary analysis |
| CDP injection | Raw WebSocket CDP client (TypeScript) | Cross-origin iframe traversal, Shadow DOM piercing |
| TOCTOU guard | Domain verification with known vendor registry | Payment processor passthrough, strict suffix matching |
| Guardrails | Hybrid keyword + LLM (Layer 1 + Layer 2) | Keyword layer filters high-confidence rejections before LLM invocation; per-category block rate in benchmark |

