import { z } from "zod";
import { buildCartQuote, priceGuestCart } from "@/lib/orders/cart-quote";
import { apiError, apiSuccess, apiZodError } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Public quote for the guest (not signed-in) cart: live prices, available stock,
 * store status, delivery message, minimum order, free-delivery progress and the
 * coupon reason — the same rules the signed-in cart uses (QA E5, U2, U4, E6).
 */
const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        variantId: z.string().max(64).optional().nullable(),
        quantity: z.number().int().min(1).max(1000),
      })
    )
    .max(100),
  coupon: z.string().trim().max(30).optional(),
});

export async function POST(req: Request) {
  const rl = rateLimit(`cart-quote:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return apiError("Too many requests. Please wait a moment.", 429);
  try {
    const body = await req.json().catch(() => null);
    const parsed = quoteSchema.safeParse(body);
    if (!parsed.success) return apiZodError(parsed.error);

    const priced = await priceGuestCart(parsed.data.items);
    const quote = await buildCartQuote({
      itemCount: priced.items.length,
      subtotal: priced.subtotal,
      stores: priced.stores,
      allProductsFreeDelivery: priced.allProductsFreeDelivery,
      stockIssues: priced.stockIssues,
      couponCode: parsed.data.coupon,
      userId: null,
      destination: null,
    });
    return apiSuccess({ items: priced.items, missing: priced.missing, ...quote });
  } catch (e) {
    console.error("[cart quote]", e);
    return apiError("Failed to load cart", 500);
  }
}
