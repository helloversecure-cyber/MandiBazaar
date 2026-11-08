import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { discountPercent, toNumber } from "@/lib/utils";
import { buildProductSearchWhere, relevanceScore } from "@/lib/search/product-search";
import { buildVocabulary, suggestCorrection } from "@/lib/search/synonyms";
import type { ProductCardData } from "@/components/products/ProductCard";

/**
 * Shared shop catalogue queries (server only).
 * One place for "what can a shopper see/buy", product-card data (real stock + real
 * ratings) and the product list used by /products, search, deals and store pages.
 */

/** Only ACTIVE products from APPROVED stores are visible in the shop. */
export const LIVE_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  status: "ACTIVE",
  store: { status: "APPROVED" },
};

/** stockQuantity − reservedStock > 0 */
export function inStockWhere(): Prisma.ProductWhereInput {
  return { stockQuantity: { gt: prisma.product.fields.reservedStock } };
}

/** A real discount: salePrice set AND lower than price. */
export function realDealWhere(): Prisma.ProductWhereInput {
  return { salePrice: { not: null, lt: prisma.product.fields.price } };
}

export const CARD_INCLUDE = {
  images: { orderBy: { sortOrder: "asc" as const }, take: 2 },
  store: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } },
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type CardRow = {
  id: string;
  name: string;
  slug: string;
  sku?: string;
  shortDescription: string | null;
  price: unknown;
  salePrice: unknown;
  unit: string;
  stockQuantity: number;
  reservedStock: number;
  status?: string;
  isOrganic: boolean;
  isFarmProduct: boolean;
  freeDelivery?: boolean | null;
  isFeatured?: boolean;
  isBestSeller?: boolean;
  isNewArrival?: boolean;
  isSeasonal?: boolean;
  images?: { url: string; alt?: string | null }[];
  store?: { id?: string; name: string; slug: string; logoUrl?: string | null; status?: string } | null;
  category?: { id: string; name: string; slug: string } | null;
};

export type Rating = { avg: number; count: number };

/** Average rating + count from APPROVED reviews, one grouped query for many products. */
export async function getRatings(productIds: string[]): Promise<Map<string, Rating>> {
  const map = new Map<string, Rating>();
  const ids = Array.from(new Set(productIds)).filter(Boolean);
  if (!ids.length) return map;
  try {
    const rows = await prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, status: "APPROVED" },
      _avg: { rating: true },
      _count: { _all: true },
    });
    for (const r of rows) {
      const count = r._count._all;
      if (count > 0 && r._avg.rating != null) {
        map.set(r.productId, { avg: Math.round(r._avg.rating * 10) / 10, count });
      }
    }
  } catch {
    // Ratings are decoration — never fail a page because of them.
  }
  return map;
}

export type ShopProductCard = ProductCardData & {
  sku?: string;
  discountPercent: number;
  isFeatured?: boolean;
  isBestSeller?: boolean;
  isNewArrival?: boolean;
  isSeasonal?: boolean;
  category?: { id: string; name: string; slug: string } | null;
};

export function toCardData(p: CardRow, ratings?: Map<string, Rating>): ShopProductCard {
  const price = toNumber(p.price);
  const salePrice = p.salePrice != null ? toNumber(p.salePrice) : null;
  const rating = ratings?.get(p.id);
  const live =
    (p.status == null || p.status === "ACTIVE") &&
    (p.store?.status == null || p.store.status === "APPROVED");
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    shortDescription: p.shortDescription,
    price,
    salePrice,
    discountPercent: discountPercent(price, salePrice),
    unit: p.unit,
    stockQuantity: p.stockQuantity,
    reservedStock: p.reservedStock,
    availableStock: Math.max(0, p.stockQuantity - p.reservedStock),
    unavailable: !live,
    isOrganic: p.isOrganic,
    isFarmProduct: p.isFarmProduct,
    freeDelivery: Boolean(p.freeDelivery),
    isFeatured: p.isFeatured,
    isBestSeller: p.isBestSeller,
    isNewArrival: p.isNewArrival,
    isSeasonal: p.isSeasonal,
    images: p.images || [],
    category: p.category ?? null,
    store: p.store ? { id: p.store.id, name: p.store.name, slug: p.store.slug, logoUrl: p.store.logoUrl ?? null } : null,
    avgRating: rating?.avg ?? null,
    reviewCount: rating?.count ?? 0,
  };
}

