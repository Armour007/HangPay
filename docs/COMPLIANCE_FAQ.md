# Enterprise Compliance FAQ: hangpay

This document provides a detailed overview of the compliance, security, and data privacy architecture for hangpay, the open-source AI agent commerce runtime security layer.

## 1. PCI DSS Scope

**Is hangpay in scope for PCI DSS?**

No. hangpay is a local developer tool and runtime security layer, not a Software-as-a-Service (SaaS) or payment processor. By architecture, hangpay ensures that sensitive cardholder data (CHD) never enters hangpay infrastructure or any external API.

**Data Flow Architecture:**
Card data flows from a local encrypted vault → Policy Enforcement Point (PEP) RAM (ephemeral) → Context Isolation Layer injection into the browser DOM → Payment Processor.

Because the data is handled entirely within the user's local environment or the specific merchant's payment iframe via the Context Isolation Layer, hangpay does not store, process, or transmit cardholder data on its own servers. Using hangpay helps organizations maintain a smaller PCI DSS footprint by keeping agentic commerce operations localized and isolated.

## 2. Data Flow Diagram

```text
[ USER LOCAL ENVIRONMENT ]                  [ EXTERNAL ]
+------------------------------------------+               
|  1. Local Storage                        |               
|  [ Encrypted Vault (System Keychain) ]   |               
+--------|---------------------------------+               
         | (Encrypted Stream)                              
+--------v---------------------------------+               
|  2. Policy Enforcement Point (PEP)       |               
|  [ Intent Verification Engine ]          |               
|  [ Human Trust Anchor ] <----------------|--- [ User Approval ]
|  (Ephemeral RAM Only)                    |               
+--------|---------------------------------+               
         | (Secure JSON-RPC)                               
+--------v---------------------------------+      +-----------------------+
|  3. Context Isolation Layer              |      |                       |
|  [ CDP Injection / Zero-Knowledge Surface]|------> [ Payment Processor ] |
|  (Cross-Origin Iframe Targeting)         |      | (Stripe, Adyen, etc.) |
+------------------------------------------+      +-----------------------+
| <---------- PCI BOUNDARY (Local) ------> |      | <--- PCI SCOPE (Ext)  |
+------------------------------------------+      +-----------------------+
```

## 3. Credential Isolation Model

hangpay employs a multi-layered isolation strategy to protect sensitive financial credentials during agentic workflows.

### Layer 1: Storage Isolation
*   **Mechanism:** AES-256-GCM encrypted vault.
*   **Key Derivation:** Rust (napi-rs) native layer with scrypt KDF and XOR-split salt storage.
*   **Integration:** Integration with the OS system keychain ensures that the master encryption key is never stored in plaintext on disk.

### Layer 2: Runtime Isolation
*   **Mechanism:** Policy Enforcement Point (PEP).
*   **Boundary:** The PEP operates as a separate process (MCP server launched via `npx hangpay launch-mcp`) via the MCP JSON-RPC protocol. Card data resides in this process's ephemeral memory only for the duration of an **Ephemeral Authorization Scope**.
*   **Protection:** Even if the primary AI agent process is compromised, it does not have direct memory access to the PEP's raw credential store.

### Layer 3: Transport Isolation
*   **Mechanism:** Context Isolation Layer.
*   **Injection:** Credentials are injected directly into cross-origin iframes using the Chrome DevTools Protocol (CDP).
*   **Zero-Knowledge Card Surface:** This ensures that the parent page (which might be controlled by an untrusted agent or script) cannot programmatically scrape the card details, as they are isolated by the browser's Same-Origin Policy (SOP).

## 4. SOC 2 Roadmap

hangpay is currently an open-source project. While we do not currently hold a SOC 2 attestation, we are committed to a phased compliance roadmap.

*   **Phase 0 (Current):** Open-source codebase available for independent audit. Security penetration testing results available to enterprise partners upon request.
*   **Phase 1 (Post-Funding/Scale):** Formal SOC 2 Gap Assessment and implementation of formal internal controls.
*   **Phase 2 (6-9 Months):** Achievement of SOC 2 Type I Attestation (Design of Controls).
*   **Phase 3 (12-18 Months):** Achievement of SOC 2 Type II Attestation (Operating Effectiveness).

## 5. GDPR & CCPA Note

**Privacy by Design:**
hangpay is built on a "local-first" philosophy.
*   **Local Processing:** All data processing occurs on the user's machine.
*   **Zero Telemetry:** No usage data, card information, or PII is sent to hangpay servers or third-party analytics.
*   **Data Control:** The user is the sole Data Controller.
*   **Right to Erasure:** Users can exercise their "right to be forgotten" instantly by deleting their local vault file and keychain entries.

## 6. Certifications Summary Table

| Framework | Status | Notes |
| :--- | :--- | :--- |
| **PCI DSS** | N/A | CHD never enters hangpay infrastructure. |
| **SOC 2 Type I** | Planned | Phase 2 of compliance roadmap. |
| **SOC 2 Type II** | Planned | Phase 3 of compliance roadmap. |
| **GDPR/CCPA** | Compliant | Compliant by architecture (Local-only, no telemetry). |
| **OSS Audit** | Available | MIT licensed codebase available for public inspection. |
| **Penetration Test** | On Request | Available for enterprise evaluation. |

## 7. Known Limitations

While hangpay provides robust security, users should be aware of the following architectural trade-offs:

*   **Host Security:** A compromised host (same-user shell) could potentially access the vault file. This is mitigated but not eliminated by OS keychain integration.
*   **Post-Injection DOM Access:** Once credentials are injected into a DOM element, JavaScript running within *that specific iframe* can technically read the values. We rely on the **Intent Verification Engine** to ensure the target site is a trusted processor.
*   **OSS Transparency:** As an open-source project, vault encryption logic and salts (if applicable) are visible in the source code. Security relies on the strength of the user's passphrase and the Rust (napi-rs) native key derivation.
*   **Hardware Security:** hangpay currently lacks native Hardware Security Module (HSM) or Secure Enclave integration for the primary vault (planned for future releases).

