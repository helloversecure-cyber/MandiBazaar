import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import type { PromoBanner } from "@/components/home/PromoBanners";
import { formatPhone, getSiteInfo, DEFAULT_SITE_INFO } from "@/lib/shop/site-info";

/**
 * Homepage data shared by the shop home page and the app's home APIs
 * (/api/home/claims, /api/home/hot-categories) so both show the same facts.
 */

/** Live products from approved stores — the only products the shop ever shows. */
export const activeApproved = {
  status: "ACTIVE" as const,
  store: { status: "APPROVED" as const },
};

const HOT_CATEGORY_MIN_UNITS = 5;

function hotBadge(rank: number, units: number): string {
  if (rank === 0) return "TOP SELLING";
  if (rank === 1) return "TRENDING";
  return `${units}+ SOLD`;
}

export async function getHotCategoryBanners(): Promise<PromoBanner[]> {
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
export async function getHomeClaims() {
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

export type HomeClaims = Awaited<ReturnType<typeof getHomeClaims>>;
