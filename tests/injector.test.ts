import { describe, it, expect, vi, afterEach } from "vitest";
import { chromium } from "playwright-core";
import {
  verifyDomainToctou,
  ssrfValidateUrl,
  PopBrowserInjector,
  CARD_NUMBER_SELECTORS,
  EXPIRY_SELECTORS,
  CVV_SELECTORS,
  FIRST_NAME_SELECTORS,
  COUNTRY_SELECTORS,
  STATE_SELECTORS,
  CITY_SELECTORS,
} from "../src/engine/injector.js";

// ---------------------------------------------------------------------------
// TOCTOU domain verification
// ---------------------------------------------------------------------------
describe("verifyDomainToctou", () => {
  it("passes when page domain matches known vendor", () => {
    expect(verifyDomainToctou("https://aws.amazon.com/checkout", "AWS")).toBeNull();
  });

  it("passes for known payment processor domain", () => {
    expect(verifyDomainToctou("https://checkout.stripe.com/pay/cs_123", "SomeVendor")).toBeNull();
  });

  it("blocks mismatched domain for known vendor", () => {
    const result = verifyDomainToctou("https://evil.com/checkout", "AWS");
    expect(result).toBe("domain_mismatch:evil.com");
  });

  it("passes for unknown vendor with token match in domain", () => {
    expect(verifyDomainToctou("https://acme-shop.com/pay", "Acme Shop")).toBeNull();
  });

  it("returns null when both args are empty (no vendor context to enforce)", () => {
    expect(verifyDomainToctou("", "")).toBeNull();
  });

  it("R1/F1: blocks when pageUrl is empty but a vendor is being enforced", () => {
    // Previously returned null (not blocked) -- the validate-here/inject-there
    // bypass: a compromised agent could omit pageUrl to silently skip the
    // domain guard while injection still proceeded against whatever page
    // findBestPage resolved.
    expect(verifyDomainToctou("", "AWS")).toBe("empty_page_url");
  });

  it("strips www prefix from domain", () => {
    expect(verifyDomainToctou("https://www.github.com/pricing", "github")).toBeNull();
  });

  it("blocks subdomain spoofing for known vendor", () => {
    const result = verifyDomainToctou("https://github.attacker.com", "github");
    expect(result).toBe("domain_mismatch:github.attacker.com");
  });
});

// ---------------------------------------------------------------------------
// R1/F1 regression tests — validate-here / inject-there
// ---------------------------------------------------------------------------
//
// Bypass vector A: a compromised agent calls inject with pageUrl="" to
//   silently skip the domain guard entirely (verifyDomainToctou used to
//   `return null` for an empty pageUrl, meaning "not blocked").
// Bypass vector B: the agent supplies a legitimate, approved pageUrl, but the
//   shared CDP browser already has a DIFFERENT (attacker-controlled) tab open
//   that findBestPage resolves to instead — the original code validated the
//   caller-supplied pageUrl string but injected into whatever page was
//   actually resolved, with no equality check between the two.
//
// Both vectors must result in cardFilled/billingFilled = false and NO fields
// ever filled.
function makeMockPage(url: string) {
  const mockFrame: any = {
    url: () => url,
    locator: () => ({ first: () => ({ count: async () => 0 }) }),
  };
  return {
    url: () => url,
    frames: () => [mockFrame],
    mainFrame: () => mockFrame,
    bringToFront: async () => {},
    evaluate: async () => false,
    getByLabel: () => ({ count: async () => 0 }),
  };
}

function makeMockBrowser(page: any) {
  return {
    contexts: () => [{ pages: () => [page] }],
    close: async () => {},
  };
}

