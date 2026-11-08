import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Store } from "lucide-react";
import { StoreMonogram } from "@/components/store/StoreMonogram";
import { prisma } from "@/lib/db";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { LinkPagination } from "@/components/shop/LinkPagination";
import { LIVE_PRODUCT_WHERE } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All stores",
  description: "Local grocery stores selling on MandiBazaar — browse each store's products.",
  alternates: { canonical: "/stores" },
};

const PAGE_SIZE = 24;

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const rawPage = parseInt(String(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page || "1"), 10);
  const where = { status: "APPROVED" as const };

  let total = 0;
  let stores: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    area: string | null;
    city: string;
    _count: { products: number };
  }[] = [];
  let page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  try {
    total = await prisma.store.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    // Public fields only — never select CNIC, bank, JazzCash, owner or exact address.
    stores = await prisma.store.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
        area: true,
        city: true,
        _count: { select: { products: { where: LIVE_PRODUCT_WHERE } } },
      },
      orderBy: [{ approvedAt: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  } catch {
    stores = [];
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <ShopContainer width="xl">
      <Breadcrumbs items={[{ label: "Stores" }]} />
      <PageHeader
        title="All stores"
        subtitle={
          total
            ? `${total} local store${total === 1 ? "" : "s"} approved by MandiBazaar`
            : "Local stores approved by MandiBazaar"
        }
        badge="Stores"
      />

      {stores.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No stores yet"
          description="Stores will appear here once they are approved."
          actionLabel="Sell on MandiBazaar"
          actionHref="/store"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {stores.map((s) => {
              const where = [s.area, s.city].filter(Boolean).join(", ");
              return (
                <Link
                  key={s.id}
                  href={`/stores/${s.slug}`}
                  className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 shadow-card transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
                >
                  <StoreMonogram name={s.name} logoUrl={s.logoUrl} sizeClass="h-16 w-16" textClass="text-xl" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink group-hover:text-brand-700">{s.name}</p>
                    {where && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-subtle">
                        <MapPin className="h-3 w-3 shrink-0" /> {where}
                      </p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-brand-600">
                      {s._count.products} product{s._count.products === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
          <LinkPagination
            basePath="/stores"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="stores"
          />
        </>
      )}
    </ShopContainer>
  );
}
