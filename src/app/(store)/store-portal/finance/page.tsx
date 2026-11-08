"use client";

import { useEffect, useState } from "react";
import { Loader2, Download, TrendingUp, Wallet, Receipt, Percent } from "lucide-react";

type Line = {
  orderId: string;
  orderNumber: string;
  date: string;
  orderStatus: string;
  paymentStatus: string;
  gross: number;
  discount: number;
  commission: number;
  net: number;
  settled: boolean;
  payoutReference: string | null;
  heldForCod?: boolean;
};
type Payout = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossSales: number;
  commissionAmount: number;
  netAmount: number;
  status: string;
  payoutReference: string | null;
  paidAt: string | null;
  orderCount: number;
};
type Data = {
  empty?: boolean;
  totalSales: number;
  salesThisWeek: number;
  salesThisMonth: number;
  lifetimeSales: number;
  totalCommission: number;
  paidOut: number;
  pendingPayoutNet: number;
  amountDue: number;
  commissionPct: number | null;
  counts: { completedOrders: number; cancelledOrders: number; refundedOrders: number };
  unsettled: { orders: number; gross: number; commission: number; net: number };
  breakdown: Line[];
  payouts: Payout[];
};

const rs = (n: number) => `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;

export default function StoreFinancePage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/store/finance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d?.success ? d.data : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-subtle">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your finances…
      </div>
    );
  }
  if (!data || data.empty) {
    return <div className="py-16 text-center text-ink-subtle">No financial data yet.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Earnings &amp; payouts</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            MandiBazaar takes {data.commissionPct != null ? `${data.commissionPct}%` : "a"} commission on product sales.
            Your delivery charges are separate and go to riders.
          </p>
        </div>
        <a
          href="/api/store/finance?format=csv"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:bg-app"
        >
          <Download className="h-4 w-4" /> Download statement (CSV)
        </a>
      </div>

      {/* Headline balances */}
      <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Wallet className="h-4 w-4" />} label="Available for payout" value={rs(data.amountDue)} accent />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Lifetime sales" value={rs(data.lifetimeSales)} />
        <Stat icon={<Percent className="h-4 w-4" />} label="Commission to date" value={rs(data.totalCommission)} />
        <Stat icon={<Receipt className="h-4 w-4" />} label="Paid out" value={rs(data.paidOut)} />
      </div>

      <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Sales this week" value={rs(data.salesThisWeek)} />
        <Mini label="Sales this month" value={rs(data.salesThisMonth)} />
        <Mini label="Pending payout" value={rs(data.pendingPayoutNet)} />
        <Mini label="Completed / cancelled / refunded" value={`${data.counts.completedOrders} / ${data.counts.cancelledOrders} / ${data.counts.refundedOrders}`} />
      </div>

      {/* Commission report */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Commission report (unsettled)</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Mini label="Eligible sales" value={rs(data.unsettled.gross)} />
          <Mini label={data.commissionPct != null ? `Commission (${data.commissionPct}%)` : "Commission"} value={rs(data.unsettled.commission)} />
          <Mini label="Your net" value={rs(data.unsettled.net)} />
        </div>
      </section>

      {/* Order-wise breakdown */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-muted">Order-wise breakdown</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 dark:bg-brand-500/10 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.breakdown.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">No orders yet.</td></tr>
              ) : (
                data.breakdown.map((o) => (
                  <tr key={o.orderId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{o.orderNumber}</div>
                      <div className="text-xs text-ink-subtle">{new Date(o.date).toLocaleDateString("en-PK")}</div>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={o.orderStatus} /></td>
                    <td className="px-4 py-3 text-right">{rs(o.gross)}</td>
                    <td className="px-4 py-3 text-right text-amber-700">− {rs(o.commission)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">{rs(o.net)}</td>
                    <td className="px-4 py-3">
                      {o.settled ? (
                        <span className="text-xs font-medium text-emerald-700">Settled{o.payoutReference ? ` · ${o.payoutReference}` : ""}</span>
                      ) : o.heldForCod ? (
                        <span className="text-xs font-medium text-amber-700">Awaiting COD reconciliation</span>
                      ) : (
                        <span className="text-xs text-ink-subtle">Pending</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Payout history */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-muted">Payout history</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 dark:bg-brand-500/10 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Net paid</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.payouts.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-subtle">No payouts yet.</td></tr>
              ) : (
                data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {new Date(p.periodStart).toLocaleDateString("en-PK")} – {new Date(p.periodEnd).toLocaleDateString("en-PK")}
                      <span className="ml-1 text-ink-subtle">({p.orderCount} orders)</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{rs(p.netAmount)}</td>
                    <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                    <td className="px-4 py-3 text-xs text-ink-subtle">{p.payoutReference || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`hover-lift rounded-2xl border p-5 ${accent ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-card"}`}>
      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${accent ? "text-brand-100" : "text-ink-subtle"}`}>
        {icon} {label}
      </p>
      <p className={`mt-2 text-2xl font-extrabold ${accent ? "text-white" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DELIVERED: "bg-emerald-100 text-emerald-800",
    PAID: "bg-emerald-100 text-emerald-800",
    CANCELLED: "bg-red-100 text-red-700",
    RETURNED: "bg-red-100 text-red-700",
    PENDING: "bg-amber-100 text-amber-800",
    PROCESSING: "bg-amber-100 text-amber-800",
  };
  const cls = map[status] || "bg-brand-50 dark:bg-brand-500/10 text-ink";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>{status.replace(/_/g, " ").toLowerCase()}</span>;
}
