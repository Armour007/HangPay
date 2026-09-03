/**
 * PopBrowserInjector: Playwright-based browser injector for payment and billing fields.
 *
 * Connects to an already-running Chromium browser (via --remote-debugging-port)
 * using playwright-core and auto-fills credit card fields across all frames.
 *
 * This version replaces the raw CDP WebSocket implementation with Playwright's
 * connectOverCDP, providing better isolation and cross-origin iframe support.
 */

import { chromium, type Browser, type Page, type Frame, type Locator } from "playwright-core";
import { KNOWN_PAYMENT_PROCESSORS } from "./known-processors.js";

// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------
const LOG_LEVEL = (process.env.POP_LOG_LEVEL ?? "info").toLowerCase();
const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// S0.7 F5: redact runs of 12–19 consecutive digits (PAN range) and isolated
// 3–4 digit groups that look like CVVs from any free-form string that might
// contain an upstream error message echoing card data.
const _PAN_RE = /\b\d{12,19}\b/g;
export function redactPanInString(s: string): string {
  if (!s) return s;
  return s.replace(_PAN_RE, "***REDACTED***");
}

// S0.7 F6(b): detect Chrome instances launched with verbose logging flags.
// Best-effort process scan; failures return "" (don't block on enumeration error).
const _RISKY_CHROME_FLAGS = ["--enable-logging", "--v=", "--vmodule=", "--log-net-log"];

