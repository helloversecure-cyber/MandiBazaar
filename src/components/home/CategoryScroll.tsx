"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid, Percent, Carrot, Apple, Milk, Wheat, Droplets, CookingPot,
  Soup, Flame, ShoppingBasket, Egg, Citrus, Leaf, Beef, type LucideIcon,
} from "lucide-react";
import { ProductCard, ProductCardData } from "@/components/products/ProductCard";
import { cn } from "@/lib/utils";

/**
 * Branded icon tiles per category — intentional, consistent, and independent of
 * external image hosting (no fake/placeholder photos). Falls back to a basket.
 */
const CATEGORY_ICONS: Record<string, { Icon: LucideIcon; tile: string; icon: string }> = {
  vegetables: { Icon: Carrot, tile: "bg-gradient-to-br from-emerald-400 to-green-600", icon: "text-white" },
  fruits: { Icon: Apple, tile: "bg-gradient-to-br from-rose-400 to-pink-600", icon: "text-white" },
  dairy: { Icon: Milk, tile: "bg-gradient-to-br from-sky-400 to-blue-600", icon: "text-white" },
  "organic-grains": { Icon: Wheat, tile: "bg-gradient-to-br from-amber-400 to-orange-600", icon: "text-white" },
  grains: { Icon: Wheat, tile: "bg-gradient-to-br from-amber-400 to-orange-600", icon: "text-white" },
  honey: { Icon: Droplets, tile: "bg-gradient-to-br from-yellow-400 to-amber-600", icon: "text-white" },
  ghee: { Icon: CookingPot, tile: "bg-gradient-to-br from-orange-400 to-red-600", icon: "text-white" },
  pulses: { Icon: Soup, tile: "bg-gradient-to-br from-lime-400 to-green-600", icon: "text-white" },
  spices: { Icon: Flame, tile: "bg-gradient-to-br from-red-400 to-rose-600", icon: "text-white" },
  grocery: { Icon: ShoppingBasket, tile: "bg-gradient-to-br from-violet-400 to-purple-600", icon: "text-white" },
  eggs: { Icon: Egg, tile: "bg-gradient-to-br from-amber-300 to-yellow-500", icon: "text-white" },
  pickles: { Icon: Citrus, tile: "bg-gradient-to-br from-fuchsia-400 to-purple-600", icon: "text-white" },
  seasonal: { Icon: Leaf, tile: "bg-gradient-to-br from-teal-400 to-emerald-600", icon: "text-white" },
  meat: { Icon: Beef, tile: "bg-gradient-to-br from-rose-400 to-red-600", icon: "text-white" },
};
const DEFAULT_ICON = { Icon: ShoppingBasket, tile: "bg-gradient-to-br from-brand-500 to-emerald-700", icon: "text-white" };

type Selection =
  | { type: "all"; label: string }
  | { type: "deals"; label: string }
  | { type: "category"; slug: string; label: string };

export function CategoryScroll({
  categories,
}: {
  categories: {
    id: string;
    name: string;
    slug: string;
    imageUrl?: string | null;
  }[];
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [products, setProducts] = useState<ProductCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadProducts = useCallback(async (sel: Selection) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (sel.type === "category") {
      params.set("category", sel.slug);
    } else if (sel.type === "deals") {
      params.set("sort", "discount");
    } else {
      params.set("sort", "newest");
    }
    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data.items || []);
        setTotal(data.data.pagination?.total ?? data.data.items?.length ?? 0);
      } else {
        setProducts([]);
        setTotal(0);
      }
    } catch {
      setProducts([]);
      setTotal(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selection) return;
    loadProducts(selection);
  }, [selection, loadProducts]);

  function select(next: Selection) {
    setSelection(next);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const isActive = (key: string) => {
    if (!selection) return false;
    if (key === "all") return selection.type === "all";
    if (key === "deals") return selection.type === "deals";
    return selection.type === "category" && selection.slug === key;
  };

  return (
    <section className="border-b border-line bg-card py-6 shadow-sm">
      <div className="mx-auto max-w-7xl px-3 lg:px-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-ink">
            Shop by Category
          </h2>
          <Link href="/products" className="text-xs font-bold text-brand-600 hover:underline">
            See all →
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 sm:gap-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
          <button
            type="button"
            onClick={() => select({ type: "all", label: "All products" })}
            className="group flex flex-col items-center gap-2 text-center"
          >
            <div
              className={cn(
                "relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-emerald-800 shadow-sm transition group-hover:scale-[1.03] group-hover:shadow-md",
                isActive("all") && "ring-2 ring-brand-600 ring-offset-2"
              )}
            >
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <LayoutGrid className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
            </div>
            <span className="line-clamp-2 text-[10px] font-bold leading-tight text-brand-600 sm:text-xs">
              All
            </span>
          </button>

          <button
            type="button"
            onClick={() => select({ type: "deals", label: "Deals" })}
            className="group flex flex-col items-center gap-2 text-center"
          >
            <div
              className={cn(
                "relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br from-deal-500 to-accent-500 shadow-sm transition group-hover:scale-[1.03] group-hover:shadow-md",
                isActive("deals") && "ring-2 ring-deal-500 ring-offset-2"
              )}
            >
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Percent className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
              </div>
            </div>
            <span className="line-clamp-2 text-[10px] font-bold leading-tight text-deal-600 sm:text-xs">
              Deals
            </span>
          </button>

          {categories.map((c) => {
            const meta = CATEGORY_ICONS[c.slug] ?? DEFAULT_ICON;
            const Icon = meta.Icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  select({ type: "category", slug: c.slug, label: c.name })
                }
                className="group flex flex-col items-center gap-2 text-center"
              >
                <div
                  className={cn(
                    "relative flex aspect-square w-full items-center justify-center rounded-2xl shadow-sm transition group-hover:scale-[1.04] group-hover:shadow-lg",
                    meta.tile,
                    isActive(c.slug) && "ring-2 ring-brand-600 ring-offset-2"
                  )}
                >
                  <Icon className={cn("h-7 w-7 drop-shadow transition group-hover:scale-110 sm:h-8 sm:w-8", meta.icon)} strokeWidth={2} />
                </div>
                <span className="line-clamp-2 text-[10px] font-bold leading-tight text-ink-muted transition group-hover:text-brand-600 sm:text-xs">
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>

        {selection && (
          <div ref={resultsRef} className="mt-6 scroll-mt-24">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-3">
              <div>
                <h3 className="text-lg font-black text-ink sm:text-xl">
                  {selection.label}
                </h3>
                <p className="mt-0.5 text-sm text-ink-subtle">
                  {loading
                    ? "Loading products…"
                    : `${total} product${total === 1 ? "" : "s"}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelection(null);
                  setProducts([]);
                  setTotal(0);
                }}
                className="text-xs font-bold text-ink-subtle hover:text-brand-600"
              >
                Close
              </button>
            </div>

            {loading ? (
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-[3/4] animate-pulse rounded-2xl bg-slate-100"
                  />
                ))}
              </div>
            ) : products.length === 0 ? (
              <p className="rounded-2xl bg-app px-4 py-10 text-center text-sm text-ink-subtle">
                No products in this category yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
