import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toNumber } from "@/lib/utils";
import { buildProductSearchWhere, relevanceScore } from "@/lib/search/product-search";
import { LIVE_PRODUCT_WHERE, inStockWhere } from "@/lib/shop/catalog";
import { expandToken, tokenizeQuery } from "@/lib/search/synonyms";

export const dynamic = "force-dynamic";

/**
 * Header search suggestions (QA R1 / SHOP-02): only ACTIVE, in-stock products from
 * APPROVED stores — the same matching as the product list — with price and photo.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
    if (!q || q.length < 2) {
      return apiSuccess({ suggestions: [], categories: [] });
    }
    const search = buildProductSearchWhere(q);
    if (!search) return apiSuccess({ suggestions: [], categories: [] });

    const candidates = await prisma.product.findMany({
      where: { AND: [LIVE_PRODUCT_WHERE, inStockWhere(), search] },
      select: {
        id: true,
        name: true,
        slug: true,
        urduName: true,
        tags: true,
        unit: true,
        price: true,
        salePrice: true,
        isOrganic: true,
        isSeasonal: true,
        soldQuantity: true,
        images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        category: { select: { name: true } },
        store: { select: { name: true } },
      },
      orderBy: { soldQuantity: "desc" },
      take: 40,
    });

    const ranked = candidates
      .map((p) => ({ p, score: relevanceScore(p, q) }))
      .sort((a, b) => b.score - a.score || b.p.soldQuantity - a.p.soldQuantity)
      .slice(0, 8)
      .map(({ p }) => {
        const price = toNumber(p.price);
        const sale = p.salePrice != null ? toNumber(p.salePrice) : null;
        return {
          type: "product" as const,
          id: p.id,
          name: p.name,
          slug: p.slug,
          image: p.images[0]?.url || null,
          unit: p.unit,
          price,
          salePrice: sale != null && sale < price ? sale : null,
          storeName: p.store?.name || null,
        };
      });

    const words = tokenizeQuery(q).flatMap((t) => expandToken(t)).filter((w) => w.length >= 3);
    const categories = words.length
      ? await prisma.category.findMany({
          where: {
            isActive: true,
            products: { some: LIVE_PRODUCT_WHERE },
            OR: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
          },
          select: { id: true, name: true, slug: true },
          take: 3,
        })
      : [];

    return apiSuccess({
      suggestions: ranked,
      categories: categories.map((c) => ({ type: "category", ...c })),
    });
  } catch (e) {
    console.error("[api/search]", e);
    return apiError("Search failed", 500);
  }
}
