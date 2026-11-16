"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { plural } from "@/lib/portal/format";
import {
  CUSTOMER_ORDER_FILTERS,
  isCustomerOrderFilter,
  type CustomerOrderFilter,
} from "@/lib/portal/customer-orders";

type OrderRow = {
  orderNumber: string;
  createdAt: string;
  grandTotal: number;
  orderStatus: string;
  productPaymentStatus: string;
  remainingAmount: number;
  itemCount: number;
};

const PAGE_SIZE = 10;

function statusClass(s: string) {
  if (s === "DELIVERED") return "bg-emerald-100 text-emerald-700";
  if (["CANCELLED", "FAILED", "RETURNED"].includes(s)) return "bg-red-100 text-red-700";
  if (s === "PENDING_PAYMENT") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-ink-muted";
}

function OrdersContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const rawFilter = sp.get("status") || "all";
  const filter: CustomerOrderFilter = isCustomerOrderFilter(rawFilter) ? rawFilter : "all";
  const qParam = (sp.get("q") || "").trim();
  const [search, setSearch] = useState(qParam);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ filter, page: String(page), limit: String(PAGE_SIZE) });
    if (qParam) params.set("q", qParam);
    fetch(`/api/account/orders?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setOrders(d.data.items || []);
          setTotal(d.data.pagination?.total || 0);
          setTotalPages(d.data.pagination?.totalPages || 1);
          setCounts(d.data.counts || {});
        }
      })
      .finally(() => setLoading(false));
  }, [filter, page, qParam]);

  function hrefFor(p: number, f: CustomerOrderFilter = filter) {
    const params = new URLSearchParams();
    if (f !== "all") params.set("status", f);
    if (qParam) params.set("q", qParam);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/account/orders${qs ? `?${qs}` : ""}`;
  }

  // R8: search My orders by order number.
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    const term = search.trim();
    if (term) params.set("q", term);
    const qs = params.toString();
    router.push(`/account/orders${qs ? `?${qs}` : ""}`);
  }

  const allCount = counts.all ?? total;

  return (
    <div>
      <PageHeader title="My orders" subtitle={plural(allCount, "order")} badge="Orders" />

      <form onSubmit={submitSearch} className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order number (e.g. ORD-…)"
          maxLength={30}
          className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
          aria-label="Search orders by number"
        />
        <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
        {qParam && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              const p = new URLSearchParams();
              if (filter !== "all") p.set("status", filter);
              const qs = p.toString();
              router.push(`/account/orders${qs ? `?${qs}` : ""}`);
            }}
            className="rounded-xl px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        )}
      </form>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {CUSTOMER_ORDER_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => router.push(hrefFor(1, f.key))}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.key ? "bg-brand-600 text-white" : "bg-card text-ink-muted ring-1 ring-line"
            }`}
          >
            {f.label}
            {counts[f.key] != null ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-app text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-3 font-semibold">Order #</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Payment</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderNumber} className="border-t border-line">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/account/orders/${o.orderNumber}`}
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                    <p className="text-xs text-ink-subtle">{plural(o.itemCount, "item")}</p>
                  </td>
                  <td className="px-5 py-3.5 text-ink-muted">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 font-medium">{formatCurrency(o.grandTotal)}</td>
                  <td className="px-5 py-3.5 text-ink-muted">
                    {o.remainingAmount > 0
                      ? `Remaining ${formatCurrency(o.remainingAmount)}`
                      : o.productPaymentStatus.replace(/_/g, " ").toLowerCase()}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(o.orderStatus)}`}>
                      {o.orderStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {o.orderStatus === "PENDING_PAYMENT" && (
                      <Link
                        href={`/account/orders/${o.orderNumber}`}
                        className="press mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-600"
                      >
                        Complete payment →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-ink-subtle">
                    {loading
                      ? "Loading orders…"
                      : filter === "all"
                        ? "No orders yet"
                        : "No orders in this filter"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        hrefFor={(p) => hrefFor(p)}
        itemLabel="orders"
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-2xl" />}>
      <OrdersContent />
    </Suspense>
  );
}