describe("PopBrowserInjector.injectPaymentInfo — R1/F1", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts before connecting to CDP when pageUrl is empty", async () => {
    const connectSpy = vi.spyOn(chromium, "connectOverCDP");
    const injector = new PopBrowserInjector("http://localhost:9222");

    const result = await injector.injectPaymentInfo({
      cardNumber: "4111111111111111",
      cvv: "123",
      expiry: "12/28",
      approvedVendor: "wikipedia",
      pageUrl: "",
    });

    expect(result.cardFilled).toBe(false);
    expect(result.blockedReason).toBe("empty_page_url");
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks injection when findBestPage resolves to a mismatched (attacker) page", async () => {
    const mockPage = makeMockPage("https://attacker.com/checkout");
    const mockBrowser = makeMockBrowser(mockPage);
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(mockBrowser as any);

    const injector = new PopBrowserInjector("http://localhost:9222");
    const fillSpy = vi.spyOn(injector as any, "fillAcrossFrames");

    const result = await injector.injectPaymentInfo({
      cardNumber: "4111111111111111",
      cvv: "123",
      expiry: "12/28",
      approvedVendor: "wikipedia",
      pageUrl: "https://en.wikipedia.org/wiki/donate", // legitimate, approved
    });

    expect(result.cardFilled).toBe(false);
    expect(result.blockedReason).toMatch(/^domain_mismatch:/);
    expect(fillSpy).not.toHaveBeenCalled(); // no PAN/CVV ever handed to the fill path
  });

  it("proceeds to fill when findBestPage resolves to a matching page (no false positive)", async () => {
    const mockPage = makeMockPage("https://en.wikipedia.org/wiki/donate");
    const mockBrowser = makeMockBrowser(mockPage);
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(mockBrowser as any);

    const injector = new PopBrowserInjector("http://localhost:9222");
    vi.spyOn(injector as any, "fillAcrossFrames").mockResolvedValue(true);

    const result = await injector.injectPaymentInfo({
      cardNumber: "4111111111111111",
      cvv: "123",
      expiry: "12/28",
      approvedVendor: "wikipedia",
      pageUrl: "https://en.wikipedia.org/wiki/donate",
    });

    expect(result.blockedReason).toBe("");
    expect(result.cardFilled).toBe(true);
  });
});