export function detectRiskyChromeFlags(): string {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const cmd = process.platform === "win32"
      ? `wmic process where "name='chrome.exe'" get CommandLine`
      : `ps -Ao command`;
    const out = execSync(cmd, { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString();
    for (const line of out.split("\n")) {
      const low = line.toLowerCase();
      if (!low.includes("chrome") && !low.includes("chromium")) continue;
      for (const flag of _RISKY_CHROME_FLAGS) {
        if (line.includes(flag)) return flag;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function log(level: "debug" | "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  if ((LEVELS[level] ?? 1) < (LEVELS[LOG_LEVEL] ?? 1)) return;
  const safeData: Record<string, unknown> = {};
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      safeData[k] = typeof v === "string" ? redactPanInString(v) : v;
    }
  }
  const entry = { ts: new Date().toISOString(), level, component: "PopBrowserInjector", msg, ...safeData };
  const out = level === "error" ? process.stderr : process.stderr;
  out.write(JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// ISO 3166-1 alpha-2 -> E.164 dial prefix
// ---------------------------------------------------------------------------
const COUNTRY_DIAL_CODES: Record<string, string> = {
  US: "+1",   CA: "+1",   GB: "+44",  AU: "+61",  DE: "+49",
  FR: "+33",  JP: "+81",  CN: "+86",  IN: "+91",  BR: "+55",
  TW: "+886", HK: "+852", SG: "+65",  KR: "+82",  MX: "+52",
  NL: "+31",  SE: "+46",  NO: "+47",  DK: "+45",  FI: "+358",
  CH: "+41",  AT: "+43",  BE: "+32",  IT: "+39",  ES: "+34",
  PT: "+351", PL: "+48",  RU: "+7",   UA: "+380", NZ: "+64",
  ZA: "+27",  NG: "+234", EG: "+20",  IL: "+972", AE: "+971",
  SA: "+966", TR: "+90",  AR: "+54",  CO: "+57",  CL: "+56",
  TH: "+66",  VN: "+84",  ID: "+62",  MY: "+60",  PH: "+63",
};

function nationalNumber(phoneE164: string, countryCode: string): string {
  if (!phoneE164.startsWith("+")) return phoneE164;
  const cc = countryCode.trim();
  let dial: string;
  if (!cc.startsWith("+")) {
    dial = COUNTRY_DIAL_CODES[cc.toUpperCase()] ?? `+${cc}`;
  } else {
    dial = cc;
  }
  if (phoneE164.startsWith(dial)) return phoneE164.slice(dial.length);
  return phoneE164;
}

// ---------------------------------------------------------------------------
// US state abbreviation -> full name
// ---------------------------------------------------------------------------
const US_STATE_CODES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
export const CARD_NUMBER_SELECTORS = [
  "input[autocomplete='cc-number']",
  "input[name='cardnumber']",
  "input[name='card_number']",
  "input[name='card-number']",
  "input[id*='card'][id*='number']",
  "input[placeholder*='Card number']",
  "input[placeholder*='card number']",
  "input[data-elements-stable-field-name='cardNumber']",
  "input.__PrivateStripeElement",
];

export const EXPIRY_SELECTORS = [
  "input[autocomplete='cc-exp']",
  "input[name='cc-exp']",
  "input[name='expiry']",
  "input[name='card_expiry']",
  "input[placeholder*='MM / YY']",
  "input[placeholder*='MM/YY']",
  "input[placeholder*='Expiry']",
  "input[data-elements-stable-field-name='cardExpiry']",
];

export const CVV_SELECTORS = [
  "input[autocomplete='cc-csc']",
  "input[name='cvc']",
  "input[name='cvv']",
  "input[name='security_code']",
  "input[name='card_cvc']",
  "input[placeholder*='CVC']",
  "input[placeholder*='CVV']",
  "input[placeholder*='Security code']",
  "input[data-elements-stable-field-name='cardCvc']",
];

export const FIRST_NAME_SELECTORS = [
  "input[autocomplete='given-name']",
  "input[name='first_name']", "input[name='firstName']", "input[name='first-name']",
  "input[id*='first'][id*='name']", "input[id='first_name']", "input[id='firstName']",
  "input[placeholder*='First name']", "input[placeholder*='first name']",
  "input[aria-label*='First name']", "input[aria-label*='first name']",
];

export const LAST_NAME_SELECTORS = [
  "input[autocomplete='family-name']",
  "input[name='last_name']", "input[name='lastName']", "input[name='last-name']",
  "input[id*='last'][id*='name']", "input[id='last_name']", "input[id='lastName']",
  "input[placeholder*='Last name']", "input[placeholder*='last name']",
  "input[aria-label*='Last name']", "input[aria-label*='last name']",
];

export const FULL_NAME_SELECTORS = [
  "input[autocomplete='name']",
  "input[name='full_name']", "input[name='fullName']", "input[name='name']",
  "input[id='full_name']", "input[id='fullName']",
  "input[placeholder*='Full name']", "input[placeholder*='full name']",
  "input[aria-label*='Full name']", "input[aria-label*='full name']",
];

export const STREET_SELECTORS = [
  "input[autocomplete='street-address']", "input[autocomplete='address-line1']",
  "input[name='address']", "input[name='address1']", "input[name='street']",
  "input[name='street_address']", "input[name='billing_address']",
  "input[id*='address']", "input[id*='street']",
  "input[placeholder*='Street']", "input[placeholder*='street']",
  "input[placeholder*='Address']", "input[placeholder*='address']",
  "input[aria-label*='Street']", "input[aria-label*='street']",
];

export const ZIP_SELECTORS = [
  "input[autocomplete='postal-code']",
  "input[name='zip']", "input[name='postal_code']", "input[name='postcode']",
  "input[name='zipcode']", "input[name='zip_code']",
  "input[id*='zip']", "input[id*='postal']",
  "input[placeholder*='Zip']", "input[placeholder*='zip']",
  "input[placeholder*='Postal']", "input[placeholder*='postal']",
  "input[aria-label*='Zip']", "input[aria-label*='zip']", "input[aria-label*='Postal']",
];

export const EMAIL_SELECTORS = [
  "input[autocomplete='email']", "input[type='email']",
  "input[name='email']", "input[name='email_address']",
  "input[id='email']", "input[id*='email']",
  "input[placeholder*='Email']", "input[placeholder*='email']",
  "input[aria-label*='Email']", "input[aria-label*='email']",
];

export const PHONE_SELECTORS = [
  "input[autocomplete='tel']", "input[type='tel']",
  "input[name='phone']", "input[name='phone_number']", "input[name='phoneNumber']",
  "input[name='telephone']", "input[name='mobile']",
  "input[id*='phone']", "input[id*='tel']", "input[id*='mobile']",
  "input[placeholder*='Phone']", "input[placeholder*='phone']",
  "input[placeholder*='Mobile']",
  "input[aria-label*='Phone']", "input[aria-label*='phone']",
];

export const PHONE_COUNTRY_CODE_SELECTORS = [
  "select[autocomplete='tel-country-code']",
  "select[name='phone_country_code']", "select[name='phoneCountryCode']",
  "select[name='dialCode']", "select[name='dial_code']",
  "select[name='country_code']", "select[name='countryCode']",
  "select[id*='country_code']", "select[id*='dialCode']", "select[id*='dial_code']",
  "select[aria-label*='Country code']", "select[aria-label*='country code']",
  "select[aria-label*='Dial code']",
];

export const COUNTRY_SELECTORS = [
  "select[autocomplete='country']", "select[autocomplete='country-name']",
  "select[name='country']", "select[name='billing_country']", "select[name='billingCountry']",
  "select[id='country']", "select[id*='country']",
  "select[aria-label*='Country']", "select[aria-label*='country']",
  "input[autocomplete='country']", "input[autocomplete='country-name']", "input[name='country']",
];

export const STATE_SELECTORS = [
  "select[autocomplete='address-level1']",
  "select[name='state']", "select[name='province']", "select[name='region']",
  "select[name='billing_state']",
  "select[id='state']", "select[id*='state']", "select[id*='province']",
  "select[aria-label*='State']", "select[aria-label*='state']",
  "select[aria-label*='Province']",
  "input[autocomplete='address-level1']", "input[name='state']", "input[name='province']",
];

export const CITY_SELECTORS = [
  "input[autocomplete='address-level2']",
  "input[name='city']", "input[name='town']", "input[name='billing_city']",
  "input[id='city']", "input[id*='city']",
  "input[placeholder*='City']", "input[placeholder*='city']",
  "input[aria-label*='City']",
  "select[autocomplete='address-level2']", "select[name='city']",
];

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

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------
export function ssrfValidateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Only http/https URLs are allowed.";
    }
    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "[::1]" ||
      hostname.endsWith(".local")
    ) {
      return "Private/reserved IP addresses are not allowed.";
    }
  } catch {
    return "Invalid URL.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BillingInfo {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
}

export interface InjectionResult {
  cardFilled: boolean;
  billingFilled: boolean;
  blockedReason: string;
  billingDetails?: { filled: string[]; failed: string[]; skipped: string[] };
}

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
  frames: { url: string; html: string }[];
}

// ---------------------------------------------------------------------------
// TOCTOU domain verification
// ---------------------------------------------------------------------------
export function verifyDomainToctou(
  pageUrl: string,
  approvedVendor: string
): string | null {
  if (!approvedVendor) {
    // No vendor context to verify against -- nothing to enforce.
    return null;
  }
  if (!pageUrl) {
    // R1/F1 fix: an empty pageUrl used to silently skip the domain guard
    // entirely. A compromised agent could omit pageUrl to bypass
    // verification while injection still proceeded against whatever page
    // findBestPage happened to resolve. Whenever a vendor is being enforced,
    // refuse to inject without a pageUrl to check.
    return "empty_page_url";
  }

  let actualDomain: string;
  try {
    actualDomain = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "invalid_url";
  }

  const vendorLower = approvedVendor.toLowerCase();
  const vendorTokens = new Set(
    vendorLower.split(/[\s\-_./]+/).filter(Boolean)
  );

  let domainOk = false;
  let vendorIsKnown = false;

  for (const [knownVendor, knownDomains] of Object.entries(KNOWN_VENDOR_DOMAINS)) {
    if (vendorTokens.has(knownVendor) || knownVendor === vendorLower) {
      vendorIsKnown = true;
      if (knownDomains.some((d) => actualDomain === d || actualDomain.endsWith("." + d))) {
        domainOk = true;
      }
      break;
    }
  }

  if (!domainOk && !vendorIsKnown) {
    const commonTlds = new Set(["com", "org", "net", "io", "co", "uk", "jp", "de", "fr"]);
    const domainLabels = new Set(
      actualDomain.split(".").filter((l) => !commonTlds.has(l))
    );
    domainOk =
      [...vendorTokens].some((tok) => domainLabels.has(tok)) ||
      [...vendorTokens].some(
        (tok) =>
          tok.length >= 4 &&
          [...domainLabels].some((label) => label.includes(tok))
      );
  }

  if (!domainOk) {
    let userProcessors: string[] = [];
    try {
      userProcessors = JSON.parse(
        process.env.POP_ALLOWED_PAYMENT_PROCESSORS ?? "[]"
      );
    } catch {}
    const allProcessors = new Set([...KNOWN_PAYMENT_PROCESSORS, ...userProcessors]);
    if ([...allProcessors].some((p) => actualDomain === p || actualDomain.endsWith("." + p))) {
      domainOk = true;
    }
  }

  if (!domainOk) {
    return `domain_mismatch:${actualDomain}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PopBrowserInjector
// ---------------------------------------------------------------------------
export class PopBrowserInjector {
  private cdpUrl: string;
  private defaultBillingInfo?: BillingInfo;
  private browser: Browser | null = null;

  constructor(cdpUrl: string = "http://localhost:9222", billingInfoOrHeadless?: BillingInfo | boolean) {
    this.cdpUrl = cdpUrl;
    if (typeof billingInfoOrHeadless === "object") {
      this.defaultBillingInfo = billingInfoOrHeadless;
    }
  }

  /**
   * Inject payment info into the current page.
   * Supports both positional and object-based signatures for compatibility.
   */
  async injectPaymentInfo(
    optsOrCard: string | { cardNumber: string; expiry?: string; expirationDate?: string; cvv: string; vendor?: string; approvedVendor?: string; pageUrl?: string; billingInfo?: BillingInfo; sealId?: string },
    expiry?: string,
    cvv?: string,
    vendor?: string,
    pageUrl?: string,
    billingInfo?: BillingInfo
  ): Promise<InjectionResult> {
    let cardNumber: string;
    let exp: string;
    let cv: string;
    let vend: string;
    let url: string;
    let billing: BillingInfo | undefined;

    if (typeof optsOrCard === "object") {
      cardNumber = optsOrCard.cardNumber;
      exp = optsOrCard.expiry || optsOrCard.expirationDate || "";
      cv = optsOrCard.cvv;
      vend = optsOrCard.vendor || optsOrCard.approvedVendor || "";
      url = optsOrCard.pageUrl || "";
      billing = optsOrCard.billingInfo || billingInfo;
    } else {
      cardNumber = optsOrCard;
      exp = expiry || "";
      cv = cvv || "";
      vend = vendor || "";
      url = pageUrl || "";
      billing = billingInfo;
    }

    const result: InjectionResult = {
      cardFilled: false,
      billingFilled: false,
      blockedReason: "",
    };

    // TOCTOU guard
    const blocked = verifyDomainToctou(url, vend);
    if (blocked) {
      result.blockedReason = blocked;
      return result;
    }

    const finalBilling = billing || this.defaultBillingInfo || this.loadBillingFromEnv();
    const hasBilling = Object.values(finalBilling).some((v) => v !== "");

    try {
      // S0.7 F6(b): refuse injection if target Chrome has verbose logging flags.
      const riskyFlag = detectRiskyChromeFlags();
      if (riskyFlag) {
        result.blockedReason = `chrome_logging_flag:${riskyFlag}`;
        log("error", "refusing injection — chrome verbose logging flag detected", { flag: riskyFlag });
        return result;
      }
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      const page = this.findBestPage(this.browser);
      if (!page) {
        result.blockedReason = "no_active_page";
        return result;
      }

      // R1/F1 fix: validate-here / inject-there. The page actually resolved
      // above by findBestPage may differ from what was checked at the top of
      // this function -- e.g. an attacker-controlled tab already open in a
      // shared CDP browser. Re-verify the domain of the ACTUAL resolved page
      // immediately before injecting; abort with no fields filled on any
      // mismatch. Never inject into a page whose domain was not approved.
      const resolvedBlocked = verifyDomainToctou(page.url(), vend);
      if (resolvedBlocked) {
        result.blockedReason = resolvedBlocked;
        log("error", "resolved injection target does not match approved vendor — aborting", { vendor: vend });
        return result;
      }

      await page.bringToFront();

      // S0.7 F6(c): default "before" — agent never sees plaintext in DOM.
      const blackoutMode = (process.env.POP_BLACKOUT_MODE ?? "before").toLowerCase();
      if (blackoutMode === "before") {
        await this.enableBlackout(page);
      }

      // Fill card fields across all frames
      result.cardFilled = await this.fillAcrossFrames(page, cardNumber, exp, cv);

      // Fill billing fields
      if (hasBilling) {
        const billingResult = await this.fillBillingFields(page, finalBilling);
        result.billingFilled = billingResult.filled.length > 0;
        result.billingDetails = billingResult;
      }

      if (blackoutMode === "after") {
        await this.enableBlackout(page);
      }

      return result;
    } catch (err: any) {
      log("error", "injection failed", { error: err.message });
      return result;
    } finally {
      await this.close();
    }
  }

  /**
   * Internal method used by mcp-server.ts. Kept for compatibility but marked internal.
   * @internal
   */
  async injectBillingOnly(opts: { pageUrl?: string; approvedVendor?: string }): Promise<InjectionResult> {
    const result: InjectionResult = { cardFilled: false, billingFilled: false, blockedReason: "" };
    const blocked = verifyDomainToctou(opts.pageUrl ?? "", opts.approvedVendor ?? "");
    if (blocked) {
      result.blockedReason = blocked;
      return result;
    }

    const billing = this.defaultBillingInfo || this.loadBillingFromEnv();

    try {
      const riskyFlag = detectRiskyChromeFlags();
      if (riskyFlag) {
        result.blockedReason = `chrome_logging_flag:${riskyFlag}`;
        log("error", "refusing billing injection — chrome verbose logging flag", { flag: riskyFlag });
        return result;
      }
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      const page = this.findBestPage(this.browser);
      if (!page) {
        result.blockedReason = "no_active_page";
        return result;
      }

      // R1/F1 fix: re-verify the domain of the ACTUAL resolved page
      // immediately before injecting billing fields -- see the matching
      // guard in injectPaymentInfo for rationale.
      const resolvedBlocked = verifyDomainToctou(page.url(), opts.approvedVendor ?? "");
      if (resolvedBlocked) {
        result.blockedReason = resolvedBlocked;
        log("error", "resolved billing injection target does not match approved vendor — aborting", {
          vendor: opts.approvedVendor ?? "",
        });
        return result;
      }

      const billingResult = await this.fillBillingFields(page, billing);
      result.billingFilled = billingResult.filled.length > 0;
      result.billingDetails = billingResult;

      return result;
    } catch (err: any) {
      log("error", "billing injection failed", { error: err.message });
      return result;
    } finally {
      await this.close();
    }
  }

  async pageSnapshot(url?: string): Promise<PageSnapshot | null> {
    try {
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      const page = this.findBestPage(this.browser);
      if (!page) return null;

      const title = await page.title();
      const pageUrl = page.url();
      const html = await page.content();

      const frames: { url: string; html: string }[] = [];
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameHtml = await frame.content();
          frames.push({ url: frame.url(), html: frameHtml });
        } catch {}
      }

      return { url: pageUrl, title, html, frames };
    } catch (err: any) {
      log("error", "snapshot failed", { error: err.message });
      return null;
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }

  static maskedCard(cardNumber: string): string {
    const last4 = cardNumber.slice(-4);
    return `****-****-****-${last4}`;
  }

  // ------------------------------------------------------------------
  // Internal Helpers
  // ------------------------------------------------------------------

  private findBestPage(browser: Browser): Page | null {
    const CHECKOUT_KEYWORDS = ["checkout", "payment", "donate", "pay", "purchase", "order", "gateway", "cart"];
    const allPages = browser.contexts().flatMap((ctx) => ctx.pages());
    if (allPages.length === 0) return null;

    for (const page of allPages) {
      const url = page.url().toLowerCase();
      if (CHECKOUT_KEYWORDS.some((kw) => url.includes(kw))) {
        return page;
      }
    }
    return allPages[allPages.length - 1];
  }

  private async fillAcrossFrames(page: Page, cardNumber: string, expiry: string, cvv: string): Promise<boolean> {
    const allFrames = page.frames();
    let cardFilled = false;

    for (const frame of allFrames) {
      try {
        log("debug", "scanning frame", { frameUrl: frame.url() });
        if (await this.fillInFrame(frame, cardNumber, expiry, cvv)) {
          log("info", "card fields filled in frame", { frameUrl: frame.url() });
          cardFilled = true;
          // Keep going for expiry/CVV in sibling iframes (Stripe)
        }
      } catch {}
    }

    // Shadow DOM piercing fallback
    if (!cardFilled) {
      cardFilled = await this.fillCardInShadowDom(page, cardNumber, expiry, cvv);
    }

    return cardFilled;
  }

  private async fillInFrame(frame: Frame, cardNumber: string, expiry: string, cvv: string): Promise<boolean> {
    const cardLocator = await this.findVisibleLocator(frame, CARD_NUMBER_SELECTORS);
    if (!cardLocator) return false;

    await cardLocator.fill(cardNumber);

    const expiryLocator = await this.findVisibleLocator(frame, EXPIRY_SELECTORS);
    if (expiryLocator) await expiryLocator.fill(expiry);

    const cvvLocator = await this.findVisibleLocator(frame, CVV_SELECTORS);
    if (cvvLocator) await cvvLocator.fill(cvv);

    return true;
  }

  private async findVisibleLocator(frame: Frame, selectors: string[]): Promise<Locator | null> {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();
        if (await locator.count() > 0) {
          return locator;
        }
      } catch {}
    }
    return null;
  }

  private async fillCardInShadowDom(page: Page, cardNumber: string, expiry: string, cvv: string): Promise<boolean> {
    try {
      const script = `
        ([cardNumber, expiry, cvv, cardSels, expSels, cvvSels]) => {
          function queryShadowFirst(root, selectors) {
            const selectorList = selectors.split(', ');
            for (const sel of selectorList) {
              const found = root.querySelector(sel);
              if (found) return found;
            }
            const allElements = root.querySelectorAll('*');
            for (const el of allElements) {
              if (el.shadowRoot) {
                const found = queryShadowFirst(el.shadowRoot, selectors);
                if (found) return found;
              }
            }
            return null;
          }

          function fillField(root, selectors, value) {
            const el = queryShadowFirst(root, selectors);
            if (!el) return false;
            const nativeSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            ).set;
            if (nativeSetter) {
              nativeSetter.call(el, value);
            } else {
              el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }

          const cardFilled = fillField(document, cardSels, cardNumber);
          if (cardFilled) {
            fillField(document, expSels, expiry);
            fillField(document, cvvSels, cvv);
          }
          return cardFilled;
        }
      `;
      const result = await page.evaluate(script, [
        cardNumber, expiry, cvv,
        CARD_NUMBER_SELECTORS.join(", "),
        EXPIRY_SELECTORS.join(", "),
        CVV_SELECTORS.join(", ")
      ]);
      return !!result;
    } catch {
      return false;
    }
  }

  private async fillBillingFields(page: Page, info: BillingInfo): Promise<{ filled: string[]; failed: string[]; skipped: string[] }> {
    const filled: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    const state = info.state.length === 2 ? US_STATE_CODES[info.state.toUpperCase()] ?? info.state : info.state;

    const tryFill = async (selectors: string[], value: string, name: string, label: string) => {
      if (!value) {
        skipped.push(name);
        return;
      }
      const ok = await this.fillField(page, selectors, value, name, label);
      if (ok) filled.push(name);
      else failed.push(`${name} (value='${value}')`);
    };

    // Input fields first
    await tryFill(FIRST_NAME_SELECTORS, info.firstName, "first_name", "First name");
    await tryFill(LAST_NAME_SELECTORS, info.lastName, "last_name", "Last name");
    if (info.firstName || info.lastName) {
      const fullName = [info.firstName, info.lastName].filter(Boolean).join(" ");
      await tryFill(FULL_NAME_SELECTORS, fullName, "full_name", "Full name");
    }
    await tryFill(STREET_SELECTORS, info.street, "street", "Address");
    await tryFill(CITY_SELECTORS, info.city, "city", "City");
    await tryFill(ZIP_SELECTORS, info.zip, "zip", "Zip");
    await tryFill(EMAIL_SELECTORS, info.email, "email", "Email");

    // Selects last
    await tryFill(COUNTRY_SELECTORS, info.country, "country", "Country");
    await tryFill(STATE_SELECTORS, state, "state", "State");

    // Phone
    let ccFilled = false;
    if (info.phoneCountryCode) {
      ccFilled = await this.fillField(page, PHONE_COUNTRY_CODE_SELECTORS, info.phoneCountryCode, "phone_country_code", "Country code");
      if (ccFilled) filled.push("phone_country_code");
    }
    const phoneValue = ccFilled ? nationalNumber(info.phone, info.phoneCountryCode) : info.phone;
    await tryFill(PHONE_SELECTORS, phoneValue, "phone", "Phone");

    return { filled, failed, skipped };
  }

  private async fillField(page: Page, selectors: string[], value: string, name: string, label: string): Promise<boolean> {
    // Strategy 1: getByLabel
    try {
      const labelLocator = page.getByLabel(label, { exact: false });
      if (await labelLocator.count() > 0) {
        const tag = await labelLocator.first().evaluate("el => el.tagName.toLowerCase()");
        if (tag === "select") {
          return await this.selectOption(labelLocator.first(), value);
        } else {
          await labelLocator.first().fill(value);
          await this.dispatchEvents(labelLocator.first());
          return true;
        }
      }
    } catch {}

    // Strategy 2: CSS selectors — search ALL frames (including iframes)
    let locator: Locator | null = null;
    for (const frame of page.frames()) {
      locator = await this.findVisibleLocator(frame, selectors);
      if (locator) break;
    }
    if (!locator) return false;

    try {
      const tag = await locator.evaluate("el => el.tagName.toLowerCase()");
      if (tag === "select") {
        return await this.selectOption(locator, value);
      } else {
        await locator.fill(value);
        await this.dispatchEvents(locator);
        return true;
      }
    } catch {
      return false;
    }
  }

  private async selectOption(locator: Locator, value: string): Promise<boolean> {
    try {
      const options = await locator.evaluate(`el =>
        Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() }))
      `) as Array<{ value: string; text: string }>;
      const valueLower = value.toLowerCase();
      let matchedValue: string | null = null;

      for (const opt of options) {
        if (opt.value.toLowerCase() === valueLower) { matchedValue = opt.value; break; }
      }
      if (!matchedValue) {
        for (const opt of options) {
          if (opt.text.toLowerCase() === valueLower) { matchedValue = opt.value; break; }
        }
      }
      if (!matchedValue) {
        for (const opt of options) {
          if ((valueLower.includes(opt.text.toLowerCase()) || opt.text.toLowerCase().includes(valueLower)) && opt.value) {
            matchedValue = opt.value; break;
          }
        }
      }

      if (!matchedValue) return false;

      await locator.selectOption(matchedValue);
      const actual = await locator.evaluate((el: any) => el.value);

      if (actual === matchedValue) {
        await this.dispatchEvents(locator);
        return true;
      }

      return await locator.evaluate(`(el, val) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        if (!nativeSetter) return false;
        nativeSetter.call(el, val);
        const events = ["focusin", "focus", "mousedown", "mouseup", "click", "input", "change", "blur", "focusout"];
        events.forEach((evt) => el.dispatchEvent(new Event(evt, { bubbles: true })));
        return el.value === val;
      }`, matchedValue);
    } catch {
      return false;
    }
  }

  private async dispatchEvents(locator: Locator): Promise<void> {
    try {
      await locator.dispatchEvent("input");
      await locator.dispatchEvent("change");
      await locator.evaluate("el => el.dispatchEvent(new Event('blur', { bubbles: true }))");
    } catch {}
  }

  private async enableBlackout(page: Page): Promise<void> {
    try {
      for (const frame of page.frames()) {
        try {
          await frame.addStyleTag({
            content: `
              input[autocomplete*="cc-"],
              input[name*="card"], input[name*="Card"],
              input[name*="expir"], input[name*="cvc"], input[name*="cvv"],
              input[data-elements-stable-field-name],
              input.__PrivateStripeElement,
              input[name="cardnumber"], input[name="cc-exp"],
              input[name="security_code"], input[name="card_number"],
              input[name="card_expiry"], input[name="card_cvc"] {
                -webkit-text-security: disc !important;
                color: transparent !important;
                text-shadow: 0 0 8px rgba(0,0,0,0.5) !important;
              }
            `,
          });
        } catch {}
      }
    } catch {}
  }

  private loadBillingFromEnv(): BillingInfo {
    return {
      firstName: (process.env.POP_BILLING_FIRST_NAME ?? "").trim(),
      lastName: (process.env.POP_BILLING_LAST_NAME ?? "").trim(),
      street: (process.env.POP_BILLING_STREET ?? "").trim(),
      city: (process.env.POP_BILLING_CITY ?? "").trim(),
      state: (process.env.POP_BILLING_STATE ?? "").trim(),
      country: (process.env.POP_BILLING_COUNTRY ?? "").trim(),
      zip: (process.env.POP_BILLING_ZIP ?? "").trim(),
      email: (process.env.POP_BILLING_EMAIL ?? "").trim(),
      phone: (process.env.POP_BILLING_PHONE ?? "").trim(),
      phoneCountryCode: (process.env.POP_BILLING_PHONE_COUNTRY_CODE ?? "").trim(),
    };
  }
}
