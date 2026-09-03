import { describe, it, expect, afterEach } from "vitest";
import { verifyDomainToctou } from "../src/engine/injector.js";

// ---------------------------------------------------------------------------
// Extended TOCTOU domain verification (mirrors Python test_toctou.py + test_headless.py)
// ---------------------------------------------------------------------------
describe("verifyDomainToctou – extended", () => {
  it("domain_mismatch blocks attacker domain for known vendor", () => {
    const result = verifyDomainToctou("https://attacker.com/checkout", "AWS");
    expect(result).toBe("domain_mismatch:attacker.com");
  });

  it("matching domain for known vendor proceeds", () => {
    const result = verifyDomainToctou("https://aws.amazon.com/buy", "AWS");
    expect(result).toBeNull();
  });

  // Known vendor domains
  const knownVendorTests: Array<[string, string, boolean]> = [
    ["https://github.com/pricing", "GitHub", true],
    ["https://cloudflare.com/plans", "Cloudflare", true],
    ["https://openai.com/api", "OpenAI", true],
    ["https://stripe.com/billing", "Stripe", true],
    ["https://claude.ai/upgrade", "Anthropic", true],
    ["https://cloud.google.com/billing", "Google", true],
    ["https://portal.azure.com", "Microsoft", true],
    ["https://donate.wikimedia.org", "Wikipedia", true],
    ["https://cloud.digitalocean.com", "DigitalOcean", true],
    ["https://dashboard.heroku.com", "Heroku", true],
    ["https://app.vercel.com", "Vercel", true],
    ["https://app.netlify.com", "Netlify", true],
  ];

  for (const [url, vendor, shouldPass] of knownVendorTests) {
    it(`${shouldPass ? "passes" : "blocks"} ${vendor} at ${new URL(url).hostname}`, () => {
      const result = verifyDomainToctou(url, vendor);
      if (shouldPass) {
        expect(result).toBeNull();
      } else {
        expect(result).toContain("domain_mismatch");
      }
    });
  }

  it("blocks subdomain spoofing: aws.evil.com for AWS", () => {
    const result = verifyDomainToctou("https://aws.evil.com", "AWS");
    expect(result).toBe("domain_mismatch:aws.evil.com");
  });

  it("blocks subdomain spoofing: github.attacker.com", () => {
    const result = verifyDomainToctou("https://github.attacker.com", "github");
    expect(result).toBe("domain_mismatch:github.attacker.com");
  });

  it("returns null for invalid URL", () => {
    const result = verifyDomainToctou("not-a-url", "AWS");
    expect(result).toBe("invalid_url");
  });

  // Payment processor passthrough
  it("passes Stripe checkout domain for any vendor", () => {
    expect(verifyDomainToctou("https://checkout.stripe.com/pay/cs_123", "RandomShop")).toBeNull();
  });

  it("passes PayPal domain for any vendor", () => {
    expect(verifyDomainToctou("https://www.paypal.com/checkout", "SomeShop")).toBeNull();
  });

  it("passes Square domain for any vendor", () => {
    expect(verifyDomainToctou("https://squareup.com/pay", "LocalStore")).toBeNull();
  });

  it("passes Adyen domain for any vendor", () => {
    expect(verifyDomainToctou("https://checkout.adyen.com/pay", "Store")).toBeNull();
  });

  // User-defined payment processors
  afterEach(() => {
    delete process.env.POP_ALLOWED_PAYMENT_PROCESSORS;
  });

  it("passes user-defined payment processor domain", () => {
    process.env.POP_ALLOWED_PAYMENT_PROCESSORS = '["custom-pay.com"]';
    const result = verifyDomainToctou("https://custom-pay.com/checkout", "SomeVendor");
    expect(result).toBeNull();
  });

  // Unknown vendor token matching
  it("unknown vendor with token match in domain passes", () => {
    expect(verifyDomainToctou("https://acme-shop.com/pay", "Acme Shop")).toBeNull();
  });

  it("unknown vendor with partial match (>=4 chars) passes", () => {
    expect(verifyDomainToctou("https://mycompanystore.com/buy", "company")).toBeNull();
  });

  it("unknown vendor with no match blocks", () => {
    const result = verifyDomainToctou("https://totally-unrelated.com", "SpecificShop");
    expect(result).toContain("domain_mismatch");
  });
});
