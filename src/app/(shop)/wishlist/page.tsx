"use client";

import { useEffect, useState } from "react";
import { ProductCard, ProductCardData } from "@/components/products/ProductCard";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { EmptyState } from "@/components/layout/EmptyState";
import { Heart } from "lucide-react";

export default function WishlistPage() {
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/wishlist")
      .then(async (r) => {
        if (r.status === 401) {
          setSignedOut(true);
          return;
        }
        const d = await r.json();
        if (d.success) {
          setItems(d.data.map((i: { product: ProductCardData }) => i.product));
        } else {
          setError(d.error || "Could not load your wishlist.");
        }
      })
      .catch(() => setError("Could not load your wishlist. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, []);

  const n = items.length;
  const subtitle = loading
    ? "Loading…"
    : signedOut
      ? "Sign in to see the products you saved"
      : `${n} saved product${n === 1 ? "" : "s"}`;

  return (
    <ShopContainer width="xl">
      <Breadcrumbs items={[{ label: "Wishlist" }]} />
      <PageHeader title="My wishlist" subtitle={subtitle} badge="Saved" />

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />
          ))}
        </div>
      ) : signedOut ? (
        <EmptyState
          icon={Heart}
          title="Sign in to see your wishlist"
          description="Save products you love with the heart button and buy them later."
          actionLabel="Sign in"
          actionHref="/login?callbackUrl=%2Fwishlist"
        />
      ) : error ? (
        <EmptyState icon={Heart} title="Something went wrong" description={error} actionLabel="Browse products" actionHref="/products" />
      ) : !n ? (
        <EmptyState
          icon={Heart}
          title="Wishlist is empty"
          description="Save products you love and buy them later."
          actionLabel="Browse products"
          actionHref="/products"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              wishlisted
              onWishlistChange={(id, saved) => {
                if (!saved) setItems((list) => list.filter((x) => x.id !== id));
              }}
            />
          ))}
        </div>
      )}
    </ShopContainer>
  );
}
