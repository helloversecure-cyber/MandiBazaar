import { getHotCategoryBanners } from "@/lib/shop/home";
import { apiError, apiSuccess } from "@/lib/utils";

/** Live like the shop home page (force-dynamic, revalidate 0). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Card colours in the order the website's PromoBannerGrid cycles them
 * (emerald→teal, orange→red, sky→teal), as hex for the app.
 */
const GRADIENTS = [
  { from: "#059669", via: "#14b8a6" },
  { from: "#ea580c", via: "#ef4444" },
  { from: "#0369a1", via: "#0d9488" },
] as const;

/** Public "Hot categories" cards for the Android app — the same banners the website home shows. */
export async function GET() {
  try {
    const banners = await getHotCategoryBanners();
    const items = banners.map((b, i) => ({
      ...b,
      categorySlug: new URL(b.href, "http://x").searchParams.get("category") || "",
      subtitle: b.badge,
      gradient: GRADIENTS[i % GRADIENTS.length],
    }));
    return apiSuccess({ items });
  } catch {
    return apiError("Could not load hot categories", 500);
  }
}