/** Rows → cards with ratings (one extra grouped query). */
export async function toCards(rows: CardRow[]): Promise<ShopProductCard[]> {
  const ratings = await getRatings(rows.map((r) => r.id));
  return rows.map((r) => toCardData(r, ratings));
}

export const SHOP_PAGE_SIZE = 20;

export type ListContext = {
  q: string | null;
  store: { id: string; name: string; slug: string; logoUrl: string | null; city: string | null } | null;
  storeNotFound: boolean;
  category: { id: string; name: string; slug: string } | null;
  didYouMean: string | null;
  priceSwapped: boolean;
  deals: boolean;
};

export type ListResult = {
  items: (ShopProductCard & { variants?: unknown[] })[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  context: ListContext;
};

function parseMoney(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/** Candidate cap for in-memory sorts (relevance / biggest discount). */
const MEMORY_SORT_CAP = 1000;

/**
 * Product list for /api/products (All products, Search, Deals, Store pages).
 * Query params: q, category, store, storeId, organic, available, seasonal, featured,
 * bestSeller, newArrival, unit, minPrice, maxPrice, sort, page, limit.
 */
export async function listProducts(
  sp: URLSearchParams,
  opts: { includeVariants?: boolean } = {}
): Promise<ListResult> {
  const rawPage = parseInt(sp.get("page") || "1", 10);
  const rawLimit = parseInt(sp.get("limit") || String(SHOP_PAGE_SIZE), 10);
  let page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : SHOP_PAGE_SIZE;

  const q = sp.get("q")?.trim().slice(0, 100) || null;
  const storeSlug = sp.get("store")?.trim() || null;
  const storeId = sp.get("storeId")?.trim() || null;
  const categoryKey = sp.get("category")?.trim() || null;
  const sortParam = sp.get("sort") || "";
  const sort = sortParam || (q ? "relevance" : "newest");

  const context: ListContext = {
    q,
    store: null,
    storeNotFound: false,
    category: null,
    didYouMean: null,
    priceSwapped: false,
    deals: sort === "discount",
  };

  const and: Prisma.ProductWhereInput[] = [LIVE_PRODUCT_WHERE];

  if (storeSlug || storeId) {
    const store = await prisma.store.findFirst({
      where: { status: "APPROVED", ...(storeSlug ? { slug: storeSlug } : {}), ...(storeId ? { id: storeId } : {}) },
      select: { id: true, name: true, slug: true, logoUrl: true, city: true },
    });
    if (!store) {
      context.storeNotFound = true;
      return { items: [], pagination: { page: 1, limit, total: 0, totalPages: 1 }, context };
    }
    context.store = store;
    and.push({ storeId: store.id });
  }

  if (categoryKey) {
    const cat = await prisma.category.findFirst({
      where: { OR: [{ slug: categoryKey }, { id: categoryKey }] },
      select: { id: true, name: true, slug: true },
    });
    context.category = cat;
    and.push({ categoryId: cat?.id ?? "__none__" });
  }

  const search = buildProductSearchWhere(q);
  if (search) and.push(search);

  if (sp.get("organic") === "true") and.push({ isOrganic: true });
  if (sp.get("featured") === "true") and.push({ isFeatured: true });
  if (sp.get("bestSeller") === "true") and.push({ isBestSeller: true });
  if (sp.get("newArrival") === "true") and.push({ isNewArrival: true });
  if (sp.get("seasonal") === "true") and.push({ isSeasonal: true });
  const unit = sp.get("unit");
  if (unit) and.push({ unit });
  if (sp.get("available") === "true") and.push(inStockWhere());
  if (sort === "discount") and.push(realDealWhere());

  // Price range on the price the shopper actually pays (sale price when it is lower).
  let minPrice = parseMoney(sp.get("minPrice"));
  let maxPrice = parseMoney(sp.get("maxPrice"));
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
    context.priceSwapped = true;
  }
  if (minPrice != null || maxPrice != null) {
    const range = {
      ...(minPrice != null ? { gte: minPrice } : {}),
      ...(maxPrice != null ? { lte: maxPrice } : {}),
    };
    and.push({
      OR: [
        { salePrice: null, price: range },
        { salePrice: { ...range, lt: prisma.product.fields.price } },
        { salePrice: { gte: prisma.product.fields.price }, price: range },
      ],
    });
  }

  const where: Prisma.ProductWhereInput = { AND: and };
  const include = {
    ...CARD_INCLUDE,
    ...(opts.includeVariants
      ? { variants: { where: { isActive: true }, orderBy: { price: "asc" as const } } }
      : {}),
  };

  const total = await prisma.product.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (page > totalPages) page = totalPages;
  const skip = (page - 1) * limit;

  let rows: Prisma.ProductGetPayload<{ include: typeof include }>[] = [];

  if (total > 0 && (sort === "relevance" || sort === "discount") && total <= MEMORY_SORT_CAP) {
    // Sorts Postgres can't do through Prisma: rank in memory, then load just this page.
    const candidates = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        urduName: true,
        tags: true,
        shortDescription: true,
        description: true,
        isOrganic: true,
        isSeasonal: true,
        price: true,
        salePrice: true,
        soldQuantity: true,
        createdAt: true,
        category: { select: { name: true } },
        store: { select: { name: true } },
      },
    });
    const scored = candidates.map((c) => ({
      id: c.id,
      score:
        sort === "relevance"
          ? relevanceScore(c, q || "")
          : discountPercent(toNumber(c.price), c.salePrice != null ? toNumber(c.salePrice) : null),
      sold: c.soldQuantity,
      created: c.createdAt.getTime(),
    }));
    scored.sort((a, b) => b.score - a.score || b.sold - a.sold || b.created - a.created);
    const pageIds = scored.slice(skip, skip + limit).map((s) => s.id);
    const found = await prisma.product.findMany({ where: { id: { in: pageIds } }, include });
    const byId = new Map(found.map((f) => [f.id, f]));
    rows = pageIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
  } else if (total > 0) {
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
    switch (sort) {
      case "price_asc":
        orderBy.push({ price: "asc" });
        break;
      case "price_desc":
        orderBy.push({ price: "desc" });
        break;
      case "best_selling":
      case "popular":
        orderBy.push({ soldQuantity: "desc" });
        break;
      case "discount":
        orderBy.push({ salePrice: "asc" });
        break;
      case "relevance":
        orderBy.push({ soldQuantity: "desc" });
        break;
      default:
        orderBy.push({ createdAt: "desc" });
    }
    orderBy.push({ id: "asc" }); // stable pages
    rows = await prisma.product.findMany({ where, include, orderBy, skip, take: limit });
  }

  const ratings = await getRatings(rows.map((r) => r.id));
  const items = rows.map((p) => {
    const card = toCardData(p, ratings);
    if (!opts.includeVariants || !("variants" in p)) return card;
    const variants = (p as unknown as { variants: { id: string; name: string; unit: string; price: unknown; salePrice: unknown; stockQuantity: number; reservedStock: number }[] }).variants;
    return {
      ...card,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name,
        unit: v.unit,
        price: toNumber(v.price),
        salePrice: v.salePrice != null ? toNumber(v.salePrice) : null,
        stockQuantity: v.stockQuantity,
        availableStock: v.stockQuantity - v.reservedStock,
      })),
    };
  });

  if (q && total === 0) context.didYouMean = await didYouMean(q);

  return { items, pagination: { page, limit, total, totalPages }, context };
}

/** "Did you mean daal?" from live product, category and store names. */
export async function didYouMean(q: string): Promise<string | null> {
  try {
    const [products, categories, stores] = await Promise.all([
      prisma.product.findMany({ where: LIVE_PRODUCT_WHERE, select: { name: true, urduName: true }, take: 3000 }),
      prisma.category.findMany({ where: { isActive: true }, select: { name: true } }),
      prisma.store.findMany({ where: { status: "APPROVED" }, select: { name: true } }),
    ]);
    const names = [
      ...products.flatMap((p) => [p.name, p.urduName || ""]),
      ...categories.map((c) => c.name),
      ...stores.map((s) => s.name),
    ];
    return suggestCorrection(q, buildVocabulary(names));
  } catch {
    return null;
  }
}
