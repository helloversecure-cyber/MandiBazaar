"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { ORDER_STATUS_LABELS } from "@/lib/orders/state-machine";
import { Pagination } from "@/components/ui/Pagination";
import { OrderStatus } from "@prisma/client";

const PAGE_SIZE = 25;

type Order = {
  id: string;
  orderNumber: string;
  createdAt: string;
  grandTotal: number;
  orderStatus: OrderStatus;
  remainingAmount: number;
  productPaymentStatus: string;
  deliveryFeePaid: number;
  productAmountPaid: number;
  /** Full cash on delivery: delivery fee is collected in cash by the rider */
  fullCod?: boolean;
  cashDue?: { products: number; delivery: number; total: number };
  customer: { fullName: string; phone: string | null } | null;
  customerPhone: string | null;
  customerPhoneSource: "account" | "address" | null;
  accountPhoneInvalid: boolean;
  stores: string[];
  rider?: { name: string } | null;
  waitingFlag: string | null;
};

const STATUS_BADGE: Partial<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-red-100 text-red-700",
  FAILED: "bg-red-100 text-red-700",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  RETURNED: "bg-slate-100 text-ink-muted",
};

function AdminOrdersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const status = sp.get("status") || "";
  const q = sp.get("q") || "";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const storeId = sp.get("storeId") || "";
  const waiting = sp.get("waiting") === "1";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);

  const [search, setSearch] = useState(q);
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => setSearch(q), [q]);

  const setParams = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [sp, router, pathname]
  );

  useEffect(() => {
    fetch("/api/orders?meta=stores")
      .then((r) => r.json())
      .then((d) => d.success && setStores(d.data.stores || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (storeId) params.set("storeId", storeId);
    if (waiting) params.set("waiting", "1");
    setLoading(true);
    setError("");
    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setOrders(d.data.items);
          setTotal(d.data.pagination.total);
          setTotalPages(d.data.pagination.totalPages);
        } else {
          setOrders([]);
          setError(d.error || "Could not load orders");
        }
      })
      .catch(() => setError("Could not load orders"))
      .finally(() => setLoading(false));
  }, [status, q, from, to, storeId, waiting, page]);

  const hasFilters = !!(status || q || from || to || storeId || waiting);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Orders</h1>
      </div>

      <form
        className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: search.trim() || null });
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order number, customer name or phone"
          aria-label="Search orders"
          className="rounded-xl border border-line bg-card px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={status}
          onChange={(e) => setParams({ status: e.target.value || null })}
          aria-label="Status"
          className="rounded-xl border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.keys(ORDER_STATUS_LABELS).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s as OrderStatus]}
            </option>
          ))}
        </select>
        <select
          value={storeId}
          onChange={(e) => setParams({ storeId: e.target.value || null })}
          aria-label="Store"
          className="rounded-xl border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6">
          <button
            type="submit"
            className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Search
          </button>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={waiting}
              onChange={(e) => setParams({ waiting: e.target.checked ? "1" : null })}
            />
            Only orders waiting too long
          </label>
          {hasFilters && (
            <button
              type="button"
              className="text-sm text-leaf-600 underline"
              onClick={() => router.replace(pathname)}
            >
              Clear filters
            </button>
          )}
        </div>
      </form>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-brand-50 dark:bg-brand-500/10">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Paid / Remaining</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-subtle">
                  {hasFilters ? "No orders match these filters" : "No orders yet"}
                </td>
              </tr>
            )}
            {!loading &&
              orders.map((o) => (
                <tr
                  key={o.id}
                  className={`border-t border-line align-top ${
                    o.waitingFlag ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                    <span className="block text-xs text-ink-subtle">
                      {new Date(o.createdAt).toLocaleString("en-PK")}
                    </span>
                    {o.waitingFlag && (
                      <span className="mt-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                        {o.waitingFlag}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {o.customer?.fullName || "—"}
                    <span className="block text-xs text-ink-subtle">
                      {o.customerPhone || "No valid phone"}
                      {o.customerPhoneSource === "address" && " (delivery address)"}
                    </span>
                    {o.accountPhoneInvalid && (
                      <span className="block text-[10px] text-amber-700">
                        Account phone is not a valid number
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {o.stores?.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">{formatCurrency(o.grandTotal)}</td>
                  <td className="px-4 py-3 text-xs">
                    Delivery: {formatCurrency(o.deliveryFeePaid)}
                    {o.fullCod ? " · Cash (rider)" : ""}
                    <br />
                    Products: {formatCurrency(o.productAmountPaid)}
                    <br />
                    To collect: {formatCurrency(o.remainingAmount)}
                    {o.cashDue && o.cashDue.delivery > 0 ? " (incl. delivery)" : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        STATUS_BADGE[o.orderStatus] || "bg-brand-50 dark:bg-brand-500/10 text-ink"
                      }`}
                    >
                      {ORDER_STATUS_LABELS[o.orderStatus]}
                    </span>
                    {o.rider?.name && (
                      <span className="mt-1 block text-xs text-ink-subtle">Rider: {o.rider.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${encodeURIComponent(o.orderNumber)}`}
                      className="font-semibold text-leaf-600"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pagination
        className="mt-4"
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        itemLabel="orders"
        onPageChange={(p) => setParams({ page: p > 1 ? String(p) : null }, false)}
      />
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<div className="skeleton h-40 rounded-3xl" />}>
      <AdminOrdersInner />
    </Suspense>
  );
}
