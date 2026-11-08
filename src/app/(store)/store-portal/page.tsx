"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { storeOrderStatusLabel } from "@/lib/stores/fulfillment-rules";
import { Package, ShoppingCart, TrendingUp, Wallet } from "lucide-react";

type RecentProduct = {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  stockQuantity: number;
  status: string;
  images: { url: string }[];
  moderationNote?: string | null;
  pendingChanges?: unknown;
};

function StoreDashboardContent() {
  const searchParams = useSearchParams();
  const appliedMsg = searchParams.get("msg");
  const [data, setData] = useState<{
    productCount?: number;
    pendingFulfillments?: number;
    salesThisWeek?: number;
    pendingPayout?: number;
    storeNotices?: { id: string; name: string; status: string; reason: string | null }[];
    recentOrders?: {
      id: string;
      subtotal: number;
      status: string;
      store: { name: string };
      order: { orderNumber: string; orderStatus?: string };
    }[];
    message?: string;
  } | null>(null);
  const [products, setProducts] = useState<RecentProduct[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  async function refresh() {
    try {
      setLoadFailed(false);
      const [dash, prods] = await Promise.all([
        fetch("/api/store?resource=dashboard").then((r) => r.json()),
        fetch("/api/store?resource=products").then((r) => r.json()),
      ]);
      if (dash.success) setData(dash.data);
      if (prods.success) setProducts((prods.data.items || []).slice(0, 8));
      if (!dash.success) setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function deleteProduct(p: RecentProduct) {
    const { confirmed } = await confirm({
      title: `Delete “${p.name}”?`,
      message: "It will be removed from your store and hidden from customers. Past orders stay safe.",
      confirmLabel: "Delete product",
      tone: "danger",
    });
    if (!confirmed) return;
    setActionMsg("");
    setDeletingId(p.id);
    try {
      const res = await fetch("/api/store", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "DELETE_PRODUCT",
          productId: p.id,
        }),
      });
      const body = await res.json();
      if (!body.success) {
        setActionMsg(body.error || "Could not delete product");
        return;
      }
      toast.success("Product deleted");
      await refresh();
    } finally {
      setDeletingId(null);
    }
  }

  if (!data)
    return loadFailed ? (
      <div className="py-16 text-center text-ink-subtle">
        <p>Couldn’t load your dashboard.</p>
        <button onClick={() => void refresh()} className="mt-3 text-sm font-semibold text-ink underline">
          Try again
        </button>
      </div>
    ) : (
      <p>Loading…</p>
    );

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Store dashboard</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Manage your MandiBazaar store. Riders are handled by the platform.
      </p>

      {appliedMsg && (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {appliedMsg}
        </div>
      )}

      {actionMsg && (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            actionMsg.toLowerCase().includes("could not") ||
            actionMsg.toLowerCase().includes("cannot")
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {actionMsg}
        </div>
      )}

      {(data.storeNotices || []).map((n) => (
        <div
          key={n.id}
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            n.status === "PENDING"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <strong>{n.name}</strong>:{" "}
          {n.status === "PENDING"
            ? "waiting for MandiBazaar approval."
            : n.status === "SUSPENDED"
              ? "suspended by MandiBazaar."
              : "application rejected by MandiBazaar."}
          {n.reason ? ` Reason: ${n.reason}` : ""}
        </div>
      ))}

      {data.message && (
        <div className="mt-6 rounded-2xl border border-accent-100 bg-accent-50 dark:bg-accent-500/10 p-4 text-sm">
          {data.message}{" "}
          <Link
            href="/store?tab=signup&add=1"
            className="font-medium underline"
          >
            Apply for a store
          </Link>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/store-portal/payouts"
          className="rounded-2xl bg-card p-5 shadow-card transition hover:ring-2 hover:ring-brand-200"
        >
          <p className="flex items-center gap-1.5 text-sm text-ink-subtle">
            <TrendingUp className="h-3.5 w-3.5" /> Sales this week
          </p>
          <p className="mt-1 font-display text-3xl">{formatCurrency(data.salesThisWeek ?? 0)}</p>
          <p className="mt-2 text-xs text-ink-subtle">Paid / confirmed orders in the last 7 days</p>
        </Link>
        <Link
          href="/store-portal/payouts"
          className="rounded-2xl bg-card p-5 shadow-card transition hover:ring-2 hover:ring-brand-200"
        >
          <p className="flex items-center gap-1.5 text-sm text-ink-subtle">
            <Wallet className="h-3.5 w-3.5" /> Pending payout
          </p>
          <p className="mt-1 font-display text-3xl">{formatCurrency(data.pendingPayout ?? 0)}</p>
          <p className="mt-2 text-xs font-medium text-brand-600">See payouts →</p>
        </Link>
        <Link
          href="/store-portal/products"
          className="rounded-2xl bg-card p-5 shadow-card transition hover:ring-2 hover:ring-brand-200"
        >
          <p className="flex items-center gap-1.5 text-sm text-ink-subtle">
            <Package className="h-3.5 w-3.5" /> Products
          </p>
          <p className="mt-1 font-display text-3xl">{data.productCount ?? 0}</p>
          <p className="mt-2 text-xs font-medium text-brand-600">
            View & update products →
          </p>
        </Link>
        <Link
          href="/store-portal/orders"
          className="rounded-2xl bg-card p-5 shadow-card transition hover:ring-2 hover:ring-brand-200"
        >
          <p className="flex items-center gap-1.5 text-sm text-ink-subtle">
            <ShoppingCart className="h-3.5 w-3.5" /> Orders to prepare
          </p>
          <p className="mt-1 font-display text-3xl">
            {data.pendingFulfillments ?? 0}
          </p>
          <p className="mt-2 text-xs font-medium text-brand-600">
            Open orders →
          </p>
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl">Your products</h2>
          <p className="text-sm text-ink-subtle">
            Products you listed — tap Edit to change price, stock, or photos.
          </p>
        </div>
        <Link
          href="/store-portal/products"
          className="text-sm font-semibold text-brand-600 hover:underline"
        >
          Manage all products →
        </Link>
      </div>

      <div className="mt-3 space-y-2">
        {products.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-card"
          >
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
              {p.images[0]?.url ? (
                <Image
                  src={p.images[0].url}
                  alt={p.name}
                  fill
                  className="object-cover"
                  sizes="48px"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{p.name}</p>
              <p className="text-xs text-ink-subtle">
                {p.status} · stock {p.stockQuantity} ·{" "}
                {formatCurrency(p.salePrice ?? p.price)}
              </p>
              {Boolean(p.pendingChanges) && (
                <p className="text-xs font-medium text-sky-700">Changes pending review</p>
              )}
              {p.moderationNote && !p.pendingChanges && (
                <p className="text-xs text-red-700">Declined by MandiBazaar: {p.moderationNote}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/store-portal/products?edit=${p.id}`}
                className="rounded-full bg-brand-50 dark:bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-app"
              >
                Edit
              </Link>
              <button
                type="button"
                disabled={deletingId === p.id}
                onClick={() => void deleteProduct(p)}
                className="rounded-full border border-red-200 bg-card px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                {deletingId === p.id ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
        {!products.length && (
          <div className="rounded-xl border border-dashed border-line bg-card px-4 py-8 text-center">
            <p className="text-sm text-ink-subtle">No products yet.</p>
            <Link
              href="/store-portal/products"
              className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline"
            >
              Add your first product →
            </Link>
          </div>
        )}
      </div>

      <Link
        href="/store-portal/deals"
        className="mt-6 flex items-center justify-between rounded-2xl border border-deal-500/30 bg-gradient-to-r from-deal-500/10 to-accent-50 px-5 py-4 transition hover:border-deal-500/50"
      >
        <div>
          <p className="text-sm font-bold text-deal-600">Create a deal</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Put any product on discount — it shows under shop Deals for customers
          </p>
        </div>
        <span className="text-sm font-bold text-deal-600">Deals →</span>
      </Link>

      <h2 className="mt-10 font-display text-xl">Recent orders</h2>
      <div className="mt-3 space-y-2">
        {(data.recentOrders || []).map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between rounded-xl bg-card px-4 py-3 text-sm shadow-card"
          >
            <div>
              <p className="font-medium">{o.order.orderNumber}</p>
              <p className="text-ink-subtle">
                {o.store.name} ·{" "}
                {storeOrderStatusLabel(o.order.orderStatus || "", o.status)}
              </p>
            </div>
            <p>{formatCurrency(o.subtotal)}</p>
          </div>
        ))}
        {!data.recentOrders?.length && (
          <p className="text-sm text-ink-subtle">No orders yet.</p>
        )}
      </div>
    </div>
  );
}

export default function StoreDashboardPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <StoreDashboardContent />
    </Suspense>
  );
}
