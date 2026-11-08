import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { ProductsBrowser } from "@/components/shop/ProductsBrowser";

type SP = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() || "";
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = one(searchParams.q).slice(0, 60);
  const storeSlug = one(searchParams.store);
  const sort = one(searchParams.sort);
  const category = one(searchParams.category);

  if (storeSlug) {
    const store = await prisma.store
      .findFirst({ where: { slug: storeSlug, status: "APPROVED" }, select: { name: true, city: true } })
      .catch(() => null);
    if (store) {
      return {
        title: `Products from ${store.name}`,
        description: `Shop groceries from ${store.name}${store.city ? ` in ${store.city}` : ""} on MandiBazaar.`,
      };
    }
  }
  if (q) {
    return {
      title: `Search results for “${q}”`,
      description: `Products matching “${q}” from local stores on MandiBazaar.`,
      robots: { index: false, follow: true },
    };
  }
  if (sort === "discount") {
    return {
      title: "Deals",
      description: "Discounted groceries from local stores on MandiBazaar.",
    };
  }
  if (category) {
    const cat = await prisma.category
      .findFirst({ where: { slug: category, isActive: true }, select: { name: true } })
      .catch(() => null);
    if (cat) {
      return {
        title: `${cat.name}`,
        description: `Buy ${cat.name.toLowerCase()} from local stores on MandiBazaar.`,
      };
    }
  }
  return {
    title: "All products",
    description: "Browse groceries, daal, rice, atta, spices and more from local stores on MandiBazaar.",
  };
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <ShopContainer width="xl">
          <div className="skeleton h-8 w-48 rounded-lg" />
        </ShopContainer>
      }
    >
      <ProductsBrowser />
    </Suspense>
  );
}
