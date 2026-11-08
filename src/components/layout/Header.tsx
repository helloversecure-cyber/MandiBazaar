"use client";

import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  Menu,
  Search,
  ShoppingCart,
  User,
  Heart,
  X,
  Store,
  Tag,
  ChevronDown,
  LogOut,
  Package,
  LayoutGrid,
} from "lucide-react";
import {
  refreshCartDeliveryProgress,
  useCartStore,
} from "@/lib/store/cart";
import { cn, formatCurrency } from "@/lib/utils";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/** Shopper menu — each entry once (QA A2 / J2). Store owners use "Sell on MandiBazaar". */
const SHOP_LINKS = [
  { label: "All products", href: "/products" },
  { label: "Deals", href: "/products?sort=discount" },
  { label: "Stores", href: "/stores" },
];

type Suggestion = {
  type: "product";
  id: string;
  name: string;
  slug: string;
  image: string | null;
  unit?: string;
  price: number;
  salePrice: number | null;
  storeName?: string | null;
};

type CategorySuggestion = { id: string; name: string; slug: string };

const STORE_ROLES = new Set(["STORE_OWNER"]);

function rs(n: number) {
  return `Rs. ${Math.round(n).toLocaleString("en-PK")}`;
}

export function Header({
  freeDeliveryThreshold = 5000,
  ratePerKm = 10,
}: {
  freeDeliveryThreshold?: number;
  ratePerKm?: number;
} = {}) {
  const { data: session } = useSession();
  const count = useCartStore((s) => s.count);
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [catSuggestions, setCatSuggestions] = useState<CategorySuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const isStoreOwner = STORE_ROLES.has(String(session?.user?.role || ""));
  const sellHref = isStoreOwner ? "/store-portal" : "/store";
  const sellLabel = isStoreOwner ? "My store portal" : "Sell on MandiBazaar";
  const isRider = String(session?.user?.role || "") === "RIDER";
  const riderHref = isRider ? "/rider-portal" : "/register/rider";
  const riderLabel = isRider ? "Rider portal" : "Become a rider";

  useEffect(() => {
    void refreshCartDeliveryProgress();
  }, [session]);

  // Debounced suggestions (QA R1): only buyable products, with photo + price.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setCatSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          if (d.success) {
            setSuggestions(d.data.suggestions || []);
            setCatSuggestions(d.data.categories || []);
          }
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Close the suggestion box when clicking elsewhere.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSuggest(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function goSearch() {
    const term = q.trim();
    if (term) {
      setShowSuggest(false);
      window.location.href = `/products?q=${encodeURIComponent(term)}`;
    }
  }

  const hasSuggestions = showSuggest && q.trim().length >= 2 && (suggestions.length > 0 || catSuggestions.length > 0);

  return (
    <>
      {/* Promo strip */}
      <div className="bg-brand-950 text-center text-xs text-white/90 sm:text-sm">
        <p className="px-4 py-2">
          <span className="font-semibold text-accent-400">
            Free delivery on {rs(freeDeliveryThreshold)}+
          </span>
          <span className="hidden sm:inline">
            {" · Delivery from "}
            <span className="font-semibold">{rs(ratePerKm)}/km</span>
            {" (go + return)"}
          </span>
          {" · "}
          <Link href={sellHref} className="underline hover:text-white">
            {sellLabel}
          </Link>
          {" · "}
          <Link href={riderHref} className="underline hover:text-white">
            {riderLabel}
          </Link>
        </p>
      </div>

      <header className="sticky top-0 z-50 border-b border-line bg-card shadow-sm">
        {/* Main bar */}
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:gap-6 lg:px-6">
          <button
            className="rounded-lg p-2 text-ink-muted hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <BrandLogo />

          {/* Search — hero of marketplace UX */}
          <div ref={boxRef} className="relative mx-auto hidden max-w-xl flex-1 md:block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              type="search"
              aria-label="Search products and stores"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => setShowSuggest(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") goSearch();
                if (e.key === "Escape") setShowSuggest(false);
              }}
              placeholder="Search daal, atta, rice, stores…"
              className="w-full rounded-xl border border-line bg-app py-2.5 pl-11 pr-24 text-sm text-ink outline-none transition focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="button"
              onClick={goSearch}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Search
            </button>
            {hasSuggestions && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-card py-1 shadow-card-hover">
                {suggestions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/products/${s.slug}`}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-app"
                    onClick={() => setShowSuggest(false)}
                  >
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                      {s.image ? (
                        <Image src={s.image} alt="" fill className="object-cover" sizes="40px" />
                      ) : (
                        <Package className="h-4 w-4 text-ink-subtle" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{s.name}</span>
                      {s.storeName && (
                        <span className="block truncate text-xs text-ink-subtle">{s.storeName}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-bold text-ink">
                        {formatCurrency(s.salePrice ?? s.price)}
                      </span>
                      {s.salePrice != null && (
                        <span className="block text-[11px] text-ink-subtle line-through">
                          {formatCurrency(s.price)}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
                {catSuggestions.map((c) => (
                  <Link
                    key={c.id}
                    href={`/products?category=${encodeURIComponent(c.slug)}`}
                    className="flex items-center gap-3 px-3 py-2 text-sm text-ink-muted hover:bg-app"
                    onClick={() => setShowSuggest(false)}
                  >
                    <LayoutGrid className="h-4 w-4 text-ink-subtle" />
                    <span>
                      Category: <span className="font-semibold">{c.name}</span>
                    </span>
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={goSearch}
                  className="block w-full border-t border-line px-3 py-2.5 text-left text-sm font-semibold text-brand-600 hover:bg-app"
                >
                  See all results for “{q.trim()}”
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <Link
              href="/products?focus=search"
              className="rounded-lg p-2.5 text-ink-muted hover:bg-slate-100 md:hidden"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </Link>
            <ThemeToggle bare className="hidden sm:inline-flex" />
            <Link
              href="/wishlist"
              className="hidden rounded-lg p-2.5 text-ink-muted hover:bg-slate-100 sm:block"
              aria-label="Wishlist"
            >
              <Heart className="h-5 w-5" />
            </Link>
            <Link
              href="/cart"
              className="relative rounded-lg p-2.5 text-ink-muted hover:bg-slate-100"
              aria-label="Cart"
            >
              <ShoppingCart className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-deal-500 px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </Link>

            <Link
              href={sellHref}
              className="ml-1 hidden items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 md:inline-flex"
            >
              <Store className="h-3.5 w-3.5" />
              <span className="lg:hidden">{isStoreOwner ? "My store" : "Sell"}</span>
              <span className="hidden lg:inline">{sellLabel}</span>
            </Link>

            {session?.user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAccountOpen(!accountOpen)}
                  className="flex items-center gap-1 rounded-lg p-2.5 text-ink-muted hover:bg-slate-100"
                >
                  <User className="h-5 w-5" />
                  <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
                </button>
                {accountOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAccountOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-card-hover">
                      <p className="border-b border-line px-4 py-2.5 text-xs text-ink-subtle">
                        {session.user.name || session.user.email}
                      </p>
                      <Link
                        href="/account"
                        className="block px-4 py-2.5 text-sm hover:bg-app"
                        onClick={() => setAccountOpen(false)}
                      >
                        My account
                      </Link>
                      <Link
                        href="/account/orders"
                        className="block px-4 py-2.5 text-sm hover:bg-app"
                        onClick={() => setAccountOpen(false)}
                      >
                        My orders
                      </Link>
                      <Link
                        href="/wishlist"
                        className="block px-4 py-2.5 text-sm hover:bg-app"
                        onClick={() => setAccountOpen(false)}
                      >
                        My wishlist
                      </Link>
                      <div className="my-1 border-t border-line" />
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-deal-600 hover:bg-app"
                        onClick={() => signOut({ callbackUrl: "/" })}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="ml-1 hidden rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 sm:inline-flex"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        {/* Category nav */}
        <div className="hidden border-t border-line bg-app/80 lg:block">
          <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-6 py-2 scrollbar-hide">
            {SHOP_LINKS.map((c, i) => (
              <Link
                key={c.label}
                href={c.href}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm hover:bg-card hover:text-brand-700",
                  i === 0 ? "font-semibold text-brand-700" : "text-ink-muted"
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-slate-900/50 transition lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
      >
        <aside
          className={cn(
            "flex h-full w-80 max-w-[85vw] flex-col bg-card shadow-xl transition",
            open ? "translate-x-0" : "-translate-x-full"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-line p-4">
            <BrandLogo />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-4">
            <Link
              href="/products"
              className="mb-4 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700"
              onClick={() => setOpen(false)}
            >
              <Tag className="h-4 w-4" />
              Shop all products
            </Link>
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Browse
            </p>
            <div className="mb-6 flex flex-col gap-0.5">
              {SHOP_LINKS.slice(1).map((c) => (
                <Link
                  key={c.label}
                  href={c.href}
                  className="rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-app"
                  onClick={() => setOpen(false)}
                >
                  {c.label}
                </Link>
              ))}
            </div>
            {!session?.user && (
              <>
                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                  Customers
                </p>
                <div className="mb-6 flex flex-col gap-0.5">
                  <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-600 hover:bg-app">
                    Sign in
                  </Link>
                  <Link href="/register" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-app">
                    Create customer account
                  </Link>
                </div>
              </>
            )}
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Store owners
            </p>
            <div className="mb-6 flex flex-col gap-2">
              <Link
                href={sellHref}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Store className="h-4 w-4" /> {sellLabel}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-emerald-700/80">
                  {isStoreOwner ? "Manage products and orders" : "Sign in or create a store account"}
                </span>
              </Link>
            </div>
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Account
            </p>
            <div className="flex flex-col gap-0.5">
              <Link href="/account" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-app">
                My account
              </Link>
              <Link href="/account/orders" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-app">
                Orders
              </Link>
              <Link href="/wishlist" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-app">
                Wishlist
              </Link>
              <Link href="/cart" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm hover:bg-app">
                Cart {count > 0 && `(${count})`}
              </Link>
              {session?.user && (
                <button
                  className="rounded-lg px-3 py-2.5 text-left text-sm text-deal-600 hover:bg-app"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  Sign out
                </button>
              )}
            </div>
          </nav>
        </aside>
      </div>
    </>
  );
}
