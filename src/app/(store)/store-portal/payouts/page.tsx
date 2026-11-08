"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { plural } from "@/lib/portal/format";

type Payout = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossSales: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
  status: string;
  payoutMethod: string | null;
  payoutReference: string | null;
  paidAt: string | null;
  orderCount: number;
};

type Summary = {
  commissionPct: number | null;
  stores: { id: string; name: string; commissionPct: number; commissionIsCustom: boolean }[];
  totalSales: number;
  salesThisWeek: number;
  totalCommission: number;
  paidOut: number;
  pendingPayoutNet: number;
  pendingPayoutCount: number;
  unsettled: { orders: number; gross: number; commission: number; net: number };
  amountDue: number;
  nextPayoutDate: string | null;
  payouts: Payout[];
};

const STATUS_STYLE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-800",
  PROCESSING: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-slate-100 text-ink-subtle",
};
const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  PENDING: "Waiting to be paid",
  PROCESSING: "Processing",
  CANCELLED: "Cancelled",
};

function d(v: string) {
  return new Date(v).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

export default function StorePayoutsPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/store?resource=payouts", { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data);
        else setError(res.error || "Could not load payouts");
      })
      .catch(() => setError("Could not load payouts"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-ink-subtle">Loading payouts…</p>;

  const pctText =
    data.commissionPct != null
      ? `${data.commissionPct}%`
      : data.stores.map((s) => `${s.name}: ${s.commissionPct}%`).join(" · ");

  const cards = [
    { label: "Total sales (delivered)", value: formatCurrency(data.totalSales), hint: `This week: ${formatCurrency(data.salesThisWeek)}` },
    { label: "Platform commission", value: pctText, hint: `${formatCurrency(data.totalCommission)} so far` },
    { label: "Amount due to you", value: formatCurrency(data.amountDue), hint: "Sales minus commission, not paid yet", strong: true },
    { label: "Paid to you", value: formatCurrency(data.paidOut), hint: `${plural(data.payouts.filter((p) => p.status === "PAID").length, "payout")}` },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl text-ink">Payouts</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        MandiBazaar pays your product sales, minus the platform commission, every week to
        your bank account or JazzCash. Delivery fees stay with the platform.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-2xl p-4 shadow-card ${c.strong ? "bg-brand-50 ring-1 ring-brand-200" : "bg-card"}`}
          >
            <p className="text-xs font-semibold uppercase text-ink-subtle">{c.label}</p>
            <p className="mt-1 text-2xl font-black text-ink">{c.value}</p>
            <p className="mt-1 text-xs text-ink-subtle">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-card p-4 text-sm text-ink-muted">
        <p className="font-semibold text-ink">Next payout</p>
        <p className="mt-1">
          {data.pendingPayoutCount > 0
            ? `${plural(data.pendingPayoutCount, "payout")} worth ${formatCurrency(data.pendingPayoutNet)} ${
                data.pendingPayoutCount === 1 ? "is" : "are"
              } ready and waiting to be sent. `
            : ""}
          {data.unsettled.orders > 0
            ? `${plural(data.unsettled.orders, "delivered order")} (${formatCurrency(
                data.unsettled.gross
              )} sales − ${formatCurrency(data.unsettled.commission)} commission = ${formatCurrency(
                data.unsettled.net
              )}) will go in the next weekly payout. `
            : ""}
          {data.nextPayoutDate
            ? `Expected around ${d(data.nextPayoutDate)}.`
            : "Payouts are made weekly once you have delivered orders."}
        </p>
        <p className="mt-2 text-xs text-ink-subtle">
          Make sure your payout details (bank account or JazzCash) are saved in Store profile.
        </p>
      </div>

      <h2 className="mt-8 font-display text-xl">Past payouts</h2>
      <div className="mt-3 space-y-2">
        {data.payouts.map((p) => (
          <div key={p.id} className="rounded-2xl bg-card p-4 text-sm shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {d(p.periodStart)} – {d(p.periodEnd)}
                <span className="ml-2 text-xs text-ink-subtle">{plural(p.orderCount, "order")}</span>
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status] || "bg-slate-100"}`}>
                {STATUS_LABEL[p.status] || p.status}
              </span>
            </div>
            <p className="mt-2 text-ink-muted">
              Sales {formatCurrency(p.grossSales)} − commission {p.commissionRate}% (
              {formatCurrency(p.commissionAmount)}) = <strong>{formatCurrency(p.netAmount)}</strong>
              {p.payoutMethod ? ` via ${p.payoutMethod === "JAZZCASH" ? "JazzCash" : p.payoutMethod.toLowerCase()}` : ""}
            </p>
            {(p.paidAt || p.payoutReference) && (
              <p className="mt-1 text-xs text-ink-subtle">
                {p.paidAt ? `Paid ${d(p.paidAt)}` : ""}
                {p.payoutReference ? ` · Ref ${p.payoutReference}` : ""}
              </p>
            )}
          </div>
        ))}
        {!data.payouts.length && (
          <p className="text-sm text-ink-subtle">
            No payouts yet. Your first payout is made after your first orders are delivered.
          </p>
        )}
      </div>
    </div>
  );
}
