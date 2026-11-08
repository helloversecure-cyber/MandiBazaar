"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { REVENUE_LABELS } from "@/lib/orders/revenue";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "previous_month", label: "Previous month" },
];

/** Same numbers and order as the dashboard (QA P12). */
const METRICS = [
  "grossProductSales",
  "discounts",
  "deliveryRevenue",
  "refunds",
  "netSales",
  "onlinePayments",
  "cashCollected",
  "moneyReceived",
  "codToCollect",
  "cashFeesToCollect",
  "revenuePaid",
] as const;

type Data = {
  rangeLabel: string;
  range: { start: string; end: string };
  accounting: Record<(typeof METRICS)[number], number>;
  charts: { topProducts: { name: string; quantity: number; revenue: number }[] };
  riderPay?: {
    earned: number;
    unpaid: number;
    deliveries: number;
    unpaidAllTime: number;
    unpaidAllTimeDeliveries: number;
    paidOut: number;
    payoutCount: number;
    deliveryRevenue: number;
  };
};

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminReportsPage() {
  const [range, setRange] = useState("last30");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/dashboard?range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
      })
      .finally(() => setLoading(false));
  }, [range]);

  function exportCsv() {
    if (!data) return;
    const rows: (string | number)[][] = [
      ["Period", data.rangeLabel],
      ["From", new Date(data.range.start).toLocaleString("en-PK")],
      ["To", new Date(data.range.end).toLocaleString("en-PK")],
      [],
      ["Metric", "Amount (PKR)"],
      ...METRICS.map((k) => [REVENUE_LABELS[k], data.accounting[k] ?? 0]),
      ...(data.riderPay
        ? [
            [],
            ["Rider pay", "Amount (PKR)"],
            ["Delivery fee income", data.accounting.deliveryRevenue ?? 0],
            ["Rider pay earned", data.riderPay.earned],
            ["Rider pay unpaid (this period)", data.riderPay.unpaid],
            ["Paid to riders in period", data.riderPay.paidOut],
            ["Owed to riders now (all time)", data.riderPay.unpaidAllTime],
          ]
        : []),
      [],
      ["Product", "Quantity", "Revenue (PKR)"],
      ...data.charts.topProducts.map((p) => [p.name, p.quantity, p.revenue]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mandibazaar-report-${range}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Reports</h1>
        <div className="flex flex-wrap gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label="Date range"
            className="rounded-full border px-4 py-2 text-sm"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            onClick={exportCsv}
            disabled={!data}
            className="rounded-full bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading && <div className="mt-6 skeleton h-32 rounded-3xl" />}

      {!loading && data && (
        <>
          <p className="mt-4 text-xs text-ink-subtle">
            {data.rangeLabel}: paid / confirmed orders only (unpaid, cancelled and failed orders
            are not counted). Same figures as the dashboard.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {METRICS.map((k) => (
              <div key={k} className="rounded-2xl bg-card p-4 shadow-card">
                <p className="text-xs text-ink-subtle">{REVENUE_LABELS[k]}</p>
                <p className="mt-1 font-semibold">{formatCurrency(data.accounting[k] ?? 0)}</p>
              </div>
            ))}
          </div>
          {data.riderPay && (
            <div className="mt-8">
              <h2 className="font-display text-xl">Delivery income vs rider pay</h2>
              <p className="mt-1 text-xs text-ink-subtle">
                Rider pay counts deliveries completed in this period ({data.riderPay.deliveries}); delivery fee
                income counts paid orders placed in this period.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ["Delivery fee income", data.accounting.deliveryRevenue ?? 0],
                    ["Rider pay earned", data.riderPay.earned],
                    ["Rider pay unpaid", data.riderPay.unpaid],
                    ["Paid to riders", data.riderPay.paidOut],
                    [
                      `Owed to riders now (${data.riderPay.unpaidAllTimeDeliveries} deliveries)`,
                      data.riderPay.unpaidAllTime,
                    ],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-2xl bg-card p-4 shadow-card">
                    <p className="text-xs text-ink-subtle">{label}</p>
                    <p className="mt-1 font-semibold">{formatCurrency(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-8 overflow-x-auto rounded-3xl bg-card p-6 shadow-card">
            <h2 className="font-display text-xl">Product report</h2>
            {data.charts.topProducts.length === 0 ? (
              <p className="mt-4 text-sm text-ink-subtle">No data for this period</p>
            ) : (
              <table className="mt-4 w-full text-left text-sm">
                <thead>
                  <tr className="text-ink-subtle">
                    <th className="py-2">Product</th>
                    <th>Quantity</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.charts.topProducts.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2">{p.name}</td>
                      <td>{p.quantity}</td>
                      <td>{formatCurrency(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
