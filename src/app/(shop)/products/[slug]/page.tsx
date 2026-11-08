"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatCurrency, discountPercent } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { refreshCartDeliveryProgress, useCartStore } from "@/lib/store/cart";
import { useSession } from "next-auth/react";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { ProductCard, RatingStars, type ProductCardData } from "@/components/products/ProductCard";
import { useToast } from "@/components/ui/feedback";
import {
  Minus,
  Plus,
  ShoppingCart,
  Truck,
  ShieldCheck,
  Star,
  Store,
  Leaf,
} from "lucide-react";

type Variant = {
  id: string;
  name: string;
  unit: string;
  price: number;
  salePrice: number | null;
  availableStock: number;
};

export default function ProductDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { data: session } = useSession();
  const bump = useCartStore((s) => s.bump);
  const toast = useToast();
  const [product, setProduct] = useState<Record<string, unknown> | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [imgIdx, setImgIdx] = useState(0);
  const [tab, setTab] = useState<"desc" | "info" | "delivery" | "reviews">("desc");
  const [reviews, setReviews] = useState<
    { id: string; rating: number; comment: string | null; user: { fullName: string }; createdAt: string }[]
  >([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/products/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setProduct(d.data);
          const variants = d.data.variants as Variant[];
          if (variants?.length) setVariantId(variants[0].id);
        } else setError(d.error || "Product not found");
      })
      .finally(() => setLoading(false));
  }, [slug]);

  // Quantity always starts at 1 for a newly picked option.
  useEffect(() => {
    setQty(1);
  }, [variantId]);

  useEffect(() => {
    if (tab !== "reviews" || !product?.id) return;
    setReviewsLoading(true);
    fetch(`/api/reviews?productId=${encodeURIComponent(product.id as string)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setReviews(d.data || []);
      })
      .finally(() => setReviewsLoading(false));
  }, [tab, product?.id]);

  if (loading) {
    return (
      <ShopContainer width="xl">
        <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
          <div className="skeleton aspect-square rounded-2xl" />
          <div className="space-y-4">
            <div className="skeleton h-8 w-2/3 rounded-lg" />
            <div className="skeleton h-6 w-1/3 rounded-lg" />
            <div className="skeleton h-40 w-full rounded-2xl" />
          </div>
        </div>
      </ShopContainer>
    );
  }

  if (!product) {
    return (
      <ShopContainer width="md">
        <div className="rounded-2xl border border-line bg-card p-12 text-center">
          <h1 className="text-xl font-bold text-ink">Product unavailable</h1>
          <p className="mt-2 text-sm text-ink-subtle">{error}</p>
          <Button href="/products" className="mt-6">
            Back to shop
          </Button>
        </div>
      </ShopContainer>
    );
  }

  const variants = (product.variants as Variant[]) || [];
  const images = (product.images as { url: string; alt?: string }[]) || [];
  const selected = variants.find((v) => v.id === variantId);
  const price = selected
    ? selected.salePrice && selected.salePrice < selected.price
      ? selected.salePrice
      : selected.price
    : (product.salePrice as number) &&
        (product.salePrice as number) < (product.price as number)
      ? (product.salePrice as number)
      : (product.price as number);
  const compareAt = selected ? selected.price : (product.price as number);
  const available = Math.max(
    0,
    selected ? selected.availableStock : Number(product.availableStock ?? 0)
  );
  const maxQty = Math.max(1, available);
  const atMax = qty >= available;
  const lowStockThreshold = Math.max(5, Number(product.lowStockThreshold ?? 5));
  const disc = discountPercent(compareAt, price < compareAt ? price : null);
  const store = product.store as { name: string; slug: string } | null;

  async function addToCart(buyNow = false) {
    if (!session?.user) {
      if (buyNow) {
        router.push(`/login?callbackUrl=/products/${slug}`);
        return;
      }
      const { addGuestItem, readGuestCart } = await import("@/lib/store/guest-cart");
      const inCart = readGuestCart()
        .filter(
          (i) => i.productId === product!.id && (i.variantId || null) === (variantId || null)
        )
        .reduce((sum, i) => sum + i.quantity, 0);
      if (inCart + qty > available) {
        const left = Math.max(0, available - inCart);
        setError(
          left > 0
            ? `Only ${available} available — you already have ${inCart} in your cart, so you can add ${left} more.`
            : `Only ${available} available and they're all in your cart already.`
        );
        return;
      }
      setError("");
      addGuestItem({
        productId: product!.id as string,
        variantId,
        quantity: qty,
        name: product!.name as string,
        unit: selected?.unit || (product!.unit as string),
        unitPrice: price,
        imageUrl: images[0]?.url || null,
        freeDelivery: Boolean(product!.freeDelivery),
      });
      bump();
      void refreshCartDeliveryProgress();
      toast.success(`${qty} × ${product!.name as string} added to cart`, {
        action: { label: "View cart", onClick: () => router.push("/cart") },
      });
      return;
    }
    if (qty > available) {
      setError(`Only ${available} available.`);
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product!.id,
          variantId,
          quantity: qty,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error);
      } else {
        bump();
        void refreshCartDeliveryProgress();
        if (buyNow) router.push("/checkout");
        else
          toast.success(`${qty} × ${product!.name as string} added to cart`, {
            action: { label: "View cart", onClick: () => router.push("/cart") },
          });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  const related = (product.related as ProductCardData[]) || [];
  const category = product.category as { name: string; slug: string } | null;
  const avgRating = product.avgRating as number | null;
  const reviewCount = Number(product.reviewCount ?? 0);
  const delivery = (product.delivery as { ratePerKm: number; freeDeliveryThreshold: number } | undefined) || {
    ratePerKm: 10,
    freeDeliveryThreshold: 5000,
  };
  const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;
  const weight = product.weight != null ? Number(product.weight) : null;
  const tags = ((product.tags as string[]) || []).filter(Boolean);
  const details: { label: string; value: string }[] = [
    { label: "Unit", value: (selected?.unit || (product.unit as string) || "").trim() },
    { label: "Weight", value: weight && weight > 0 ? `${weight} kg` : "" },
    { label: "Category", value: category?.name || "" },
    { label: "Sold by", value: store?.name || "" },
    { label: "Organic", value: product.isOrganic ? "Yes — marked organic by the store" : "" },
    { label: "Farm product", value: product.isFarmProduct ? "Yes" : "" },
    { label: "Seasonal", value: product.isSeasonal ? "Yes — available in season" : "" },
    { label: "Source", value: ((product.farmSourceInfo as string) || "").trim() },
    { label: "Urdu name", value: ((product.urduName as string) || "").trim() },
    { label: "SKU", value: ((product.sku as string) || "").trim() },
  ].filter((d) => d.value);

  return (
    <ShopContainer width="full">
      <Breadcrumbs
        items={[
          { label: "Products", href: "/products" },
          ...(category ? [{ label: category.name, href: `/products?category=${encodeURIComponent(category.slug)}` }] : []),
          { label: product.name as string },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_420px]">
        {/* Gallery */}
        <div>
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-line bg-slate-100">
            {images[imgIdx] ? (
              <Image
                src={images[imgIdx].url}
                alt={images[imgIdx].alt || (product.name as string)}
                fill
                className="object-cover"
                priority
                sizes="(max-width:1024px) 100vw, 55vw"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-ink-subtle">
                No image
              </div>
            )}
            {disc > 0 && (
              <span className="absolute left-3 top-3 rounded-lg bg-deal-500 px-2.5 py-1 text-xs font-bold text-white">
                -{disc}% OFF
              </span>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImgIdx(i)}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                    i === imgIdx ? "border-brand-600 ring-2 ring-brand-100" : "border-transparent"
                  }`}
                >
                  <Image src={img.url} alt="" fill className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box — sticky */}
        <div className="lg:sticky lg:top-36 lg:self-start">
          <div className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
            {store?.name && (
              <Link
                href={`/stores/${store.slug}`}
                className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600 hover:underline"
              >
                <Store className="h-3.5 w-3.5" />
                {store.name}
              </Link>
            )}

            <h1 className="text-xl font-extrabold leading-snug text-ink sm:text-2xl">
              {product.name as string}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {reviewCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setTab("reviews")}
                  className="hover:underline"
                  aria-label="Read reviews"
                >
                  <RatingStars avg={avgRating} count={reviewCount} size="md" />
                </button>
              ) : (
                <span className="text-xs text-ink-subtle">No ratings yet</span>
              )}
              {Boolean(product.isOrganic) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Leaf className="h-3 w-3" /> Organic
                </span>
              )}
            </div>

            {Boolean(product.shortDescription) && (
              <p className="mt-3 text-sm text-ink-subtle">{product.shortDescription as string}</p>
            )}

            <div className="mt-5 flex flex-wrap items-baseline gap-2 border-b border-line pb-5">
              <span className="text-3xl font-extrabold text-ink">
                {formatCurrency(price)}
              </span>
              {compareAt > price && (
                <span className="text-lg text-ink-subtle line-through">
                  {formatCurrency(compareAt)}
                </span>
              )}
              <span className="text-sm text-ink-subtle">
                / {selected?.unit || (product.unit as string)}
              </span>
            </div>

            {variants.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-subtle">
                  Select option
                </p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariantId(v.id)}
                      disabled={v.availableStock <= 0}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                        variantId === v.id
                          ? "border-brand-600 bg-brand-50 text-brand-700"
                          : "border-line bg-card text-ink-muted hover:border-brand-300"
                      } disabled:opacity-40`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center gap-4">
              <div className="flex items-center rounded-xl border border-line bg-app">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  className="rounded-l-xl p-2.5 text-ink-muted hover:bg-slate-100 disabled:opacity-40"
                  disabled={qty <= 1}
                  onClick={() => {
                    setError("");
                    setQty((q) => Math.max(1, q - 1));
                  }}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-10 text-center font-semibold" aria-live="polite">{qty}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  className="rounded-r-xl p-2.5 text-ink-muted hover:bg-slate-100 disabled:opacity-40"
                  disabled={available <= 0 || atMax}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm font-medium">
                {available <= 0 ? (
                  <span className="text-deal-600">Out of stock</span>
                ) : available <= lowStockThreshold || atMax ? (
                  <span className="text-amber-600">Only {available} left</span>
                ) : (
                  <span className="text-emerald-600">In stock</span>
                )}
              </p>
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                disabled={adding || available <= 0}
                onClick={() => addToCart(false)}
                className="flex-1"
                size="lg"
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {adding ? "Adding…" : "Add to cart"}
              </Button>
              <Button
                variant="secondary"
                disabled={adding || available <= 0}
                onClick={() => addToCart(true)}
                className="flex-1"
                size="lg"
              >
                Buy now
              </Button>
            </div>

            <div className="mt-5 space-y-2 border-t border-line pt-5">
              {[
                {
                  icon: Truck,
                  text: product.freeDelivery
                    ? "Free delivery on this product"
                    : `Delivery ${rs(delivery.ratePerKm)}/km (go + return) · Free on ${rs(delivery.freeDeliveryThreshold)}+`,
                },
                {
                  icon: Truck,
                  text: "Delivery within 48 hours after order confirmation",
                },
                { icon: ShieldCheck, text: "Sold by a store approved by MandiBazaar" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-xs text-ink-subtle">
                  <Icon className="h-4 w-4 text-brand-500" />
                  {text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-10">
        <div className="flex gap-1 overflow-x-auto border-b border-line scrollbar-hide">
          {(
            [
              { id: "desc" as const, label: "Description" },
              { id: "info" as const, label: "Details" },
              { id: "delivery" as const, label: "Delivery & payment" },
              { id: "reviews" as const, label: reviewCount > 0 ? `Reviews (${reviewCount})` : "Reviews" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold transition ${
                tab === t.id
                  ? "border-b-2 border-brand-600 text-brand-700"
                  : "text-ink-subtle hover:text-ink-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="rounded-b-2xl border border-t-0 border-line bg-card p-6 text-sm leading-relaxed text-ink-muted">
          {tab === "desc" && (
            <p className="whitespace-pre-line">
              {(product.description as string) ||
                (product.shortDescription as string) ||
                "No description available."}
            </p>
          )}
          {tab === "info" && (
            <div className="space-y-4">
              {details.length > 0 && (
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {details.map((d) => (
                    <div key={d.label} className="flex gap-2 border-b border-line pb-2">
                      <dt className="w-28 shrink-0 font-semibold text-ink">{d.label}</dt>
                      <dd className="min-w-0 break-words">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {Boolean(product.shortDescription) && Boolean(product.description) && (
                <div>
                  <h3 className="font-semibold text-ink">Summary</h3>
                  <p className="mt-1">{product.shortDescription as string}</p>
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Link
                      key={t}
                      href={`/products?q=${encodeURIComponent(t)}`}
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-ink-muted hover:bg-brand-50 hover:text-brand-700"
                    >
                      {t}
                    </Link>
                  ))}
                </div>
              )}
              {Boolean(product.ingredients) && (
                <div>
                  <h3 className="font-semibold text-ink">Ingredients</h3>
                  <p className="mt-1">{product.ingredients as string}</p>
                </div>
              )}
              {Boolean(product.nutritionInfo) && (
                <div>
                  <h3 className="font-semibold text-ink">Nutrition</h3>
                  <p className="mt-1">{product.nutritionInfo as string}</p>
                </div>
              )}
              {!details.length && !product.ingredients && !product.nutritionInfo && (
                <p>No additional details listed.</p>
              )}
              <p className="text-xs text-ink-subtle">
                Product details are provided by the store.
              </p>
            </div>
          )}
          {tab === "delivery" && (
            <div className="space-y-3 text-sm text-ink-muted">
              <p>
                {product.freeDelivery
                  ? `This product includes free delivery from the store. If your cart only has free-delivery products, no delivery fee is charged. Orders of ${rs(delivery.freeDeliveryThreshold)}+ also get free delivery.`
                  : `Delivery fee is paid online (${rs(delivery.ratePerKm)}/km, go + return), unless your order is ${rs(delivery.freeDeliveryThreshold)}+ or all products in the cart are marked free delivery by stores. Product amount can be paid online or in cash to the rider.`}
              </p>
              <p className="font-medium text-brand-800">
                Delivery within 48 hours after your order is confirmed.
              </p>
            </div>
          )}
          {tab === "reviews" && (
            <div className="space-y-4">
              {reviewsLoading && <p className="text-ink-subtle">Loading reviews…</p>}
              {!reviewsLoading && !reviews.length && (
                <p className="text-ink-subtle">No reviews yet for this product.</p>
              )}
              {reviews.map((r) => (
                <div key={r.id} className="border-b border-line pb-4 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="flex text-amber-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${i < r.rating ? "fill-current" : "text-slate-200"}`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-semibold text-ink-muted">
                      {r.user?.fullName || "Customer"}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {r.comment && <p className="mt-2">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-extrabold text-ink">You may also like</h2>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.id} product={r} />
            ))}
          </div>
        </section>
      )}
    </ShopContainer>
  );
}
