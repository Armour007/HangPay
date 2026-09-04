/**
 * Nova Gear — Demo Merchant Catalog for Razorpay AI Buildathon Track 01
 * 
 * A fictional merchant to demonstrate end-to-end AI buyer → merchant → HangPay → Razorpay flow.
 * HangPay remains the security layer; Nova Gear is the demo merchant.
 */

export interface DemoProduct {
  id: string;
  name: string;
  price: number; // in INR (paise will be calculated)
  currency: "INR";
  description: string;
}

export interface DemoMerchant {
  id: string;
  name: string;
  webhookSecret: string;
  products: readonly DemoProduct[];
}

export const NOVA_GEAR_MERCHANT: DemoMerchant = {
  id: "nova-gear-001",
  name: "Nova Gear",
  webhookSecret: process.env.HANGPAY_NOVA_GEAR_WEBHOOK_SECRET ?? "",
  products: [
    {
      id: "safety-hoodie",
      name: "AI Safety Hoodie",
      price: 1499, // ₹1,499
      currency: "INR",
      description: "Premium cotton hoodie with 'AI Safety First' embroidery. Unisex, sizes S-XXL.",
    },
    {
      id: "desk-kit",
      name: "Developer Desk Kit",
      price: 899, // ₹899
      currency: "INR",
      description: "Curated desk essentials: cable organizer, wrist rest, monitor riser, cable ties.",
    },
    {
      id: "sticker-pack",
      name: "Sticker Pack",
      price: 199, // ₹199
      currency: "INR",
      description: "10 vinyl stickers: AI safety, Rust, TypeScript, Razorpay, HangPay logos.",
    },
  ] as const,
} as const;

export function getProductById(productId: string): DemoProduct | undefined {
  return NOVA_GEAR_MERCHANT.products.find((p) => p.id === productId);
}

export function getAllProducts(): readonly DemoProduct[] {
  return NOVA_GEAR_MERCHANT.products;
}

export function getMerchantName(): string {
  return NOVA_GEAR_MERCHANT.name;
}

export function getMerchantId(): string {
  return NOVA_GEAR_MERCHANT.id;
}