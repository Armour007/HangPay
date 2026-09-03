/**
 * Known third-party payment processors.
 *
 * When a checkout page redirects to one of these domains, the TOCTOU domain
 * guard treats it as a pass — the vendor intent was already approved by the
 * policy gate, and these processors are independently trusted infrastructure.
 *
 * Users can extend via POP_ALLOWED_PAYMENT_PROCESSORS in .env.
 */

export const KNOWN_PAYMENT_PROCESSORS = new Set([
  // Stripe
  "stripe.com",
  "js.stripe.com",
  // Zoho
  "zohosecurepay.com",
  // Square
  "squareup.com",
  "square.com",
  // PayPal / Braintree
  "paypal.com",
  "braintreegateway.com",
  // Adyen
  "adyen.com",
  // Checkout.com
  "checkout.com",
  // Paddle
  "paddle.com",
  // FastSpring
  "fastspring.com",
  // Gumroad
  "gumroad.com",
  // Recurly / Chargebee
  "recurly.com",
  "chargebee.com",
  // Event & ticketing
  "eventbrite.com",
  "ti.to",
  "lu.ma",
  "universe.com",
  // Other
  "2checkout.com",
  "authorize.net",
]);
