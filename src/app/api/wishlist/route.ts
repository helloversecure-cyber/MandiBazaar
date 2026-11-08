import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { CARD_INCLUDE, LIVE_PRODUCT_WHERE, getRatings, toCardData } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

/**
 * Wishlist items with full product-card data (real stock, store, rating) so the
 * wishlist can show "Add to cart" (QA M3 / CART-05). Products that were removed or
 * whose store is no longer live come back with `unavailable: true`.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const idsOnly = new URL(req.url).searchParams.get("ids") === "1";
  if (idsOnly) {
    const rows = await prisma.wishlistItem.findMany({
      where: { userId: session.user.id },
      select: { productId: true },
    });
    return apiSuccess({ productIds: rows.map((r) => r.productId) });
  }
  const items = await prisma.wishlistItem.findMany({
    where: { userId: session.user.id },
    include: { product: { include: CARD_INCLUDE } },
    orderBy: { createdAt: "desc" },
  });
  const ratings = await getRatings(items.map((i) => i.productId));
  return apiSuccess(
    items.map((i) => {
      const card = toCardData(i.product, ratings);
      return {
        id: i.id,
        product: {
          ...card,
          // Older consumers read a single image url.
          image: card.images?.[0]?.url,
        },
      };
    })
  );
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Sign in to save to your wishlist", 401);
  let productId: unknown;
  try {
    ({ productId } = await req.json());
  } catch {
    return apiError("productId required");
  }
  if (typeof productId !== "string" || !productId) return apiError("productId required");

  const product = await prisma.product.findFirst({
    where: { AND: [{ id: productId }, LIVE_PRODUCT_WHERE] },
    select: { id: true },
  });
  if (!product) return apiError("This product is not available", 404);

  const item = await prisma.wishlistItem.upsert({
    where: {
      userId_productId: { userId: session.user.id, productId },
    },
    create: { userId: session.user.id, productId },
    update: {},
  });
  return apiSuccess(item, 201);
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) return apiError("productId required");
  await prisma.wishlistItem.deleteMany({
    where: { userId: session.user.id, productId },
  });
  return apiSuccess({ deleted: true });
}
