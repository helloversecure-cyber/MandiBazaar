import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toNumber, discountPercent } from "@/lib/utils";
import { CARD_INCLUDE, LIVE_PRODUCT_WHERE, getRatings, toCardData } from "@/lib/shop/catalog";
import { getSiteInfo } from "@/lib/shop/site-info";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const product = await prisma.product.findFirst({
      where: {
        OR: [{ slug: params.slug }, { id: params.slug }],
        status: { in: ["ACTIVE", "INACTIVE"] },
        store: { status: "APPROVED" },
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            city: true,
          },
        },
        images: { orderBy: { sortOrder: "asc" } },
        variants: { where: { isActive: true }, orderBy: { price: "asc" } },
        reviews: {
          where: { status: "APPROVED" },
          include: { user: { select: { fullName: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!product || product.status === "INACTIVE") {
      return apiError("This product is currently unavailable", 404);
    }

    const price = toNumber(product.price);
    const salePrice = product.salePrice != null ? toNumber(product.salePrice) : null;

    const [ratingAgg, relatedRows, site] = await Promise.all([
      prisma.review.aggregate({
        where: { productId: product.id, status: "APPROVED" },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      prisma.product.findMany({
        where: {
          AND: [LIVE_PRODUCT_WHERE, { categoryId: product.categoryId }, { id: { not: product.id } }],
        },
        include: CARD_INCLUDE,
        orderBy: [{ soldQuantity: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      getSiteInfo(),
    ]);
    const relatedRatings = await getRatings(relatedRows.map((r) => r.id));

    // Never expose store-internal / moderation fields to shoppers.
    const {
      costPrice: _costPrice,
      pendingChanges: _pendingChanges,
      pendingChangesAt: _pendingChangesAt,
      moderationNote: _moderationNote,
      reviewBasePrice: _reviewBasePrice,
      ...publicProduct
    } = product;
    void _costPrice;
    void _pendingChanges;
    void _pendingChangesAt;
    void _moderationNote;
    void _reviewBasePrice;

    const ratingCount = ratingAgg._count._all;
    return apiSuccess({
      ...publicProduct,
      price,
      salePrice,
      weight: product.weight != null ? toNumber(product.weight) : null,
      discountPercent: discountPercent(price, salePrice),
      availableStock: Math.max(0, product.stockQuantity - product.reservedStock),
      avgRating:
        ratingCount > 0 && ratingAgg._avg.rating != null
          ? Math.round(ratingAgg._avg.rating * 10) / 10
          : null,
      reviewCount: ratingCount,
      variants: product.variants.map((v) => ({
        ...v,
        price: toNumber(v.price),
        salePrice: v.salePrice != null ? toNumber(v.salePrice) : null,
        availableStock: Math.max(0, v.stockQuantity - v.reservedStock),
      })),
      related: relatedRows.map((r) => toCardData(r, relatedRatings)),
      delivery: {
        ratePerKm: site.ratePerKm,
        freeDeliveryThreshold: site.freeDeliveryThreshold,
      },
    });
  } catch (e) {
    console.error("[api/products/slug]", e);
    return apiError("Failed to load product", 500);
  }
}
