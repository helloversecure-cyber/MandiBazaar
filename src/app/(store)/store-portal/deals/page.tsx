"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Tag, Percent } from "lucide-react";
import { discountPercent, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/FieldLabel";

type Product = {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  stockQuantity: number;
  status: string;
  store: { name: string };
  images: { url: string }[];
};

export default function StoreDealsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [dealPrice, setDealPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/store?resource=products");
    const data = await res.json();
    if (data.success) {
      const items: Product[] = data.data.items || [];
      setProducts(items);
      if (!productId && items[0]) setProductId(items[0].id);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  const activeDeals = products.filter(
    (p) => p.salePrice != null && p.salePrice < p.price
  );

  const previewPct =
    selected && dealPrice
      ? discountPercent(selected.price, Number(dealPrice))
      : selected
        ? discountPercent(selected.price, selected.salePrice)
        : 0;

  async function createOrUpdateDeal(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!productId || !dealPrice) {
      setMsg("Select a product and enter deal price");
      return;
    }
    const sale = Number(dealPrice);
    const base = selected?.price || 0;
    if (!Number.isInteger(sale) || sale < 1 || sale > 1_000_000) {
      setMsg("Deal price must be a whole number of rupees from 1 to 1,000,000");
      return;
    }
    if (sale >= base) {
      setMsg("Deal price must be lower than the regular price");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/store", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPDATE_PRODUCT",
        productId,
        salePrice: sale,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.success) {
      setMsg(data.error || "Failed to create deal");
      return;
    }
    setMsg(
      data.data?.pendingReview
        ? data.data.message ||
            "This deal changes the price by more than 20% — it was sent to MandiBazaar for review."
        : selected && selected.status !== "ACTIVE"
          ? "Deal saved. It will show under Deals once this product is approved and active."
          : "Deal live — customers will see this under Deals."
    );
    setDealPrice("");
    load();
  }

  async function removeDeal(id: string) {
    setMsg("");
    setLoading(true);
    const res = await fetch("/api/store", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPDATE_PRODUCT",
        productId: id,
        salePrice: null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.success) {
      setMsg(data.error || "Failed to remove deal");
      return;
    }
    setMsg("Deal removed");
    load();
  }

  useEffect(() => {
    if (selected?.salePrice != null) {
      setDealPrice(String(selected.salePrice));
    } else {
      setDealPrice("");
    }
  }, [selected?.id, selected?.salePrice]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-ink">Deals</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Create a deal on any of your products. It will show on the shop{" "}
            <Link href="/products?sort=discount" className="font-medium text-brand-600 underline">
              Deals
            </Link>{" "}
            page for customers.
          </p>
        </div>
        <Link
          href="/store-portal/products"
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          Manage products →
        </Link>
      </div>

      <form
        onSubmit={createOrUpdateDeal}
        className="mt-6 space-y-4 rounded-2xl border border-deal-500/20 bg-card p-5 shadow-card"
      >
        <div className="flex items-center gap-2 text-deal-600">
          <Tag className="h-5 w-5" />
          <h2 className="text-lg font-bold">Create / update deal</h2>
        </div>

        {products.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            No products yet.{" "}
            <Link href="/store-portal/products" className="font-semibold text-brand-600 underline">
              Add a product
            </Link>{" "}
            first, then create a deal.
          </p>
        ) : (
          <>
            <div>
              <FieldLabel required>Product</FieldLabel>
              <select
                className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:bg-card"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — regular {formatCurrency(p.price)}
                    {p.salePrice != null && p.salePrice < p.price
                      ? ` (deal ${formatCurrency(p.salePrice)})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <div className="rounded-xl border border-line bg-app px-4 py-3 text-sm text-ink-muted">
                Regular price:{" "}
                <strong className="text-ink">
                  {formatCurrency(selected.price)}
                </strong>
                {previewPct > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-deal-500/10 px-2 py-0.5 text-xs font-bold text-deal-600">
                    <Percent className="h-3 w-3" />
                    {previewPct}% OFF
                  </span>
                )}
              </div>
            )}

            <div>
              <FieldLabel required>Deal price (Rs.)</FieldLabel>
              <input
                type="number"
                min="1"
                step="1"
                className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:bg-card"
                placeholder="Lower than regular price"
                max={1000000}
                value={dealPrice}
                onChange={(e) => setDealPrice(e.target.value)}
                required
              />
              {selected && dealPrice && Number(dealPrice) > 0 && (
                <p
                  className={`mt-1 text-sm font-bold ${
                    Number(dealPrice) < selected.price ? "text-deal-600" : "text-red-600"
                  }`}
                >
                  {Number(dealPrice) < selected.price
                    ? `${discountPercent(selected.price, Number(dealPrice))}% off — customers save ${formatCurrency(
                        selected.price - Number(dealPrice)
                      )}`
                    : "Must be lower than the regular price"}
                </p>
              )}
              <p className="mt-1 text-xs text-ink-subtle">
                Must be less than the regular price to appear under Deals. Discounts
                of more than 20% are checked by MandiBazaar before they go live.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Publish deal"}
              </Button>
              {msg && (
                <span
                  className={`text-sm ${
                    msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("must") || msg.toLowerCase().includes("select")
                      ? "text-red-600"
                      : "text-brand-600"
                  }`}
                >
                  {msg}
                </span>
              )}
            </div>
          </>
        )}
      </form>

      <div className="mt-8">
        <h2 className="font-bold text-ink">
          Active deals ({activeDeals.length})
        </h2>
        {activeDeals.length === 0 ? (
          <p className="mt-3 text-sm text-ink-subtle">
            No deals yet. Create one above — every store can run its own deals.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {activeDeals.map((p) => {
              const pct = discountPercent(p.price, p.salePrice);
              return (
                <div
                  key={p.id}
                  className="flex gap-4 rounded-xl border border-deal-500/20 bg-card p-4 shadow-card"
                >
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {p.images[0]?.url ? (
                      <Image
                        src={p.images[0].url}
                        alt={p.name}
                        fill
                        className="object-cover"
                        sizes="64px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-ink-subtle">
                        No photo
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{p.name}</p>
                      <span className="rounded-full bg-deal-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        {pct}% OFF
                      </span>
                    </div>
                    <p className="mt-1 text-sm">
                      <span className="text-ink-subtle line-through">
                        {formatCurrency(p.price)}
                      </span>{" "}
                      <span className="font-bold text-deal-600">
                        {formatCurrency(p.salePrice!)}
                      </span>
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {p.store.name} · {p.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setProductId(p.id);
                        setDealPrice(String(p.salePrice));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={loading}
                      onClick={() => removeDeal(p.id)}
                    >
                      End deal
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
