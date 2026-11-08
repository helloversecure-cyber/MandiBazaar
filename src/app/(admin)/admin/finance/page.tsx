"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, TrendingUp, Percent, Wallet, Bike, Store, AlertCircle } from "lucide-react";

type Data = {
  totalProductSales: number;
  totalCommissionEarned: number;
  totalStoreEarnings: number;
  storePayoutsPaid: number;
  storePayoutsPending: number;
  riderPayoutsPaid: number;
  riderPayoutsPending: number;
  outstandingLiabilities: number;
  counts: { delivered: number; cancelled: number; refunded: number; riderPayoutCount: number };
  unsettled: { gross: number; commission: number; net: number; stores: number };
  topStores: { storeId: string; storeName: string; sales: number }[];
  topRiders: { riderId: string; name: string; paid: number; payouts: number }[];
};

const rs = (n: number) => `Rs ${Math.round(n || 0).toLocaleString("en-PK")}`;

export default function AdminFinancePage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/finance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d?.success ? d.data : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-subtle">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading financial overview…
      </div>
    );
  }
  if (!data) return <div className="py-16 text-center text-ink-subtle">Couldn&apos;t load financial data.</div>;

  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Financial control center</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Platform-wide figures from real records. MandiBazaar&apos;s commission is taken from store product sales only; rider delivery fees are separate.
        </p>
      </div>

      <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Total product sales" value={rs(data.totalProductSales)} />
        <Stat icon={<Percent className="h-4 w-4" />} label="Commission (accrued)" value={rs(data.totalCommissionEarned)} accent />
        <Stat icon={<Store className="h-4 w-4" />} label="Store earnings" value={rs(data.totalStoreEarnings)} />
        <Stat icon={<Bike className="h-4 w-4" />} label="Rider fees paid" value={rs(data.riderPayoutsPaid)} />
      </div>

      {/* Outstanding liabilities */}
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
          <AlertCircle className="h-4 w-4" /> Outstanding settlement liabilities
        </p>
        <p className="mt-2 text-3xl font-extrabold text-amber-900">{rs(data.outstandingLiabilities)}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Mini label="Store payouts pending" value={rs(data.storePayoutsPending)} />
          <Mini label="Rider payouts pending" value={rs(data.riderPayoutsPending)} />
        </div>
      </section>

      {/* Payout management links */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/payouts" className="rounded-2xl border border-line bg-card p-5 hover:border-line hover:shadow-sm">
          <p className="flex items-center gap-2 font-bold text-ink"><Wallet className="h-4 w-4" /> Store payouts</p>
          <p className="mt-1 text-sm text-ink-subtle">Generate weekly batches, review and mark paid.</p>
          <p className="mt-3 text-sm"><span className="font-semibold">{rs(data.storePayoutsPaid)}</span> paid · <span className="font-semibold text-amber-700">{rs(data.storePayoutsPending)}</span> pending</p>
        </Link>
        <Link href="/admin/payouts" className="rounded-2xl border border-line bg-card p-5 hover:border-line hover:shadow-sm">
          <p className="flex items-center gap-2 font-bold text-ink"><Bike className="h-4 w-4" /> Rider payouts</p>
          <p className="mt-1 text-sm text-ink-subtle">Pay riders for completed deliveries ({data.counts.riderPayoutCount} payouts so far).</p>
          <p className="mt-3 text-sm"><span className="font-semibold">{rs(data.riderPayoutsPaid)}</span> paid · <span className="font-semibold text-amber-700">{rs(data.riderPayoutsPending)}</span> pending</p>
        </Link>
      </section>

      {/* Commission summary */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">Commission (unsettled)</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Mini label="Eligible sales" value={rs(data.unsettled.gross)} />
          <Mini label="Commission" value={rs(data.unsettled.commission)} />
          <Mini label="Store net owed" value={rs(data.unsettled.net)} />
          <Mini label="Stores awaiting payout" value={String(data.unsettled.stores)} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <TopTable title="Top stores by sales" rows={data.topStores.map((s) => [s.storeName || "Store", rs(s.sales)])} />
        <TopTable title="Top riders by payout" rows={data.topRiders.map((r) => [r.name, rs(r.paid)])} />
      </div>

      <p className="text-xs text-ink-subtle">
        Orders: {data.counts.delivered} delivered · {data.counts.cancelled} cancelled · {data.counts.refunded} refunded.
      </p>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`hover-lift rounded-2xl border p-5 ${accent ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-card"}`}>
      <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${accent ? "text-brand-100" : "text-ink-subtle"}`}>{icon} {label}</p>
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
function TopTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">{title}</h2>
      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr><td className="py-3 text-ink-subtle">No data yet.</td></tr>
          ) : (
            rows.map(([name, val], i) => (
              <tr key={i}>
                <td className="py-2.5 text-ink">{name}</td>
                <td className="py-2.5 text-right font-semibold text-ink">{val}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
