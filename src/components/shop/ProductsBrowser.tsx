"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X, Search, Store as StoreIcon } from "lucide-react";
import { ProductCard, type ProductCardData } from "@/components/products/ProductCard";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Pagination } from "@/components/ui/Pagination";
import { NO_RESULT_SUGGESTIONS } from "@/lib/search/synonyms";

/**
 * All products / Search results / Deals / ?store= — one URL-driven list (QA R2, R4, Q1–Q3, C4).
 * Everything (q, category, price, flags, sort, page, store) lives in the URL so
 * results can be shared and Back works.
 */

const PAGE_SIZE = 20;

type Ctx = {
  q: string | null;
  store: { id: string; name: string; slug: string; logoUrl: string | null; city: string | null } | null;
  storeNotFound: boolean;
  category: { id: string; name: string; slug: string } | null;
  didYouMean: string | null;
  priceSwapped: boolean;
  deals: boolean;
};

type Category = { slug: string; name: string; _count?: { products: number } };

const FLAG_FILTERS = [
  { key: "available", label: "In stock only" },
  { key: "organic", label: "Organic only" },
  { key: "seasonal", label: "Seasonal" },
] as const;

const SORTS = [
  { value: "relevance", label: "Best match", searchOnly: true },
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Popular" },
  { value: "best_selling", label: "Best selling" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "discount", label: "Biggest discount" },
];

const inputCls =
  "w-full rounded-xl border bg-app px-3 py-2.5 text-sm outline-none focus:bg-card focus:ring-2";

