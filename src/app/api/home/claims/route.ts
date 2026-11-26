import { getHomeClaims } from "@/lib/shop/home";
import { apiError, apiSuccess } from "@/lib/utils";

/** Live like the shop home page (force-dynamic, revalidate 0). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public homepage claims for the Android app: the same deal %, deal count,
 * store count, advertised coupon and delivery/support facts the website home shows.
 */
export async function GET() {
  try {
    const claims = await getHomeClaims();
    return apiSuccess({
      maxDiscount: claims.maxDiscount,
      dealCount: claims.dealCount,
      storeCount: claims.storeCount,
      coupon: claims.coupon,
      site: {
        freeDeliveryThreshold: claims.site.freeDeliveryThreshold,
        ratePerKm: claims.site.ratePerKm,
        whatsapp: claims.site.whatsapp,
        phone: claims.site.phone,
        email: claims.site.email,
      },
    });
  } catch {
    return apiError("Could not load home info", 500);
  }
}
