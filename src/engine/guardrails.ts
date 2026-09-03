import type { PaymentIntent, GuardrailPolicy } from "../core/models.js";

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[\s\-_./]+/).filter(Boolean));
}

export function matchVendor(
  vendorName: string,
  allowedCategories: string[],
  pageDomain: string = ""
): boolean {
  const vendorLower = vendorName.toLowerCase();
  const vendorTokens = tokenize(vendorName);
  const allowedLower = allowedCategories.map((c) => c.toLowerCase());
  const pageDomainTokens = pageDomain
    ? new Set(
        pageDomain
          .toLowerCase()
          .replace(/^www\./, "")
          .split(/[\s\-_./]+/)
          .filter((tok) => tok && tok.length >= 4)
      )
    : new Set<string>();

  // Exact match
  if (allowedLower.includes(vendorLower)) return true;

  // Token-in-allowed
  for (const tok of vendorTokens) {
    if (allowedLower.includes(tok)) return true;
  }

  // Allowed-subset-of-vendor
  for (const cat of allowedLower) {
    const catTokens = tokenize(cat);
    catTokens.delete("");
    if (catTokens.size > 0 && [...catTokens].every((t) => vendorTokens.has(t))) return true;
  }

  // Page domain match
  if (pageDomain) {
    for (const cat of allowedLower) {
      const catTokens = tokenize(cat);
      catTokens.delete("");
      if (catTokens.size > 0 && [...catTokens].every((t) => pageDomainTokens.has(t))) return true;
    }
  }

  return false;
}

const KNOWN_VENDOR_DOMAINS: Record<string, string[]> = {
  aws: ["amazonaws.com", "aws.amazon.com"],
  amazon: ["amazon.com", "amazon.co.uk", "amazon.co.jp"],
  github: ["github.com"],
  cloudflare: ["cloudflare.com"],
  openai: ["openai.com", "platform.openai.com"],
  stripe: ["stripe.com", "dashboard.stripe.com"],
  anthropic: ["anthropic.com", "claude.ai"],
  google: ["google.com", "cloud.google.com", "console.cloud.google.com"],
  microsoft: ["microsoft.com", "azure.microsoft.com", "portal.azure.com"],
  wikipedia: ["wikipedia.org", "wikimedia.org", "donate.wikimedia.org"],
  digitalocean: ["digitalocean.com", "cloud.digitalocean.com"],
  heroku: ["heroku.com", "dashboard.heroku.com"],
  vercel: ["vercel.com", "app.vercel.com"],
  netlify: ["netlify.com", "app.netlify.com"],
};

export class GuardrailEngine {
  async evaluateIntent(
    intent: PaymentIntent,
    policy: GuardrailPolicy
  ): Promise<[boolean, string]> {
    // Rule 1: Vendor/Category check
    if (!matchVendor(intent.targetVendor, policy.allowedCategories)) {
      return [false, "Vendor not in allowed categories"];
    }

    // Rule 2: Hallucination/Loop detection
    if (policy.blockHallucinationLoops) {
      const reasoningLower = intent.reasoning.normalize("NFKC").toLowerCase();
      const loopKeywords = ["retry", "failed again", "loop", "ignore previous", "stuck"];
      for (const kw of loopKeywords) {
        if (reasoningLower.includes(kw)) {
          return [false, "Hallucination or infinite loop detected in reasoning"];
        }
      }

      // Rule 3: Injection pattern detection
      const injectionPatterns = [
        /\{.*".*".*:/,
        /\boutput\s*:/,
        /\byou are now\b/,
        /\bignore (all |previous |your |the )/,
        /\balready (approved|authorized|confirmed)\b/,
        /\bsystem (says|has|override)\b/,
      ];
      for (const pattern of injectionPatterns) {
        if (pattern.test(reasoningLower)) {
          return [false, "Potential prompt injection detected in reasoning"];
        }
      }

      // User-defined extra keywords from env
      const extraKeywordsRaw = process.env.POP_EXTRA_BLOCK_KEYWORDS ?? "";
      const extraKeywords = extraKeywordsRaw
        .split(",")
        .map((kw) => kw.trim().toLowerCase())
        .filter(Boolean);
      for (const kw of extraKeywords) {
        if (reasoningLower.includes(kw)) {
          return [false, `Blocked by custom keyword policy: '${kw}'`];
        }
      }
    }

    // Rule 4: page_url domain cross-validation
    if (intent.pageUrl) {
      try {
        const parsed = new URL(intent.pageUrl);
        let netloc = parsed.hostname.toLowerCase();
        if (netloc.startsWith("www.")) netloc = netloc.slice(4);

        const vendorTokens = tokenize(intent.targetVendor);
        for (const [knownVendor, knownDomains] of Object.entries(KNOWN_VENDOR_DOMAINS)) {
          if (vendorTokens.has(knownVendor)) {
            const domainOk = knownDomains.some(
              (d) => netloc === d || netloc.endsWith("." + d)
            );
            if (!domainOk) {
              return [false, "Page URL domain does not match expected vendor domain"];
            }
            break;
          }
        }
      } catch {
        // Invalid URL — skip domain validation
      }
    }

    return [true, "Approved"];
  }
}