export function ProductsBrowser() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const spKey = sp.toString();

  const q = sp.get("q") || "";
  const category = sp.get("category") || "";
  const sort = sp.get("sort") || (q ? "relevance" : "newest");
  const minPrice = sp.get("minPrice") || "";
  const maxPrice = sp.get("maxPrice") || "";
  const storeSlug = sp.get("store") || "";

  const [items, setItems] = useState<ProductCardData[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [context, setContext] = useState<Ctx | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [popular, setPopular] = useState<ProductCardData[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mobileFilters, setMobileFilters] = useState(false);

  const [qInput, setQInput] = useState(q);
  const [minInput, setMinInput] = useState(minPrice);
  const [maxInput, setMaxInput] = useState(maxPrice);
  const searchRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);
  // Values this component itself just wrote to the URL — don't overwrite what the shopper is typing.
  const pushed = useRef<{ q: string | null; min: string | null; max: string | null }>({ q: null, min: null, max: null });

  // Keep the inputs in step when the URL changes (header search, Back button, chips).
  useEffect(() => {
    if (pushed.current.q === q) {
      pushed.current.q = null;
      return;
    }
    setQInput(q);
  }, [q]);
  useEffect(() => {
    if (pushed.current.min === minPrice && pushed.current.max === maxPrice) {
      pushed.current.min = null;
      pushed.current.max = null;
      return;
    }
    setMinInput(minPrice);
    setMaxInput(maxPrice);
  }, [minPrice, maxPrice]);

  const updateParams = useCallback(
    (changes: Record<string, string | null>, opts: { replace?: boolean; keepPage?: boolean } = {}) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!opts.keepPage) next.delete("page");
      next.delete("focus");
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [sp, pathname, router]
  );

  // Mobile "Search" tab / header icon land here with ?focus=search.
  useEffect(() => {
    if (sp.get("focus") === "search") {
      searchRef.current?.focus();
      updateParams({}, { replace: true, keepPage: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Search in results" — wait until the shopper pauses typing (300 ms).
  useEffect(() => {
    const trimmed = qInput.trim();
    if (trimmed === q) return;
    const t = setTimeout(() => {
      pushed.current.q = trimmed;
      updateParams(
        { q: trimmed || null, sort: sp.get("sort") === "relevance" && !trimmed ? null : sp.get("sort") },
        { replace: true }
      );
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const priceInvalid =
    minInput !== "" && maxInput !== "" && Number(minInput) > Number(maxInput);
  const priceNegative = Number(minInput) < 0 || Number(maxInput) < 0;

  // Price boxes — debounced, and never applied while Min > Max.
  useEffect(() => {
    if (minInput === minPrice && maxInput === maxPrice) return;
    if (priceInvalid || priceNegative) return;
    const t = setTimeout(() => {
      pushed.current.min = minInput;
      pushed.current.max = maxInput;
      updateParams({ minPrice: minInput || null, maxPrice: maxInput || null }, { replace: true });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minInput, maxInput]);

  // Load the list whenever the URL changes.
  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams(spKey);
    params.delete("focus");
    params.set("limit", String(PAGE_SIZE));
    setLoading(true);
    setLoadError("");
    fetch(`/api/products?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setItems(data.data.items || []);
          setPagination({
            page: data.data.pagination.page,
            totalPages: data.data.pagination.totalPages,
            total: data.data.pagination.total,
          });
          setContext(data.data.context || null);
        } else {
          setItems([]);
          setLoadError(data.error || "Could not load products.");
        }
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setItems([]);
        setLoadError("Could not load products. Check your connection and try again.");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [spKey, reloadKey]);

  // Popular products under a "no results" message (QA B2).
  const noResults = !loading && !loadError && items.length === 0;
  useEffect(() => {
    if (!noResults || popular.length) return;
    fetch(`/api/products?sort=popular&available=true&limit=8`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setPopular(d.data.items || []);
      })
      .catch(() => {});
  }, [noResults, popular.length]);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data)) {
          setCategories(
            (d.data as Category[]).filter((c) => (c._count?.products ?? 1) > 0)
          );
        }
      })
      .catch(() => {});
  }, []);

  const flagOn = (key: string) => sp.get(key) === "true";
  const activeFilterCount =
    [category, minPrice, maxPrice].filter(Boolean).length +
    FLAG_FILTERS.filter((f) => flagOn(f.key)).length;

  const hrefFor = useCallback(
    (p: number) => {
      const next = new URLSearchParams(spKey);
      next.delete("focus");
      if (p <= 1) next.delete("page");
      else next.set("page", String(p));
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [spKey, pathname]
  );

  const store = context?.store || null;
  const heading = useMemo(() => {
    if (store) return `Products from ${store.name}`;
    if (q) return `Results for “${q}”`;
    if (sort === "discount") return "Deals";
    if (context?.category) return context.category.name;
    return "All products";
  }, [store, q, sort, context?.category]);

  const crumbs = store
    ? [{ label: "Stores", href: "/stores" }, { label: store.name, href: `/stores/${store.slug}` }, { label: "Products" }]
    : q
      ? [{ label: "Products", href: "/products" }, { label: "Search" }]
      : sort === "discount"
        ? [{ label: "Products", href: "/products" }, { label: "Deals" }]
        : [{ label: "All products" }];

  const total = pagination.total;
  const countLabel = `${total.toLocaleString("en-PK")} product${total === 1 ? "" : "s"}`;

  const clearFilters = () =>
    updateParams({
      category: null,
      organic: null,
      available: null,
      seasonal: null,
      minPrice: null,
      maxPrice: null,
    });

  const FilterPanel = (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-subtle">Category</p>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
              !category ? "bg-brand-600 text-white" : "text-ink-muted hover:bg-app"
            }`}
            onClick={() => updateParams({ category: null })}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              type="button"
              key={c.slug}
              className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                category === c.slug ? "bg-brand-600 text-white" : "text-ink-muted hover:bg-app"
              }`}
              onClick={() => updateParams({ category: c.slug })}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-subtle">Price range (Rs.)</p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Min"
            aria-label="Minimum price"
            aria-invalid={priceInvalid || undefined}
            className={`${inputCls} ${priceInvalid ? "border-red-400 focus:ring-red-100" : "border-line focus:border-brand-400 focus:ring-brand-100"}`}
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
          />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Max"
            aria-label="Maximum price"
            aria-invalid={priceInvalid || undefined}
            className={`${inputCls} ${priceInvalid ? "border-red-400 focus:ring-red-100" : "border-line focus:border-brand-400 focus:ring-brand-100"}`}
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
          />
        </div>
        {priceInvalid && (
          <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
            Min price can&apos;t be more than Max price.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                setMinInput(maxInput);
                setMaxInput(minInput);
              }}
            >
              Swap
            </button>
          </p>
        )}
        {priceNegative && !priceInvalid && (
          <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
            Price can&apos;t be negative.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Filters</p>
        {FLAG_FILTERS.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
              checked={flagOn(key)}
              onChange={(e) => updateParams({ [key]: e.target.checked ? "true" : null })}
            />
            {label}
          </label>
        ))}
      </div>
      {activeFilterCount > 0 && (
        <button
          type="button"
          className="w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-muted hover:bg-app"
          onClick={clearFilters}
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  const grid = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <ShopContainer width="xl">
      <Breadcrumbs items={crumbs} />

      <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-3">
          {store && (
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-50 text-brand-700">
              {store.logoUrl ? (
                <Image src={store.logoUrl} alt={store.name} fill className="object-cover" sizes="48px" />
              ) : (
                <StoreIcon className="h-6 w-6" />
              )}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-extrabold text-ink md:text-3xl">{heading}</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              {loading
                ? "Loading…"
                : store
                  ? `${countLabel}${store.city ? ` · ${store.city}` : ""} · `
                  : `${countLabel}${q ? "" : " from local stores"}`}
              {!loading && store && (
                <Link href={`/stores/${store.slug}`} className="font-semibold text-brand-600 hover:underline">
                  Visit store page
                </Link>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              aria-label="Search products"
              placeholder={store ? `Search in ${store.name}…` : "Search products, stores… (e.g. daal, atta)"}
              className="w-full rounded-xl border border-line bg-app py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const trimmed = qInput.trim();
                  if (trimmed !== q) updateParams({ q: trimmed || null });
                }
              }}
            />
          </div>
          <select
            aria-label="Sort products"
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink-muted outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:flex-none"
            value={sort}
            onChange={(e) => {
              const v = e.target.value;
              const isDefault = q ? v === "relevance" : v === "newest";
              updateParams({ sort: isDefault ? null : v });
            }}
          >
            {SORTS.filter((s) => !s.searchOnly || q).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-medium text-ink-muted lg:hidden"
            onClick={() => setMobileFilters(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {(storeSlug || context?.priceSwapped) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {storeSlug && (
              <button
                type="button"
                onClick={() => updateParams({ store: null })}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-700 hover:bg-brand-100"
              >
                Store: {store?.name || storeSlug}
                <X className="h-3 w-3" aria-label="Remove store filter" />
              </button>
            )}
            {context?.priceSwapped && (
              <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800">
                Min price was more than Max price, so we swapped them.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-36 rounded-2xl border border-line bg-card p-5 shadow-card">
            <p className="mb-4 font-bold text-ink">Filters</p>
            {FilterPanel}
          </div>
        </aside>

        <div className="min-w-0">
          {priceInvalid && (
            <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              Min price can&apos;t be more than Max price — the price filter isn&apos;t applied until you fix it.
            </p>
          )}
          {loading ? (
            <div className={grid}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />
              ))}
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-line bg-card p-10 text-center">
              <p className="text-lg font-bold text-ink">Something went wrong</p>
              <p className="mt-2 text-sm text-ink-subtle">{loadError}</p>
              <button
                type="button"
                className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <NoResults
              q={q}
              context={context}
              hasFilters={activeFilterCount > 0}
              onClearFilters={clearFilters}
              onSearch={(term) => updateParams({ q: term, sort: null })}
              popular={popular}
            />
          ) : (
            <>
              <div className={grid}>
                {items.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                pageSize={PAGE_SIZE}
                hrefFor={hrefFor}
                itemLabel="products"
              />
            </>
          )}
        </div>
      </div>

      {mobileFilters && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 lg:hidden" onClick={() => setMobileFilters(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-auto rounded-t-2xl bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <p className="font-bold text-ink">Filters</p>
              <button
                type="button"
                onClick={() => setMobileFilters(false)}
                className="rounded-lg p-1 hover:bg-slate-100"
                aria-label="Close filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {FilterPanel}
            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white"
              onClick={() => setMobileFilters(false)}
            >
              {loading ? "Show products" : `Show ${countLabel}`}
            </button>
          </div>
        </div>
      )}
    </ShopContainer>
  );
}

function NoResults({
  q,
  context,
  hasFilters,
  onClearFilters,
  onSearch,
  popular,
}: {
  q: string;
  context: Ctx | null;
  hasFilters: boolean;
  onClearFilters: () => void;
  onSearch: (term: string) => void;
  popular: ProductCardData[];
}) {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-line bg-card p-8 text-center sm:p-12">
        {context?.storeNotFound ? (
          <>
            <p className="text-xl font-bold text-ink">This store isn&apos;t available</p>
            <p className="mt-2 text-sm text-ink-subtle">
              It may be closed or not approved yet.{" "}
              <Link href="/stores" className="font-semibold text-brand-600 hover:underline">
                See all stores
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-ink">
              {q ? `No results for “${q}”` : "No products found"}
            </p>
            {context?.didYouMean && (
              <p className="mt-3 text-base text-ink-muted">
                Did you mean{" "}
                <button
                  type="button"
                  onClick={() => onSearch(context.didYouMean!)}
                  className="font-bold text-brand-600 underline underline-offset-2 hover:text-brand-700"
                >
                  {context.didYouMean}
                </button>
                ?
              </p>
            )}
            <p className="mt-2 text-sm text-ink-subtle">
              {hasFilters
                ? "Try removing some filters."
                : q
                  ? "Check the spelling or try a simpler word."
                  : "Check back soon — stores add products every day."}
              {q ? " Popular searches:" : ""}
            </p>
            {q && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {NO_RESULT_SUGGESTIONS.slice(0, 3).map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => onSearch(term)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="mt-4 rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-app"
              >
                Clear all filters
              </button>
            )}
          </>
        )}
      </div>

      {popular.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-extrabold text-ink">Popular right now</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
            {popular.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
