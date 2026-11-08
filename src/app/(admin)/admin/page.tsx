"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  ShoppingCart,
  TrendingUp,
  Clock,
  PackageCheck,
  XCircle,
  Package,
  AlertTriangle,
  Users,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ORDER_STATUS_LABELS } from "@/lib/orders/state-machine";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard, type StatTone } from "@/components/ui/StatCard";
import { SectionCard } from "@/components/ui/Card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "previous_month", label: "Previous month" },
];

const PIE_COLORS = ["#059669", "#10b981", "#f97316", "#34d399", "#047857", "#fb923c"];

type Accounting = {
  grossProductSales: number;
  discounts: number;
  deliveryRevenue: number;
  refunds: number;
  netSales: number;
  onlinePayments: number;
  cashCollected: number;
  moneyReceived: number;
  codToCollect: number;
  cashFeesToCollect?: number;
  revenuePaid: number;
};

type DashboardData = {
  rangeLabel: string;
  cards: {
    revenue: number;
    paidOrders: number;
    ordersPlaced: number;
    monthlyRevenue: number;
    totalRevenue: number;
    openOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    productsSold: number;
    lowStockProducts: number;
    customers: number;
    pendingCashCollections: { count: number; amount: number };
  };
  accounting: Accounting;
  riderPay?: {
    earned: number;
    unpaid: number;
    deliveries: number;
    unpaidAllTime: number;
    unpaidAllTimeDeliveries: number;
    deliveryRevenue: number;
  };
  reconciliation: { reconciles: boolean; overRecorded: number; overRecordedOrders: string[] };
  needsAttention: { key: string; label: string; count: number; href: string; orderNumbers?: string[] }[];
  charts: {
    statusBreakdown: { status: string; count: number }[];
    paymentBreakdown: { method: string; count: number }[];
    topProducts: { name: string; quantity: number; revenue: number }[];
  };
};

function NoData() {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-line text-sm text-ink-subtle">
      No data for this period
    </div>
  );
}

