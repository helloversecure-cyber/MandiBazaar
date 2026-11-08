"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart, ShoppingCart, Star, Plus } from "lucide-react";
import { formatCurrency, discountPercent } from "@/lib/utils";
import { refreshCartDeliveryProgress, useCartStore } from "@/lib/store/cart";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/feedback";

export type ProductCardData = {
  id: string;
  name: string;
  slug: string;
  shortDescription?: string | null;
  price: number;
  salePrice?: number | null;
  unit: string;
  /** stockQuantity − reservedStock. Leave undefined when unknown (then the card does NOT say "Sold out"). */
  availableStock?: number;
  stockQuantity?: number;
  reservedStock?: number;
  /** Product no longer ACTIVE or its store is no longer APPROVED (e.g. old wishlist items). */
  unavailable?: boolean;
  isOrganic?: boolean;
  isFarmProduct?: boolean;
  freeDelivery?: boolean;
  images?: { url: string; alt?: string | null }[];
  image?: string;
  store?: { id?: string; name: string; slug: string; logoUrl?: string | null } | null;
  /** Average of APPROVED reviews; null/undefined = no ratings yet. */
  avgRating?: number | null;
  reviewCount?: number;
};

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80";

/** Units the shopper can still buy, or null when the caller didn't pass stock data. */
export function availableUnits(p: Pick<ProductCardData, "availableStock" | "stockQuantity" | "reservedStock">): number | null {
  if (typeof p.availableStock === "number") return Math.max(0, p.availableStock);
  if (typeof p.stockQuantity === "number") return Math.max(0, p.stockQuantity - (p.reservedStock ?? 0));
  return null;
}

function currentPath() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

export function RatingStars({
  avg,
  count,
  size = "sm",
  showEmpty = true,
}: {
  avg?: number | null;
  count?: number;
  size?: "sm" | "md";
  showEmpty?: boolean;
}) {
  const icon = size === "md" ? "h-4 w-4" : "h-2.5 w-2.5";
  const text = size === "md" ? "text-xs" : "text-[10px]";
  if (!count || avg == null) {
    return showEmpty ? <span className={cn(text, "text-ink-subtle")}>No ratings yet</span> : null;
  }
  const filled = Math.round(avg);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${avg} out of 5 from ${count} review${count === 1 ? "" : "s"}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(icon, i < filled ? "fill-current text-amber-400" : "text-slate-200")}
        />
      ))}
      <span className={cn("ml-1 text-ink-subtle", text)}>
        {avg.toFixed(1)} ({count})
      </span>
    </span>
  );
}

