"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { plural } from "@/lib/portal/format";
import { Button } from "@/components/ui/Button";

type Dash = {
  rider: {
    name: string;
    status: string;
    phone: string;
    approvalStatus?: string;
    reviewNotes?: string | null;
    photoUrl?: string | null;
  };
  stats: {
    activeDeliveries: number;
    deliveredToday: number;
    pendingRemittanceCount: number;
    pendingRemittanceAmount: number;
    cashCollected?: number;
    cashRetained?: number;
    owedToPlatform?: number;
    overdueAmount?: number;
    codRestricted?: boolean;
  };
  recent: {
    id: string;
    orderNumber: string;
    orderStatus: string;
    remainingAmount: number;
    customer: { fullName: string; phone: string } | null;
  }[];
  pendingApproval?: boolean;
};

export default function RiderDashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/rider?resource=dashboard");
    const json = await res.json();
    if (json.success) setData(json.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(status: string) {
    setMsg("");
    const res = await fetch("/api/rider", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "SET_STATUS", status }),
    });
    const json = await res.json();
    if (!json.success) setMsg(json.error || "Failed");
    else {
      setMsg(`Status → ${status}`);
      load();
    }
  }

  if (!data) {
    return <p className="text-ink-subtle">Loading…</p>;
  }

  if (data.pendingApproval || data.rider.approvalStatus === "PENDING") {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="text-4xl">⏳</p>
        <h1 className="mt-3 text-2xl font-extrabold text-amber-950">
          Waiting for MandiBazaar
        </h1>
        <p className="mt-2 text-sm text-amber-900">
          Your CNIC, photo, license, bike photos, and account number have been
          sent to MandiBazaar for review. Deliveries will be assigned after approval.
        </p>
        <p className="mt-4 text-xs text-amber-700">
          {data.rider.name} · {data.rider.phone} · Status: PENDING
        </p>
        <Button className="mt-6" variant="outline" onClick={load}>
          Refresh status
        </Button>
      </div>
    );
  }

  if (data.rider.approvalStatus === "REJECTED") {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-4xl">❌</p>
        <h1 className="mt-3 text-2xl font-extrabold text-red-950">
          Application rejected
        </h1>
        <p className="mt-2 text-sm text-red-800">
          {data.rider.reviewNotes || "Contact MandiBazaar for details."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Rider dashboard</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        {data.rider.name} · {data.rider.phone} ·{" "}
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">{data.rider.status}</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["AVAILABLE", "BUSY", "OFFLINE"] as const).map((s) => (
          <Button
            key={s}
            type="button"
            variant={data.rider.status === s ? "primary" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{msg}</p>}

      {data.stats.codRestricted && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <span className="mt-0.5 text-red-600">⚠</span>
          <div className="text-sm text-red-800">
            <p className="font-bold">New deliveries paused — overdue COD cash</p>
            <p className="mt-0.5">
              Settle {formatCurrency(data.stats.overdueAmount ?? 0)} from{" "}
              <Link href="/rider-portal/remittances" className="font-semibold underline">Cash → MandiBazaar</Link>{" "}
              to start taking deliveries again. You keep full account access meanwhile.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-ink-subtle">Active jobs</p>
          <p className="mt-2 text-3xl font-black text-ink">
            {data.stats.activeDeliveries}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-ink-subtle">Delivered today</p>
          <p className="mt-2 text-3xl font-black text-ink">
            {data.stats.deliveredToday}
          </p>
        </div>
        <Link
          href="/rider-portal/remittances"
          className={`rounded-2xl border p-5 shadow-sm transition hover:ring-2 ${
            (data.stats.overdueAmount ?? 0) > 0 ? "border-red-200 bg-red-50 hover:ring-red-200" : "border-amber-200 bg-amber-50 hover:ring-amber-200"
          }`}
        >
          <p className={`text-xs font-semibold uppercase ${(data.stats.overdueAmount ?? 0) > 0 ? "text-red-700" : "text-amber-700"}`}>
            Owed to MandiBazaar
          </p>
          <p className={`mt-2 text-3xl font-black ${(data.stats.overdueAmount ?? 0) > 0 ? "text-red-900" : "text-amber-900"}`}>
            {formatCurrency(data.stats.owedToPlatform ?? data.stats.pendingRemittanceAmount)}
          </p>
          <p className={`text-xs ${(data.stats.overdueAmount ?? 0) > 0 ? "text-red-700" : "text-amber-700"}`}>
            {(data.stats.overdueAmount ?? 0) > 0
              ? `${formatCurrency(data.stats.overdueAmount ?? 0)} overdue`
              : plural(data.stats.pendingRemittanceCount, "remittance")}
          </p>
        </Link>
      </div>

      {(data.stats.cashCollected ?? 0) > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-xl bg-app px-4 py-3">
            <p className="text-xs text-ink-subtle">Cash collected (lifetime)</p>
            <p className="mt-0.5 font-bold text-ink">{formatCurrency(data.stats.cashCollected ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/15 px-4 py-3">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">You kept (delivery fees)</p>
            <p className="mt-0.5 font-bold text-emerald-800 dark:text-emerald-300">{formatCurrency(data.stats.cashRetained ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-app px-4 py-3">
            <p className="text-xs text-ink-subtle">These are separate from your delivery earnings/payouts.</p>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/rider-portal/deliveries">
          <Button>Open deliveries</Button>
        </Link>
        <Link href="/rider-portal/remittances">
          <Button variant="outline">Submit cash to MandiBazaar</Button>
        </Link>
      </div>

      <h2 className="mt-10 text-lg font-bold text-ink">Active deliveries</h2>
      <div className="mt-3 space-y-2">
        {data.recent.length === 0 && (
          <p className="text-sm text-ink-subtle">No active deliveries right now.</p>
        )}
        {data.recent.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3"
          >
            <div>
              <p className="font-semibold text-ink">{o.orderNumber}</p>
              <p className="text-xs text-ink-subtle">
                {o.customer?.fullName} · {o.customer?.phone} · {o.orderStatus}
              </p>
            </div>
            {o.remainingAmount > 0 && (
              <p className="text-sm font-bold text-amber-700">
                COD {formatCurrency(o.remainingAmount)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
