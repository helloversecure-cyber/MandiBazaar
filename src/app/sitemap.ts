import { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const STATIC_PAGES: { path: string; priority: number; freq: "daily" | "weekly" | "monthly" }[] = [
  { path: "", priority: 1, freq: "daily" },
  { path: "/products", priority: 0.9, freq: "daily" },
  { path: "/products?sort=discount", priority: 0.7, freq: "daily" },
  { path: "/stores", priority: 0.8, freq: "weekly" },
  { path: "/about", priority: 0.4, freq: "monthly" },
  { path: "/contact", priority: 0.4, freq: "monthly" },
  { path: "/faq", priority: 0.4, freq: "monthly" },
  { path: "/return-policy", priority: 0.3, freq: "monthly" },
  { path: "/terms", priority: 0.3, freq: "monthly" },
  { path: "/privacy", priority: 0.3, freq: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  let products: { slug: string; updatedAt: Date }[] = [];
  let stores: { slug: string; updatedAt: Date }[] = [];
  try {
    [products, stores] = await Promise.all([
      prisma.product.findMany({
        where: { status: "ACTIVE", store: { status: "APPROVED" } },
        select: { slug: true, updatedAt: true },
        take: 45000,
      }),
      prisma.store.findMany({
        where: { status: "APPROVED" },
        select: { slug: true, updatedAt: true },
      }),
    ]);
  } catch {
    products = [];
    stores = [];
  }
  const now = new Date();
  return [
    ...STATIC_PAGES.map((p) => ({
      url: `${base}${p.path}`,
      lastModified: now,
      changeFrequency: p.freq,
      priority: p.priority,
    })),
    ...stores.map((s) => ({
      url: `${base}/stores/${s.slug}`,
      lastModified: s.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((p) => ({
      url: `${base}/products/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
