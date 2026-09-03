# Known Limitations (v0.5.8)

*Extracted from `docs/THREAT_MODEL.md` §5 — moved to internal-facing docs per CEO REVISE privacy path (2026-04-15). Public face is capability-forward; this document catalogs the honest limitation set for bounty researchers and internal planning.*

- **Anti-bot detection**: Sophisticated merchant anti-bot systems (e.g., Cloudflare, Akamai) can occasionally block CDP injection as "automated behavior."
- **No PCI DSS certification**: While card data never touches hangpay servers, the software is not currently certified for formal PCI compliance in regulated environments.
- **LLM guardrail accuracy**: The LLM-based intent verification is 95% accurate, not 100%; statistically, 1 false negative may occur in every 20 complex attack tests.
- **DOM Fragility**: CDP injection is dependent on the merchant's DOM structure; major layout changes can break the auto-fill logic.
- **Environment Requirements**: Requires an active Chrome/Chromium browser process with CDP enabled.
- **OSS Salt Visibility**: In open-source (non-compiled) builds, the encryption salt is visible in the source code, reducing entropy against local attackers. Install via npm for hardened builds.
- **Biometric primitives**: No native support for biometric approval (TouchID/FaceID) as a primary trust anchor yet.

