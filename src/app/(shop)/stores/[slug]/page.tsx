import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import { StoreMonogram } from "@/components/store/StoreMonogram";
import { prisma } from "@/lib/db";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { ProductCard } from "@/components/products/ProductCard";
import { LinkPagination } from "@/components/shop/LinkPagination";
import { LIVE_PRODUCT_WHERE, SHOP_PAGE_SIZE, listProducts } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

/** Public store fields only — never CNIC, bank, owner or exact address. */
async function getStore(slug: string) {
  return prisma.store
    .findFirst({
      where: { slug, status: "APPROVED" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        coverUrl: true,
        area: true,
        city: true,
        _count: { select: { products: { where: LIVE_PRODUCT_WHERE } } },
      },
    })
    .catch(() => null);
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const store = await getStore(params.slug);
  if (!store) return { title: "Store not found", robots: { index: false } };
  const where = [store.area, store.city].filter(Boolean).join(", ");
  const description = (
    store.description ||
    `Shop ${store._count.products} products from ${store.name}${where ? ` in ${where}` : ""} on MandiBazaar.`
  )
    .replace(/\s+/g, " ")
    .slice(0, 155);
  const image = store.coverUrl || store.logoUrl;
  return {
    title: store.name,
    description,
    alternates: { canonical: `/stores/${store.slug}` },
    openGraph: {
      title: `${store.name} | MandiBazaar`,
      description,
      url: `/stores/${store.slug}`,
      siteName: "MandiBazaar",
      ...(image ? { images: [{ url: image, alt: store.name }] } : {}),
    },
  };
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const store = await getStore(params.slug);
  if (!store) notFound();

  const sp = new URLSearchParams();
  sp.set("store", store.slug);
  const page = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  if (page) sp.set("page", page);
  sp.set("limit", String(SHOP_PAGE_SIZE));
  const { items, pagination } = await listProducts(sp);

  const where = [store.area, store.city].filter(Boolean).join(", ");

  return (
    <ShopContainer width="xl">
      <Breadcrumbs items={[{ label: "Stores", href: "/stores" }, { label: store.name }]} />

      <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-card">
        <StoreMonogram name={store.name} logoUrl={store.logoUrl} sizeClass="h-16 w-16" textClass="text-xl" />
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-600">
            Store
          </span>
          <h1 className="break-words text-2xl font-extrabold text-ink md:text-3xl">{store.name}</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            {store.description || "Local store approved by MandiBazaar"}
          </p>
          {where && (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-subtle">
              <MapPin className="h-3.5 w-3.5" /> {where}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
          <p className="text-sm font-semibold text-ink-muted">
            {pagination.total} product{pagination.total === 1 ? "" : "s"}
          </p>
          {pagination.total > 0 && (
            <Link
              href={`/products?store=${encodeURIComponent(store.slug)}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink-muted hover:bg-app"
            >
              <Search className="h-3.5 w-3.5" /> Search &amp; filter this store
            </Link>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-card py-12 text-center text-sm text-ink-subtle">
          No products listed yet
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <LinkPagination
            basePath={`/stores/${store.slug}`}
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            pageSize={SHOP_PAGE_SIZE}
            itemLabel="products"
          />
        </>
      )}
    </ShopContainer>
  );
}
