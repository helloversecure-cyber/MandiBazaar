import Link from "next/link";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { DealsTicker } from "@/components/home/DealsTicker";
import {
  HeroCarousel,
  type HeroSlideData,
} from "@/components/home/HeroCarousel";
import { CategoryScroll } from "@/components/home/CategoryScroll";
import { ServiceBar } from "@/components/home/ServiceBar";
import { ProductScrollRail, ProductGridSection } from "@/components/home/ProductRails";
import {
  PromoBannerGrid,
  FullWidthBanner,
  type PromoBanner,
} from "@/components/home/PromoBanners";
import type { ProductCardData } from "@/components/products/ProductCard";
import { getRatings, type Rating } from "@/lib/shop/catalog";
import { formatPhone, getSiteInfo, DEFAULT_SITE_INFO } from "@/lib/shop/site-info";

/** Always fetch live catalog — never serve a stale empty/full homepage. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Specialty rails need enough real products — never pad one item into every section. */
const MIN_SECTION = 4;
const MIN_FLASH = 3;
const HOT_CATEGORY_MIN_UNITS = 5;

const productInclude = {
  images: { take: 1, orderBy: { sortOrder: "asc" as const } },
  store: { select: { id: true, name: true, slug: true } },
};

const activeApproved = {
  status: "ACTIVE" as const,
  store: { status: "APPROVED" as const },
};

type DbProduct = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  price: unknown;
  salePrice: unknown;
  unit: string;
  stockQuantity: number;
  reservedStock: number;
  isOrganic: boolean;
  isFarmProduct: boolean;
  freeDelivery?: boolean;
  images: { url: string }[];
  store?: { id?: string; name: string; slug: string } | null;
};

function mapProduct(p: DbProduct, ratings?: Map<string, Rating>): ProductCardData {
  const rating = ratings?.get(p.id);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    price: toNumber(p.price),
    salePrice: p.salePrice != null ? toNumber(p.salePrice) : null,
    unit: p.unit,
    stockQuantity: p.stockQuantity,
    reservedStock: p.reservedStock,
    availableStock: Math.max(0, p.stockQuantity - p.reservedStock),
    avgRating: rating?.avg ?? null,
    reviewCount: rating?.count ?? 0,
    isOrganic: p.isOrganic,
    isFarmProduct: p.isFarmProduct,
    freeDelivery: Boolean(p.freeDelivery),
    images: p.images,
    store: p.store || null,
  };
}

function takeIfEnough(
  items: ProductCardData[],
  min: number,
  max = 16
): ProductCardData[] {
  if (items.length < min) return [];
  return items.slice(0, max);
}

function hotBadge(rank: number, units: number): string {
  if (rank === 0) return "TOP SELLING";
  if (rank === 1) return "TRENDING";
  return `${units}+ SOLD`;
}