export default function AdminDashboardPage() {
  const [range, setRange] = useState("today");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/admin/dashboard?range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d.data);
        else setError(d.error || "Could not load the dashboard");
      })
      .catch(() => setError("Could not load the dashboard"))
      .finally(() => setLoading(false));
  }, [range]);

  const label = data?.rangeLabel || RANGES.find((r) => r.value === range)?.label || "";
  const lower = label.toLowerCase();
  const c = data?.cards;
  const a = data?.accounting;

  const attention = (data?.needsAttention || []).filter((x) => x.count > 0);

  const stats: { label: string; value: string; icon: LucideIcon; tone: StatTone; hint?: string }[] = c
    ? [
        { label: `Revenue — ${lower}`, value: formatCurrency(c.revenue), icon: Wallet, tone: "brand", hint: "Money received minus refunds" },
        { label: `Orders — ${lower}`, value: String(c.ordersPlaced), icon: ShoppingCart, tone: "info", hint: `${c.paidOrders} paid / confirmed` },
        { label: "Revenue — this month", value: formatCurrency(c.monthlyRevenue), icon: TrendingUp, tone: "brand" },
        { label: "Revenue — all time", value: formatCurrency(c.totalRevenue), icon: TrendingUp, tone: "success" },
        { label: "Open orders (now)", value: String(c.openOrders), icon: Clock, tone: "info", hint: "Confirmed, not yet delivered" },
        { label: `Delivered — ${lower}`, value: String(c.deliveredOrders), icon: PackageCheck, tone: "success" },
        { label: `Cancelled — ${lower}`, value: String(c.cancelledOrders), icon: XCircle, tone: "danger" },
        { label: `Products sold — ${lower}`, value: String(c.productsSold), icon: Package, tone: "neutral" },
        { label: "Low stock (now)", value: String(c.lowStockProducts), icon: AlertTriangle, tone: "danger" },
        { label: "Customers (all)", value: String(c.customers), icon: Users, tone: "info" },
        {
          label: "COD still to collect (now)",
          value: formatCurrency(c.pendingCashCollections?.amount || 0),
          icon: HandCoins,
          tone: "accent",
          hint: `${c.pendingCashCollections?.count || 0} orders`,
        },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Revenue, orders, and operations"
        action={
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label="Date range"
            className="rounded-xl border border-line bg-card px-4 py-2 text-sm text-ink"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        }
      />

      {loading && <div className="skeleton h-40 rounded-3xl" />}
      {!loading && error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}

      {!loading && data && c && a && (
        <div className="space-y-6">
          {/* Needs attention */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-500/25 dark:bg-amber-500/10">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs attention
            </h2>
            {attention.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">Nothing waiting right now.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {attention.map((x) => (
                  <li key={x.key}>
                    <Link
                      href={x.href}
                      className="press flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm shadow-card transition hover:border-amber-300"
                    >
                      <span className="text-ink">
                        {x.label}
                        {x.orderNumbers?.length ? (
                          <span className="block text-xs text-ink-subtle">{x.orderNumbers.join(", ")}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                        {x.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Stat grid */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} hint={s.hint} />
            ))}
          </div>

          {/* Revenue accounting */}
          <SectionCard
            title={`Revenue accounting — ${lower}`}
            subtitle="Orders placed in this period that are paid / confirmed. Unpaid, cancelled and failed orders are not counted."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Sales</h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <Row label="Gross product sales" value={a.grossProductSales} />
                  <Row label="− Discounts" value={a.discounts} />
                  <Row label="+ Delivery fees paid" value={a.deliveryRevenue} />
                  {(a.cashFeesToCollect ?? 0) > 0 && (
                    <Row label="(+ Cash delivery fees still to collect)" value={a.cashFeesToCollect ?? 0} />
                  )}
                  <Row label="− Refunds" value={a.refunds} />
                  <Row label="= Net sales" value={a.netSales} strong />
                </dl>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink">Money</h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <Row label="Online payments (successful)" value={a.onlinePayments} />
                  <Row label="+ Cash collected" value={a.cashCollected} />
                  <Row label="= Money received" value={a.moneyReceived} strong />
                  <Row label="COD still to collect" value={a.codToCollect} />
                  <Row label="Revenue (paid) = received − refunds" value={a.revenuePaid} strong />
                </dl>
              </div>
            </div>
            <p
              className={`mt-4 rounded-xl px-3 py-2 text-xs ${
                data.reconciliation.reconciles && data.reconciliation.overRecorded === 0
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              }`}
            >
              Check: money received {formatCurrency(a.moneyReceived)} + COD to collect{" "}
              {formatCurrency(a.codToCollect)} − refunds {formatCurrency(a.refunds)} = net sales{" "}
              {formatCurrency(a.netSales)}
              {(a.cashFeesToCollect ?? 0) > 0
                ? ` + cash delivery fees to collect ${formatCurrency(a.cashFeesToCollect ?? 0)}`
                : ""}
              .
              {data.reconciliation.overRecorded > 0 &&
                ` ${formatCurrency(data.reconciliation.overRecorded)} recorded above what was billed on ${data.reconciliation.overRecordedOrders.join(", ")} — not counted; please review.`}
            </p>
            {data.riderPay && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-ink">Delivery income vs rider pay</h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <Row label="Delivery fees paid" value={data.riderPay.deliveryRevenue} />
                  <Row
                    label={`− Rider pay earned (${data.riderPay.deliveries} ${data.riderPay.deliveries === 1 ? "delivery" : "deliveries"})`}
                    value={data.riderPay.earned}
                  />
                  <Row
                    label="= Delivery margin"
                    value={data.riderPay.deliveryRevenue - data.riderPay.earned}
                    strong
                  />
                  <Row
                    label={`Rider pay still unpaid (all time, ${data.riderPay.unpaidAllTimeDeliveries} ${data.riderPay.unpaidAllTimeDeliveries === 1 ? "delivery" : "deliveries"})`}
                    value={data.riderPay.unpaidAllTime}
                  />
                </dl>
                <p className="mt-1 text-xs text-ink-subtle">
                  Rider pay is counted by delivery date; delivery fees by order date. Pay riders on the Riders page.
                </p>
              </div>
            )}
          </SectionCard>

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title={`Top products — ${lower}`}>
              <div className="h-64">
                {data.charts.topProducts.length === 0 ? (
                  <NoData />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.topProducts}>
                      <XAxis dataKey="name" hide />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="quantity" name="Quantity" fill="#059669" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </SectionCard>
            <SectionCard title={`Order status — ${lower}`}>
              <div className="h-64">
                {data.charts.statusBreakdown.length === 0 ? (
                  <NoData />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.charts.statusBreakdown.map((s) => ({
                          ...s,
                          label:
                            ORDER_STATUS_LABELS[s.status as keyof typeof ORDER_STATUS_LABELS] || s.status,
                        }))}
                        dataKey="count"
                        nameKey="label"
                        outerRadius={90}
                        label
                      >
                        {data.charts.statusBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${
        strong ? "bg-brand-50 font-semibold text-ink dark:bg-brand-500/10" : ""
      }`}
    >
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num-tabular text-ink">{formatCurrency(value || 0)}</dd>
    </div>
  );
}