describe("PopBrowserInjector.injectBillingOnly — R1/F1", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts before connecting to CDP when pageUrl is empty", async () => {
    const connectSpy = vi.spyOn(chromium, "connectOverCDP");
    const injector = new PopBrowserInjector("http://localhost:9222");

    const result = await injector.injectBillingOnly({
      pageUrl: "",
      approvedVendor: "wikipedia",
    });

    expect(result.billingFilled).toBe(false);
    expect(result.blockedReason).toBe("empty_page_url");
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks injection when findBestPage resolves to a mismatched (attacker) page", async () => {
    const mockPage = makeMockPage("https://attacker.com/checkout");
    const mockBrowser = makeMockBrowser(mockPage);
    vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(mockBrowser as any);

    const injector = new PopBrowserInjector("http://localhost:9222");
    const fillSpy = vi.spyOn(injector as any, "fillBillingFields");

    const result = await injector.injectBillingOnly({
      pageUrl: "https://en.wikipedia.org/wiki/donate",
      approvedVendor: "wikipedia",
    });

    expect(result.billingFilled).toBe(false);
    expect(result.blockedReason).toMatch(/^domain_mismatch:/);
    expect(fillSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSRF validation
// ---------------------------------------------------------------------------
describe("ssrfValidateUrl", () => {
  it("accepts valid https URL", () => {
    expect(ssrfValidateUrl("https://example.com")).toBeNull();
  });

  it("accepts valid http URL", () => {
    expect(ssrfValidateUrl("http://example.com")).toBeNull();
  });

  it("rejects non-http protocol", () => {
    expect(ssrfValidateUrl("ftp://example.com")).not.toBeNull();
    expect(ssrfValidateUrl("file:///etc/passwd")).not.toBeNull();
  });

  it("rejects localhost", () => {
    expect(ssrfValidateUrl("http://localhost:3000")).not.toBeNull();
    expect(ssrfValidateUrl("http://127.0.0.1:8080")).not.toBeNull();
  });

  it("rejects private IPs", () => {
    expect(ssrfValidateUrl("http://10.0.0.1")).not.toBeNull();
    expect(ssrfValidateUrl("http://192.168.1.1")).not.toBeNull();
    expect(ssrfValidateUrl("http://172.16.0.1")).not.toBeNull();
  });

  it("rejects invalid URL", () => {
    expect(ssrfValidateUrl("not-a-url")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selector registries
// ---------------------------------------------------------------------------
describe("selector registries", () => {
  it("card number selectors include Stripe Elements", () => {
    expect(CARD_NUMBER_SELECTORS).toContain(
      "input[data-elements-stable-field-name='cardNumber']"
    );
  });

  it("expiry selectors include autocomplete", () => {
    expect(EXPIRY_SELECTORS).toContain("input[autocomplete='cc-exp']");
  });

  it("CVV selectors include common names", () => {
    expect(CVV_SELECTORS).toContain("input[name='cvc']");
    expect(CVV_SELECTORS).toContain("input[name='cvv']");
  });

  it("billing selectors cover common patterns", () => {
    expect(FIRST_NAME_SELECTORS.length).toBeGreaterThan(5);
    expect(COUNTRY_SELECTORS.some((s) => s.startsWith("select["))).toBe(true);
    expect(STATE_SELECTORS.some((s) => s.startsWith("select["))).toBe(true);
    expect(CITY_SELECTORS.some((s) => s.startsWith("input["))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Masked card display
// ---------------------------------------------------------------------------
describe("PopBrowserInjector.maskedCard", () => {
  it("masks card number showing last 4", () => {
    expect(PopBrowserInjector.maskedCard("4242424242424242")).toBe("****-****-****-4242");
  });

  it("handles short input gracefully", () => {
    expect(PopBrowserInjector.maskedCard("1234")).toBe("****-****-****-1234");
  });
});

// ---------------------------------------------------------------------------
// fillBillingFields filling order
// ---------------------------------------------------------------------------
describe("PopBrowserInjector - fillBillingFields Execution Order", () => {
  it("should fill all input fields before any select fields", async () => {
    // The actual constructor in injector.ts is (cdpUrl, headless)
    const injector = new PopBrowserInjector("http://localhost:9222");

    // Track the order of fill operations and their detected tag types
    const fillOrder: Array<{ type: string; field: string }> = [];

    // BillingInfo with all fields. 
    // We leave phone fields empty to verify the core Round 1/2 logic specifically.
    const billingInfo = {
      firstName: "John",
      lastName: "Doe",
      street: "123 Main St",
      city: "San Francisco",
      state: "CA",
      country: "US",
      zip: "94105",
      email: "john@example.com",
      phone: "",
      phoneCountryCode: "",
    };

    const mockFrame: any = {
      locator: (selector: string) => ({
        first: () => ({
          count: async () => 1,
          evaluate: async (fn: any) => {
            const fnStr = fn.toString();
            const isSelect = selector.includes('state') || 
                             selector.includes('country') || 
                             selector.includes('address-level1') || 
                             selector.includes('address-level2') && selector.startsWith('select');
            
            if (fnStr.includes('tagName.toLowerCase()')) {
              return isSelect ? 'select' : 'input';
            }
            if (fnStr.includes('nativeSetter') || fnStr.includes('el.options')) {
              const isSelectFill = fnStr.includes('el.options') || isSelect;
              fillOrder.push({
                type: isSelectFill ? 'select' : 'input',
                field: selector,
              });
              return true;
            }
            return null;
          },
          fill: async () => {
            fillOrder.push({ type: 'input', field: selector });
            return true;
          },
          dispatchEvent: async () => {},
        })
      })
    };

    const mockPage = {
      frames: () => [mockFrame],
      mainFrame: () => mockFrame,
      getByLabel: () => ({ count: async () => 0 }),
    };

    // fillBillingFields is private, access via any
    await (injector as any).fillBillingFields(mockPage, billingInfo);

    // Verify: all 'input' entries must appear before any 'select' entries
    let foundSelect = false;
    for (const entry of fillOrder) {
      if (entry.type === "select") {
        foundSelect = true;
      } else if (entry.type === "input") {
        if (foundSelect) {
          throw new Error(`Found input field filled after select field: ${entry.field}`);
        }
      }
    }

    // Ensure we actually tested both types
    expect(fillOrder.length).toBeGreaterThan(0);
    expect(fillOrder.some((f) => f.type === "input")).toBe(true);
    expect(fillOrder.some((f) => f.type === "select")).toBe(true);
  });
});