async function getHotCategoryBanners(): Promise<PromoBanner[]> {
  const grouped = await prisma.product.groupBy({
    by: ["categoryId"],
    where: {
      ...activeApproved,
      soldQuantity: { gt: 0 },
    },
    _sum: { soldQuantity: true },
    orderBy: { _sum: { soldQuantity: "desc" } },
    take: 8,
  });

  const qualifying = grouped
    .map((g) => ({
      categoryId: g.categoryId,
      units: g._sum.soldQuantity || 0,
    }))
    .filter((g) => g.units >= HOT_CATEGORY_MIN_UNITS)
    .slice(0, 3);

  if (!qualifying.length) return [];

  const categories = await prisma.category.findMany({
    where: {
      id: { in: qualifying.map((q) => q.categoryId) },
      isActive: true,
    },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const banners: PromoBanner[] = [];
  for (let i = 0; i < qualifying.length; i++) {
    const q = qualifying[i];
    const cat = byId.get(q.categoryId);
    if (!cat) continue;

    let image = cat.imageUrl || "";
    if (!image) {
      const sample = await prisma.product.findFirst({
        where: {
          categoryId: cat.id,
          ...activeApproved,
          images: { some: {} },
        },
        orderBy: { soldQuantity: "desc" },
        include: { images: { take: 1, orderBy: { sortOrder: "asc" } } },
      });
      image = sample?.images[0]?.url || "";
    }
    if (!image) continue;

    banners.push({
      href: `/products?category=${encodeURIComponent(cat.slug)}`,
      image,
      title: cat.name,
      badge: hotBadge(i, q.units),
      unitsSold: q.units,
    });
  }

  return banners;
}

/** Coupon the ticker may advertise (QA A3 / SAVE10 contract): only if it really exists and is usable now. */
const ADVERTISED_COUPON = "SAVE10";

/** Live facts behind every homepage claim (QA A3, N5, P8, M10). */
async function getHomeClaims() {
  const now = new Date();
  const [deals, storeCount, coupon, site] = await Promise.all([
    prisma.product
      .findMany({
        where: { ...activeApproved, salePrice: { not: null, lt: prisma.product.fields.price } },
        select: { price: true, salePrice: true },
      })
      .catch(() => [] as { price: unknown; salePrice: unknown }[]),
    prisma.store.count({ where: { status: "APPROVED" } }).catch(() => 0),
    prisma.coupon
      .findFirst({
        where: {
          code: { equals: ADVERTISED_COUPON, mode: "insensitive" },
          isActive: true,
          startDate: { lte: now },
          expiryDate: { gte: now },
        },
        select: { code: true, firstOrderOnly: true, usageLimit: true, usedCount: true },
      })
      .catch(() => null),
    getSiteInfo().catch(() => DEFAULT_SITE_INFO),
  ]);
  let maxDiscount = 0;
  for (const d of deals) {
    const price = toNumber(d.price);
    const sale = toNumber(d.salePrice);
    if (price > 0 && sale < price) maxDiscount = Math.max(maxDiscount, Math.round(((price - sale) / price) * 100));
  }
  const couponUsable = coupon && (coupon.usageLimit == null || coupon.usedCount < coupon.usageLimit);
  const supportLine = site.whatsapp
    ? `WhatsApp ${formatPhone(site.whatsapp)}`
    : site.phone
      ? formatPhone(site.phone)
      : site.email;
  return {
    maxDiscount,
    dealCount: deals.length,
    storeCount,
    coupon: couponUsable ? { code: coupon.code.toUpperCase(), firstOrderOnly: coupon.firstOrderOnly } : null,
    site,
    supportLine,
  };
}

async function getHomeData() {
  try {
    const [
      flashDeals,
      bestSellers,
      newArrivals,
      featured,
      trendingRows,
      categories,
      allActive,
      heroRows,
      hotCategories,
      catalogCount,
    ] = await Promise.all([
      prisma.product.findMany({
        where: {
          ...activeApproved,
          salePrice: { not: null },
        },
        include: productInclude,
        take: 24,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.product.findMany({
        where: {
          ...activeApproved,
          OR: [{ isBestSeller: true }, { soldQuantity: { gte: 3 } }],
        },
        include: productInclude,
        take: 16,
        orderBy: [{ soldQuantity: "desc" }, { updatedAt: "desc" }],
      }),
      prisma.product.findMany({
        where: { ...activeApproved, isNewArrival: true },
        include: productInclude,
        take: 16,
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.findMany({
        where: { ...activeApproved, isFeatured: true },
        include: productInclude,
        take: 16,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.product.findMany({
        where: { ...activeApproved, soldQuantity: { gt: 0 } },
        include: productInclude,
        take: 16,
        orderBy: [{ soldQuantity: "desc" }, { updatedAt: "desc" }],
      }),
      // Shop by category: active categories with a picture and at least one live product (QA A4).
      prisma.category.findMany({
        where: {
          isActive: true,
          AND: [{ imageUrl: { not: null } }, { NOT: { imageUrl: "" } }],
          products: { some: activeApproved },
        },
        orderBy: { sortOrder: "asc" },
        take: 12,
      }),
      prisma.product.findMany({
        where: activeApproved,
        include: productInclude,
        take: 24,
        orderBy: { createdAt: "desc" },
      }),
      prisma.heroSlide.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        take: 6,
      }),
      getHotCategoryBanners(),
      prisma.product.count({ where: activeApproved }),
    ]);

    const ratings = await getRatings(
      [flashDeals, bestSellers, newArrivals, featured, trendingRows, allActive].flatMap((rows) =>
        rows.map((r) => r.id)
      )
    );
    const map = (p: DbProduct) => mapProduct(p, ratings);

    const realDeals = flashDeals
      .filter((p) => {
        const price = toNumber(p.price);
        const sale = p.salePrice != null ? toNumber(p.salePrice) : null;
        return sale != null && sale < price;
      })
      .map(map);

    const flash = takeIfEnough(realDeals, MIN_FLASH);
    const best = takeIfEnough(bestSellers.map(map), MIN_SECTION);
    const fresh = takeIfEnough(newArrivals.map(map), MIN_SECTION);
    const picks = takeIfEnough(featured.map(map), MIN_SECTION);
    const trending = takeIfEnough(trendingRows.map(map), MIN_SECTION);

    const specialtyCount =
      flash.length + best.length + fresh.length + picks.length + trending.length;

    /** Thin catalog: show products once — do not invent Trending / Picks / etc. */
    const listed =
      specialtyCount === 0 && allActive.length > 0
        ? allActive.map(map)
        : [];

    const heroSlides: HeroSlideData[] = heroRows.map((s) => ({
      id: s.id,
      imageUrl: s.imageUrl,
      tag: s.tag,
      title: s.title,
      sub: s.sub,
      cta: s.cta,
      href: s.href,
      accent: s.accent,
      stat: s.stat,
    }));

    return {
      flashDeals: flash,
      bestSellers: best,
      newArrivals: fresh,
      featured: picks,
      trending,
      listed,
      categories,
      heroSlides,
      hotCategories,
      catalogCount,
      fromDb: true,
    };
  } catch {
    return {
      flashDeals: [],
      bestSellers: [],
      newArrivals: [],
      featured: [],
      trending: [],
      listed: [],
      categories: [],
      heroSlides: [] as HeroSlideData[],
      hotCategories: [] as PromoBanner[],
      catalogCount: 0,
      fromDb: false,
    };
  }
}

export default async function HomePage() {
  const [data, claims] = await Promise.all([getHomeData(), getHomeClaims()]);

  const flash = data.flashDeals;
  const best = data.bestSellers;
  const fresh = data.newArrivals;
  const picks = data.featured;
  const trending = data.trending;
  const listed = data.listed;

  const categories = data.categories;
  const hasAnyProduct =
    data.catalogCount > 0 ||
    flash.length +
      best.length +
      fresh.length +
      picks.length +
      trending.length +
      listed.length >
      0;
  const showMegaSaleBanner = flash.length >= MIN_FLASH;

  return (
    <div className="bg-app">
      <DealsTicker
        maxDiscount={claims.maxDiscount}
        coupon={claims.coupon}
        freeDeliveryThreshold={claims.site.freeDeliveryThreshold}
        storeCount={claims.storeCount}
      />
      <HeroCarousel
        slides={data.heroSlides}
        freeDeliveryThreshold={claims.site.freeDeliveryThreshold}
        maxDiscount={claims.maxDiscount}
        storeCount={claims.storeCount}
        categories={categories.map((c) => ({ name: c.name, slug: c.slug }))}
      />
      {categories.length > 0 && <CategoryScroll categories={categories} />}
      <ServiceBar
        freeDeliveryThreshold={claims.site.freeDeliveryThreshold}
        supportLine={claims.supportLine}
      />

      {!hasAnyProduct && (
        <section className="mx-auto max-w-7xl px-3 py-12 text-center lg:px-4">
          <p className="text-lg font-black text-ink sm:text-xl">
            Marketplace opening soon
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-subtle">
            Products and categories will appear here when stores list them or MandiBazaar adds them.
          </p>
          <Link
            href="/store"
            className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
          >
            Sell on MandiBazaar
          </Link>
        </section>
      )}

      <ProductScrollRail
        title="⚡ Deals"
        href="/products?sort=discount"
        products={flash}
        variant="flash"
      />

      <PromoBannerGrid banners={data.hotCategories} />

      <ProductGridSection
        title="Best Sellers"
        emoji="🔥"
        href="/products?sort=best_selling"
        products={best}
      />

      {showMegaSaleBanner && (
        <FullWidthBanner maxDiscount={claims.maxDiscount} dealCount={claims.dealCount} />
      )}

      <ProductScrollRail
        title="✨ New Arrivals"
        href="/products?sort=newest"
        products={fresh}
        variant="new"
      />

      <ProductGridSection
        title="Top Picks For You"
        emoji="⭐"
        href="/products"
        products={picks}
      />

      <ProductScrollRail
        title="🛒 Trending Now"
        href="/products?sort=popular"
        products={trending}
        variant="default"
      />

      {/* Small catalog: one honest list instead of repeating the same product */}
      <ProductGridSection
        title="Products"
        emoji="🛒"
        href="/products"
        products={listed}
      />

      <section className="mx-auto max-w-7xl px-3 pb-8 lg:px-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="shine-hover relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-emerald-700 to-teal-700 p-6 shadow-xl sm:p-8">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-card/10 blur-2xl" />
            <div className="relative">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-200">
                Store owners
              </p>
              <p className="text-xl font-black text-white sm:text-2xl">
                Sell on MandiBazaar
              </p>
              <p className="mt-1 text-sm text-emerald-100">
                Sign in or create your store — list your products and reach local customers
              </p>
              <div className="mt-4">
                <Link
                  href="/store"
                  className="inline-flex items-center rounded-xl bg-card px-5 py-2.5 text-sm font-black text-brand-700 shadow-lg transition hover:scale-105"
                >
                  Get started →
                </Link>
              </div>
            </div>
          </div>

          <div className="shine-hover relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-700 via-blue-700 to-indigo-800 p-6 shadow-xl sm:p-8">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-card/10 blur-2xl" />
            <div className="relative">
              <p className="text-xs font-black uppercase tracking-widest text-sky-200">
                Home delivery
              </p>
              <p className="mt-1 text-xl font-black text-white sm:text-2xl">
                From local stores to your door
              </p>
              <p className="mt-1 text-sm text-sky-100">
                Free delivery on orders of Rs. {Math.round(claims.site.freeDeliveryThreshold).toLocaleString("en-PK")}+ · otherwise Rs. {Math.round(claims.site.ratePerKm).toLocaleString("en-PK")}/km go + return
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
