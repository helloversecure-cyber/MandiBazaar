import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { normalizePkMobile, normalizePkPhone } from "@/lib/validators/pk";

/**
 * Public business facts shown in the shop (header strip, footer, contact page,
 * homepage claims). Read from StoreSettings so the shop never promises something
 * the checkout doesn't do (QA A3 / P8).
 */
export type SiteInfo = {
  businessName: string;
  email: string;
  /** Valid Pakistani phone (digits) or null when the saved one is a placeholder like "042-111-MANDI". */
  phone: string | null;
  /** Mobile number usable for WhatsApp (03XXXXXXXXX) or null. */
  whatsapp: string | null;
  address: string;
  /** Same rule as the delivery-fee calculator: saved threshold or Rs. 5,000. */
  freeDeliveryThreshold: number;
  ratePerKm: number;
  minimumOrderAmount: number;
};

export const DEFAULT_SITE_INFO: SiteInfo = {
  businessName: "MandiBazaar",
  email: "hello@mandibazaar.pk",
  phone: null,
  whatsapp: null,
  address: "Lahore, Pakistan",
  freeDeliveryThreshold: 5000,
  ratePerKm: 10,
  minimumOrderAmount: 0,
};

function socialWhatsapp(social: unknown): string | null {
  if (!social || typeof social !== "object") return null;
  const s = social as Record<string, unknown>;
  const raw = s.whatsapp ?? s.whatsApp ?? s.WhatsApp;
  return typeof raw === "string" ? normalizePkMobile(raw.replace(/^https?:\/\/wa\.me\//, "")) : null;
}

export async function getSiteInfo(): Promise<SiteInfo> {
  try {
    const s = await prisma.storeSettings.findFirst({
      select: {
        businessName: true,
        email: true,
        phone: true,
        address: true,
        freeDeliveryThreshold: true,
        deliveryRatePerKm: true,
        minimumOrderAmount: true,
        socialLinks: true,
      },
    });
    if (!s) return DEFAULT_SITE_INFO;
    const phone = normalizePkPhone(s.phone || "");
    const whatsapp = socialWhatsapp(s.socialLinks) || normalizePkMobile(s.phone || "");
    return {
      businessName: s.businessName || DEFAULT_SITE_INFO.businessName,
      email: (s.email || "").trim() || DEFAULT_SITE_INFO.email,
      phone,
      whatsapp,
      address: (s.address || "").trim() || DEFAULT_SITE_INFO.address,
      freeDeliveryThreshold: s.freeDeliveryThreshold ? toNumber(s.freeDeliveryThreshold) : 5000,
      ratePerKm: toNumber(s.deliveryRatePerKm ?? 10),
      minimumOrderAmount: toNumber(s.minimumOrderAmount ?? 0),
    };
  } catch {
    return DEFAULT_SITE_INFO;
  }
}

/** "03001234567" → "0300 1234567"; landlines/UAN shown as saved digits. */
export function formatPhone(digits: string): string {
  if (/^03\d{9}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return digits;
}

/** wa.me link for a 03XXXXXXXXX mobile. */
export function whatsappLink(mobile: string): string {
  return `https://wa.me/92${mobile.slice(1)}`;
}

export function rupees(n: number): string {
  return `Rs. ${Math.round(n).toLocaleString("en-PK")}`;
}
