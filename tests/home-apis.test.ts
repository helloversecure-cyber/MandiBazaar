/**
 * GET /api/home/claims and GET /api/home/hot-categories — the app home shows
 * exactly what the website home computes (same lib functions as src/app/(shop)/page.tsx).
 */
import { beforeAll, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { getHomeClaims, getHotCategoryBanners } from "@/lib/shop/home";
import { GET as getClaims } from "@/app/api/home/claims/route";
import { GET as getHot } from "@/app/api/home/hot-categories/route";

let fx: Fixtures;
let n = 0;

async function product(
  storeId: string,
  categoryId: string,
  opts: { price: number; salePrice?: number; sold?: number; status?: "ACTIVE" | "DRAFT"; image?: string }
) {
  n++;
  return prisma.product.create({
    data: {
      storeId,
      categoryId,
      name: `TEST P${n}`,
      slug: `test-p${n}`,
      sku: `SKU-${n}`,
      unit: "kg",
      price: opts.price,
      salePrice: opts.salePrice ?? null,
      soldQuantity: opts.sold ?? 0,
      stockQuantity: 50,
      status: opts.status ?? "ACTIVE",
      images: opts.image ? { create: { url: opts.image } } : undefined,
    },
  });
}

describeDb("home APIs", () => {
  beforeAll(async () => {
    await resetDb();
    fx = await seedStandardFixtures();
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const pharmacy = await prisma.category.update({
      where: { slug: "pharmacy" },
      data: { imageUrl: "https://img.test/pharmacy.jpg" },
    });
    const fruit = await prisma.category.create({ data: { name: "Fruit", slug: "fruit" } });

    // Deals: 25% and 40% off at approved stores; a 90% deal at a suspended store and a draft must not count.
    await product(fx.S1.id, grocery.id, { price: 200, salePrice: 150, sold: 12, image: "https://img.test/atta.jpg" });
    await product(fx.S2.id, grocery.id, { price: 500, salePrice: 300 });
    await product(fx.S5.id, grocery.id, { price: 100, salePrice: 10, sold: 100 });
    await product(fx.S1.id, grocery.id, { price: 100, salePrice: 10, status: "DRAFT" });
    // Hot categories: grocery 12 sold, pharmacy 7 (category image), fruit 3 (below the 5-unit minimum).
    await product(fx.S4.id, pharmacy.id, { price: 80, sold: 7 });
    await product(fx.S1.id, fruit.id, { price: 50, sold: 3, image: "https://img.test/apple.jpg" });

    await prisma.coupon.create({
      data: {
        code: "save10", type: "PERCENTAGE", value: 10, firstOrderOnly: true,
        startDate: new Date(Date.now() - 86_400_000), expiryDate: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.storeSettings.updateMany({
      data: { freeDeliveryThreshold: 3000, deliveryRatePerKm: 15, email: "help@test.local", phone: "03001112222" },
    });
  });

  it("claims: same values as the home page, in the app shape", async () => {
    const res = await getClaims();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        maxDiscount: 40,
        dealCount: 2,
        storeCount: 4,
        coupon: { code: "SAVE10", firstOrderOnly: true },
        site: {
          freeDeliveryThreshold: 3000,
          ratePerKm: 15,
          whatsapp: "03001112222",
          phone: "03001112222",
          email: "help@test.local",
        },
      },
    });
    const page = await getHomeClaims();
    expect(body.data).toMatchObject({
      maxDiscount: page.maxDiscount,
      dealCount: page.dealCount,
      storeCount: page.storeCount,
      coupon: page.coupon,
    });
    expect(body.data.site.freeDeliveryThreshold).toBe(page.site.freeDeliveryThreshold);
    // Only public facts — no business address, minimum order, or other settings.
    expect(Object.keys(body.data.site).sort()).toEqual(["email", "freeDeliveryThreshold", "phone", "ratePerKm", "whatsapp"]);
  });

  it("claims: coupon is null once used up or expired", async () => {
    await prisma.coupon.update({ where: { code: "save10" }, data: { usageLimit: 5, usedCount: 5 } });
    expect((await (await getClaims()).json()).data.coupon).toBeNull();
    await prisma.coupon.update({
      where: { code: "save10" },
      data: { usageLimit: null, expiryDate: new Date(Date.now() - 1000) },
    });
    expect((await (await getClaims()).json()).data.coupon).toBeNull();
  });

  it("hot categories: same banners as the home page, plus slug, subtitle and colours", async () => {
    const res = await getHot();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const page = await getHotCategoryBanners();
    // Suspended store's 100 sales are ignored; fruit is under the minimum.
    expect(page.map((b) => b.title)).toEqual(["Grocery", "Pharmacy"]);
    expect(body.data.items).toEqual([
      {
        ...page[0],
        href: "/products?category=grocery",
        image: "https://img.test/atta.jpg",
        title: "Grocery",
        badge: "TOP SELLING",
        unitsSold: 12,
        categorySlug: "grocery",
        subtitle: "TOP SELLING",
        gradient: { from: "#059669", via: "#14b8a6" },
      },
      {
        ...page[1],
        href: "/products?category=pharmacy",
        image: "https://img.test/pharmacy.jpg",
        title: "Pharmacy",
        badge: "TRENDING",
        unitsSold: 7,
        categorySlug: "pharmacy",
        subtitle: "TRENDING",
        gradient: { from: "#ea580c", via: "#ef4444" },
      },
    ]);
  });
});
