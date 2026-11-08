"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/feedback";
import { plural } from "@/lib/portal/format";
import {
  STORE_FULFILLMENT_LABELS,
  STORE_ORDER_TABS,
  storeFulfillmentActions,
  storeOrderStatusLabel,
  type StoreOrderTab,
} from "@/lib/stores/fulfillment-rules";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

type Item = {
  id: string;
  productName: string;
  variantName: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
};

type Fulfillment = {
  id: string;
  status: string;
  subtotal: number;
  itemCount: number;
  notes: string | null;
  createdAt: string;
  store: { name: string };
  order: {
    orderNumber: string;
    orderStatus: string;
    productPaymentStatus: string;
    deliveryFeePaymentStatus: string;
    paymentMethod: string;
    notes: string | null;
    cancelReason: string | null;
    createdAt: string;
    deliveryArea: string | null;
    customer: { fullName: string; phone: string | null };
    items: Item[];
    rider?: { name: string; phone: string | null; vehicleType?: string | null } | null;
  };
};

const PAGE_SIZE = 20;

function badgeClass(orderStatus: string, status: string) {
  if (["CANCELLED", "FAILED", "RETURNED"].includes(orderStatus)) return "bg-red-100 text-red-700";
  if (orderStatus === "PENDING_PAYMENT") return "bg-amber-100 text-amber-800";
  if (orderStatus === "DELIVERED") return "bg-emerald-100 text-emerald-700";
  if (["READY_FOR_DISPATCH", "ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"].includes(status)) return "bg-sky-100 text-sky-800";
  return "bg-brand-100 text-brand-800";
}

export default function StoreOrdersPage() {
  const toast = useToast();
  const [items, setItems] = useState<Fulfillment[]>([]);
  const [tab, setTab] = useState<StoreOrderTab>("prepare");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [openId, setOpenId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        resource: "orders",
        tab,
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/store?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setItems(data.data.items || []);
        setCounts(data.data.counts || {});
        setTotal(data.data.pagination?.total || 0);
        setTotalPages(data.data.pagination?.totalPages || 1);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(f: Fulfillment, status: string) {
    setBusyId(f.id);
    try {
      const res = await fetch("/api/store", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FULFILLMENT_STATUS", fulfillmentId: f.id, status }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Could not update this order");
      } else {
        toast.success(
          status === "READY_FOR_DISPATCH"
            ? `${f.order.orderNumber} is ready for pickup — a rider will be assigned`
            : `${f.order.orderNumber} updated`
        );
      }
    } finally {
      setBusyId("");
      void load();
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Store orders</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Prepare paid orders and mark them ready for pickup. Platform riders collect and deliver.
        Unpaid and cancelled orders can&apos;t be prepared.
      </p>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {STORE_ORDER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`press whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === t.key
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-card text-ink-muted ring-1 ring-line hover:text-ink hover:ring-brand-300"
            }`}
          >
            {t.label}
            {counts[t.key] != null ? ` (${counts[t.key]})` : ""}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(qInput.trim());
        }}
      >
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
            placeholder="Order number or customer name"
            maxLength={60}
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              if (!e.target.value) {
                setQ("");
                setPage(1);
              }
            }}
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      <div className="mt-5 space-y-3">
        {loading && <p className="text-sm text-ink-subtle">Loading orders…</p>}
        {!loading && items.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-card px-4 py-10 text-center text-sm text-ink-subtle">
            {q ? "No orders match this search." : "No orders in this tab."}
          </p>
        )}
        {items.map((f) => {
          const actions = storeFulfillmentActions({
            orderStatus: f.order.orderStatus,
            productPaymentStatus: f.order.productPaymentStatus,
            deliveryFeePaymentStatus: f.order.deliveryFeePaymentStatus,
            fulfillmentStatus: f.status,
          });
          // Next single step + shortcut to "ready"
          const next = actions[0];
          const open = openId === f.id;
          const qty = f.order.items.reduce((s, i) => s + i.quantity, 0);
          return (
            <div key={f.id} className="rounded-2xl bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{f.order.orderNumber}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeClass(
                        f.order.orderStatus,
                        f.status
                      )}`}
                    >
                      {storeOrderStatusLabel(f.order.orderStatus, f.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-subtle">
                    {f.order.customer.fullName}
                    {f.order.deliveryArea ? ` · ${f.order.deliveryArea}` : ""} ·{" "}
                    {new Date(f.order.createdAt).toLocaleDateString()} · {plural(qty, "item")}
                  </p>
                  {f.order.rider && (
                    <p className="mt-1 text-xs text-ink-muted">
                      Rider: {f.order.rider.name}
                      {f.order.rider.phone ? ` · ${f.order.rider.phone}` : ""}
                      {f.order.rider.vehicleType ? ` · ${f.order.rider.vehicleType}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{formatCurrency(f.subtotal)}</span>
                  {next && (
                    <Button
                      type="button"
                      size="sm"
                      variant={next === "READY_FOR_DISPATCH" ? "primary" : "outline"}
                      disabled={busyId === f.id}
                      onClick={() => void advance(f, next)}
                    >
                      {STORE_FULFILLMENT_LABELS[next]}
                    </Button>
                  )}
                  {next && next !== "READY_FOR_DISPATCH" && actions.includes("READY_FOR_DISPATCH") && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === f.id}
                      onClick={() => void advance(f, "READY_FOR_DISPATCH")}
                    >
                      Mark ready for pickup
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? "" : f.id)}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                    aria-expanded={open}
                  >
                    {open ? "Hide" : "View order"}
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {open && (
                <div className="mt-4 space-y-3 border-t border-line pt-3 text-sm">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p>
                      <span className="text-ink-subtle">Customer: </span>
                      {f.order.customer.fullName}
                      {f.order.customer.phone ? ` · ${f.order.customer.phone}` : ""}
                    </p>
                    <p>
                      <span className="text-ink-subtle">Delivery area: </span>
                      {f.order.deliveryArea || "—"}
                    </p>
                    <p>
                      <span className="text-ink-subtle">Payment: </span>
                      {f.order.paymentMethod.replace(/_/g, " ").toLowerCase()} ·{" "}
                      {f.order.productPaymentStatus.replace(/_/g, " ").toLowerCase()}
                    </p>
                    {f.order.cancelReason && (
                      <p className="text-red-700">
                        <span className="text-ink-subtle">Reason: </span>
                        {f.order.cancelReason}
                      </p>
                    )}
                  </div>
                  {(f.order.notes || f.notes) && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                      <span className="font-semibold">Notes: </span>
                      {[f.order.notes, f.notes].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[360px] text-left text-sm">
                      <thead className="text-xs uppercase text-ink-subtle">
                        <tr>
                          <th className="py-1 pr-2 font-semibold">Item</th>
                          <th className="py-1 pr-2 font-semibold">Qty</th>
                          <th className="py-1 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.order.items.map((i) => (
                          <tr key={i.id} className="border-t border-line">
                            <td className="py-1.5 pr-2">
                              {i.productName}
                              {i.variantName ? ` (${i.variantName})` : ""}
                              <span className="text-xs text-ink-subtle"> · {i.unit}</span>
                            </td>
                            <td className="py-1.5 pr-2">× {i.quantity}</td>
                            <td className="py-1.5 text-right">{formatCurrency(i.finalPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={(n) => {
          setPage(n);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        itemLabel="orders"
      />
    </div>
  );
}
