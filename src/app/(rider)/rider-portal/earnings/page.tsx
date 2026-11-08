"use client";

import { useEffect, useState } from "react";
import { Loader2, Download, Bike, Wallet, Clock, CheckCircle2 } from "lucide-react";

type Delivery = {
  orderId: string;
  orderNumber: string;
  deliveredAt: string | null;
  distanceKm: number | null;
  pay: number;
  paid: boolean;
};
type Payout = {
  id: string;
  amount: number;
  deliveryCount: number;
  method: string;
  reference: string | null;
  paidAt: string | null;
};
type Data = {
  completedDeliveries: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  lifetime: number;
  available: number;
  pendingCount: number;
  paid: number;
  paidCount: number;
  deliveries: Delivery[];
  payouts: Payout[];
};

const rs = (n: number) => `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;

export default function RiderEarningsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rider/finance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d?.success ? d.data : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-subtle">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your earnings…
      </div>
    );
  }
  if (!data) return <div className="py-16 text-center text-ink-subtle">No earnings data yet.</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">My earnings</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            You earn the delivery fee for each completed delivery (the bid you and the customer agreed, where applicable). No platform commission is taken from your fee.
          </p>
        </div>
        <a
          href="/api/rider/finance?format=csv"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:bg-app"
        >
          <Download className="h-4 w-4" /> Download statement (CSV)
        </a>
      </div>

      <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Wallet className="h-4 w-4" />} label="Available to be paid" value={rs(data.available)} accent />
        <Stat icon={<Bike className="h-4 w-4" />} label="Completed deliveries" value={String(data.completedDeliveries)} />
        <Stat icon={<Clock className="h-4 w-4" />} label="Pending deliveries" value={String(data.pendingCount)} />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Paid to date" value={rs(data.paid)} />
      </div>

      <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Today" value={rs(data.today)} />
        <Mini label="This week" value={rs(data.thisWeek)} />
        <Mini label="This month" value={rs(data.thisMonth)} />
        <Mini label="Lifetime" value={rs(data.lifetime)} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-muted">Delivery-wise earnings</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 dark:bg-brand-500/10 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3 text-right">Distance</th>
                <th className="px-4 py-3 text-right">Fee</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.deliveries.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-subtle">No deliveries yet.</td></tr>
              ) : (
                data.deliveries.map((d) => (
                  <tr key={d.orderId}>
                    <td className="px-4 py-3 font-semibold text-ink">{d.orderNumber}</td>
                    <td className="px-4 py-3 text-xs text-ink-subtle">{d.deliveredAt ? new Date(d.deliveredAt).toLocaleDateString("en-PK") : "—"}</td>
                    <td className="px-4 py-3 text-right text-ink-muted">{d.distanceKm != null ? `${d.distanceKm} km` : "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{rs(d.pay)}</td>
                    <td className="px-4 py-3">
                      {d.paid ? (
                        <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Paid</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Pending</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-muted">Payout history</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 dark:bg-brand-500/10 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-3">Paid on</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Deliveries</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.payouts.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-subtle">No payouts yet.</td></tr>
              ) : (
                data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-xs text-ink-muted">{p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-PK") : "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{rs(p.amount)}</td>
                    <td className="px-4 py-3 text-right text-ink-muted">{p.deliveryCount}</td>
                    <td className="px-4 py-3 text-xs text-ink-subtle">{p.method}</td>
                    <td className="px-4 py-3 text-xs text-ink-subtle">{p.reference || "—"}</td>
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