export function ProductCard({
  product,
  compact = false,
  wishlisted,
  onWishlistChange,
}: {
  product: ProductCardData;
  compact?: boolean;
  /** Pass true on the wishlist page so the heart starts filled and removes on click. */
  wishlisted?: boolean;
  onWishlistChange?: (productId: string, saved: boolean) => void;
}) {
  const { data: session } = useSession();
  const toast = useToast();
  const bump = useCartStore((s) => s.bump);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [saved, setSaved] = useState(Boolean(wishlisted));
  const [savingWish, setSavingWish] = useState(false);

  useEffect(() => {
    setSaved(Boolean(wishlisted));
  }, [wishlisted]);

  const image = product.images?.[0]?.url || product.image || FALLBACK_IMAGE;
  const price =
    product.salePrice && product.salePrice < product.price
      ? product.salePrice
      : product.price;
  const disc = discountPercent(product.price, product.salePrice);
  const units = availableUnits(product);
  const outOfStock = Boolean(product.unavailable) || (units != null && units <= 0);
  const lowStock = !outOfStock && units != null && units <= 5;
  const productHref = `/products/${product.slug}`;

  function flashAdded() {
    bump();
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    void refreshCartDeliveryProgress();
  }

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock || loading) return;
    if (!session?.user) {
      const { addGuestItem, readGuestCart } = await import("@/lib/store/guest-cart");
      if (units != null) {
        const inCart = readGuestCart()
          .filter((i) => i.productId === product.id && !i.variantId)
          .reduce((s, i) => s + i.quantity, 0);
        if (inCart + 1 > units) {
          toast.error(`Only ${units} available — you already have ${inCart} in your cart.`);
          return;
        }
      }
      addGuestItem({
        productId: product.id,
        quantity: 1,
        name: product.name,
        unit: product.unit,
        unitPrice: price,
        imageUrl: image,
        freeDelivery: Boolean(product.freeDelivery),
      });
      flashAdded();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, quantity: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) flashAdded();
      else toast.error(data.error || "Could not add to cart. Please try again.");
    } catch {
      toast.error("Could not add to cart. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleWishlist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session?.user) {
      const callbackUrl = encodeURIComponent(currentPath());
      toast.success("Sign in to save to your wishlist", {
        durationMs: 7000,
        action: {
          label: "Sign in",
          onClick: () => {
            window.location.href = `/login?callbackUrl=${callbackUrl}`;
          },
        },
      });
      return;
    }
    if (savingWish) return;
    setSavingWish(true);
    const next = !saved;
    try {
      const res = next
        ? await fetch("/api/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: product.id }),
          })
        : await fetch(`/api/wishlist?productId=${encodeURIComponent(product.id)}`, {
            method: "DELETE",
          });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        toast.error(data.error || "Could not update your wishlist.");
        return;
      }
      setSaved(next);
      onWishlistChange?.(product.id, next);
      if (next) {
        toast.success("Saved to your wishlist", {
          action: { label: "View", onClick: () => (window.location.href = "/wishlist") },
        });
      } else {
        toast.success("Removed from your wishlist");
      }
    } catch {
      toast.error("Could not update your wishlist.");
    } finally {
      setSavingWish(false);
    }
  }

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-300",
        "hover:-translate-y-1 hover:border-brand-200 hover:shadow-[0_12px_40px_-12px_rgba(5,150,105,0.28)]"
      )}
    >
      <Link href={productHref} className="relative block">
        <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100">
          <Image
            src={image}
            alt={product.name}
            fill
            className="object-cover transition duration-500 group-hover:scale-110"
            sizes={compact ? "180px" : "(max-width:768px) 50vw, 25vw"}
          />
          {disc > 0 && (
            <span className="absolute left-0 top-0 rounded-br-xl bg-gradient-to-r from-deal-600 to-orange-500 px-2.5 py-1 text-[10px] font-black text-white shadow-md sm:text-[11px]">
              -{disc}%
            </span>
          )}
          {product.freeDelivery && (
            <span
              className={cn(
                "absolute rounded-bl-xl bg-brand-600 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-white shadow-md sm:text-[10px]",
                disc > 0 ? "left-0 top-7" : "left-0 top-0"
              )}
            >
              Free delivery
            </span>
          )}
          {outOfStock && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px]">
              <span className="rounded-lg bg-card px-3 py-1 text-xs font-bold text-ink">
                {product.unavailable ? "Unavailable" : "Sold out"}
              </span>
            </div>
          )}
          {lowStock && (
            <span className="absolute bottom-2 left-2 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow sm:text-[10px]">
              Only {units} left
            </span>
          )}

          {/* Quick add overlay */}
          {!outOfStock && (
            <button
              type="button"
              onClick={addToCart}
              disabled={loading}
              className={cn(
                "absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full shadow-lg transition",
                added
                  ? "bg-emerald-500 text-white"
                  : "bg-card text-brand-600 opacity-0 group-hover:opacity-100 hover:bg-brand-600 hover:text-white",
                compact && "opacity-100"
              )}
              aria-label={`Add ${product.name} to cart`}
            >
              {added ? (
                <span className="text-xs font-bold">✓</span>
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={toggleWishlist}
            disabled={savingWish}
            className={cn(
              "absolute right-2 top-2 rounded-full bg-card/95 p-1.5 shadow-md transition hover:scale-110",
              saved ? "text-deal-500" : "text-ink-subtle hover:text-deal-500"
            )}
            aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
            aria-pressed={saved}
          >
            <Heart className={cn("h-3.5 w-3.5", saved && "fill-current")} />
          </button>
        </div>
      </Link>

      <div className={cn("flex flex-1 flex-col", compact ? "p-2.5" : "p-3 sm:p-4")}>
        {!compact && product.store?.name && (
          <Link
            href={`/stores/${product.store.slug}`}
            className="mb-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-brand-500 hover:underline"
          >
            {product.store.name}
          </Link>
        )}
        <Link href={productHref}>
          <h3
            className={cn(
              "line-clamp-2 font-bold leading-snug text-ink transition group-hover:text-brand-700",
              compact ? "text-xs" : "text-sm sm:text-base"
            )}
          >
            {product.name}
          </h3>
        </Link>

        {!compact && (
          <div className="mt-1.5 flex min-h-[14px] items-center">
            <RatingStars avg={product.avgRating} count={product.reviewCount} />
          </div>
        )}

        <div className="mt-auto pt-2">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span
              className={cn(
                "font-black text-ink",
                compact ? "text-sm" : "text-lg"
              )}
            >
              {formatCurrency(price)}
            </span>
            {disc > 0 && (
              <span className="text-[10px] text-ink-subtle line-through sm:text-xs">
                {formatCurrency(product.price)}
              </span>
            )}
            {product.unit && (
              <span className="text-[10px] text-ink-subtle sm:text-xs">/ {product.unit}</span>
            )}
          </div>
        </div>

        {!compact && (
          <button
            type="button"
            disabled={loading || outOfStock}
            onClick={addToCart}
            className={cn(
              "mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition sm:text-sm",
              added
                ? "bg-emerald-500 text-white"
                : outOfStock
                  ? "cursor-not-allowed bg-slate-100 text-ink-subtle"
                  : "bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.98]"
            )}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            {added
              ? "Added!"
              : product.unavailable
                ? "Unavailable"
                : outOfStock
                  ? "Sold out"
                  : loading
                    ? "…"
                    : "Add to cart"}
          </button>
        )}
      </div>
    </article>
  );
}
