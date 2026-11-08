"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";

const PAGE_SIZE = 25;

type Payout = {
  id: string;
  store: {
    name: string;
    jazzCashNumber: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankIban: string | null;
  };
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
};

type Remittance = {
  id: string;
  amount: number;
  status: string;
  problem: string | null;
  /** Full-COD: delivery fee collected in cash and included in `amount` */
  deliveryFeeInCash?: number;
  order: { orderNumber: string } | null;
  rider: { name: string; phone: string } | null;
};

type Summary = {
  defaultCommissionPct: number;
  pendingCount: number;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
};

type Preview = {
  defaultCommissionPct: number;
  rows: {
    source: "pending" | "new";
    id: string;
    storeName: string;
    gross: number;
    commissionRate: number;
    commissionAmount: number;
    netAmount: number;
    account: string;
    willPay: boolean;
    skipReason: string | null;
  }[];
  payCount: number;
  skipCount: number;
  totalNet: number;
  totalCommission: number;
};

function PreviewTable({ p, onlyPending }: { p: Preview; onlyPending: boolean }) {
  const rows = onlyPending ? p.rows.filter((r) => r.source === "pending") : p.rows;
  const paying = rows.filter((r) => r.willPay);
  return (
    <div className="space-y-2 text-left">
      <div className="max-h-64 overflow-auto rounded-xl border">
        <table className="w-full text-xs">
          <thead className="bg-app text-ink-subtle">
            <tr>
              <th className="px-2 py-1 text-left">Store</th>
              <th className="px-2 py-1 text-right">Pay</th>
              <th className="px-2 py-1 text-left">Account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}-${r.id}`} className="border-t align-top">
                <td className="px-2 py-1">
                  {r.storeName}
                  <span className="block text-ink-subtle">
                    Sales {formatCurrency(r.gross)} − {r.commissionRate}% ({formatCurrency(r.commissionAmount)})
                  </span>
                </td>
                <td className="px-2 py-1 text-right font-semibold">{formatCurrency(r.netAmount)}</td>
                <td className="px-2 py-1">
                  {r.willPay ? r.account : <span className="text-red-600">Skipped — {r.skipReason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        Pays <strong>{paying.length}</strong> store(s) a total of{" "}
        <strong>{formatCurrency(paying.reduce((s, r) => s + r.netAmount, 0))}</strong>; platform keeps{" "}
        {formatCurrency(paying.reduce((s, r) => s + r.commissionAmount, 0))} commission.
        {rows.length - paying.length > 0 && ` ${rows.length - paying.length} skipped (no payout account).`}
      </p>
      <p className="text-xs text-ink-subtle">
        This marks the payouts as paid. Send the money from the bank / JazzCash yourself — the
        system does not transfer it.
      </p>
    </div>
  );
}

export default function AdminPayoutsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutMeta, setPayoutMeta] = useState({ total: 0, totalPages: 1 });
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [remitPage, setRemitPage] = useState(1);
  const [remitMeta, setRemitMeta] = useState({ total: 0, totalPages: 1 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [p, r, s] = await Promise.all([
      fetch(`/api/admin/payouts?resource=payouts&page=${payoutPage}&limit=${PAGE_SIZE}`).then((x) => x.json()),
      fetch(`/api/admin/payouts?resource=remittances&page=${remitPage}&limit=${PAGE_SIZE}`).then((x) => x.json()),
      fetch("/api/admin/payouts?resource=summary").then((x) => x.json()),
    ]);
    if (p.success) {
      setPayouts(p.data.items || []);
      setPayoutMeta({ total: p.data.pagination.total, totalPages: p.data.pagination.totalPages });
    }
    if (r.success) {
      setRemittances(r.data.items || []);
      setRemitMeta({ total: r.data.pagination.total, totalPages: r.data.pagination.totalPages });
    }
    if (s.success) setSummary(s.data);
  }, [payoutPage, remitPage]);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function runBatch(action: "SETTLE_ALL_STORES" | "PAY_ALL_PENDING") {
    setLoading(true);
    setDetail("");
    let preview: Preview | null = null;
    try {
      const d = await fetch("/api/admin/payouts?resource=settlement-preview").then((r) => r.json());
      if (!d.success) throw new Error(d.error);
      preview = d.data;
    } catch (e) {
      setLoading(false);
      toast.error(e instanceof Error && e.message ? e.message : "Could not prepare the summary");
      return;
    }
    const onlyPending = action === "PAY_ALL_PENDING";
    const rows = onlyPending ? preview!.rows.filter((r) => r.source === "pending") : preview!.rows;
    if (rows.filter((r) => r.willPay).length === 0) {
      setLoading(false);
      toast.info(
        rows.length === 0
          ? "Nothing to pay: no unpaid delivered sales."
          : "Nothing can be paid: the stores have no payout account."
      );
      return;
    }
    const r = await confirm({
      title: onlyPending ? "Pay all pending payouts?" : "Pay all stores now?",
      message: <PreviewTable p={preview!} onlyPending={onlyPending} />,
      confirmLabel: "Yes, mark as paid",
      tone: "danger",
    });
    if (!r.confirmed) {
      setLoading(false);
      return;
    }
    const data = await post({ action, confirm: true });
    setLoading(false);
    if (!data.success) {
      toast.error(data.error || "Payout failed");
      return;
    }
    const d = data.data;
    toast.success(d.message);
    const skippedLines =
      d.skipped?.length > 0
        ? "\nSkipped:\n" +
          d.skipped
            .map(
              (x: { storeName: string; reason: string; netAmount: number }) =>
                `• ${x.storeName}: ${x.reason} (${formatCurrency(x.netAmount)})`
            )
            .join("\n")
        : "";
    setDetail(
      `Batch ${d.batchReference}\nPaid: ${d.paidCount} stores\nNet paid to stores: ${formatCurrency(d.totalNetPaid)}\nCommission kept: ${formatCurrency(d.totalCommissionKept)}${skippedLines}`
    );
    load();
  }

  async function generate() {
    setLoading(true);
    const data = await post({ action: "GENERATE_WEEKLY" });
    setLoading(false);
    if (data.success) toast.success(data.data.message);
    else toast.error(data.error || "Failed");
    load();
  }

  async function markPaid(p: Payout) {
    const r = await confirm({
      title: `Mark ${formatCurrency(p.netAmount)} to ${p.store.name} as paid?`,
      message: `Account: ${
        p.store.jazzCashNumber
          ? `JazzCash ${p.store.jazzCashNumber}`
          : p.store.bankIban || p.store.bankAccountNumber
            ? `Bank ${p.store.bankName || ""} ${p.store.bankIban || p.store.bankAccountNumber}`
            : "none on file"
      }. Send the money first, then enter the bank / JazzCash reference.`,
      confirmLabel: "Mark paid",
      reason: { label: "Transfer reference", required: true, minLength: 3, maxLength: 100 },
    });
    if (!r.confirmed) return;
    const data = await post({
      action: "MARK_PAID",
      payoutId: p.id,
      payoutMethod: p.store.jazzCashNumber ? "JAZZCASH" : "BANK",
      payoutReference: r.reason,
    });
    if (data.success) toast.success("Payout marked paid");
    else toast.error(data.error || "Failed");
    load();
  }

  async function remitAction(
    rm: Remittance,
    action: "RECEIVE_REMITTANCE" | "DISPUTE_REMITTANCE" | "RESOLVE_REMITTANCE",
    resolveTo?: string
  ) {
    let notes: string | undefined;
    if (action === "DISPUTE_REMITTANCE") {
      const r = await confirm({
        title: `Dispute ${formatCurrency(rm.amount)} from ${rm.rider?.name || "rider"}?`,
        confirmLabel: "Dispute",
        tone: "danger",
        reason: { label: "What is wrong?", required: true, minLength: 3, maxLength: 300 },
      });
      if (!r.confirmed) return;
      notes = r.reason;
    } else if (action === "RECEIVE_REMITTANCE" || resolveTo === "RECEIVED") {
      const r = await confirm({
        title: `Confirm ${formatCurrency(rm.amount)} cash received from ${rm.rider?.name || "rider"}?`,
        message: `Order ${rm.order?.orderNumber || ""}`,
        confirmLabel: "Cash received",
      });
      if (!r.confirmed) return;
    }
    const data = await post({ action, remittanceId: rm.id, notes, resolveTo });
    if (data.success) toast.success("Remittance updated");
    else toast.error(data.error || "Failed");
    load();
  }

  const rate = summary?.defaultCommissionPct ?? 10;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-ink">Payouts &amp; remittances</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-subtle">
            Stores are paid their delivered product sales minus the platform commission of{" "}
            <strong>{rate}%</strong> (or the store&apos;s own rate if one is set). Delivery fees stay
            with the platform. You always see a summary and confirm before anything is marked paid.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={loading} onClick={generate}>
            Calculate payouts only
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading || !summary?.pendingCount}
            onClick={() => runBatch("PAY_ALL_PENDING")}
          >
            Pay pending only
          </Button>
          <Button type="button" disabled={loading} onClick={() => runBatch("SETTLE_ALL_STORES")}>
            {loading ? "Working…" : "Pay all stores"}
          </Button>
        </div>
      </div>

      {summary && (
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Stat label="Pending payouts" value={String(summary.pendingCount)} />
          <Stat label="Gross sales" value={formatCurrency(summary.totalGross)} />
          <Stat label={`Commission (${rate}%)`} value={formatCurrency(summary.totalCommission)} tone="amber" />
          <Stat label="Net to stores" value={formatCurrency(summary.totalNet)} tone="emerald" />
        </div>
      )}

      {detail && (
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-app px-4 py-3 text-xs text-ink-muted">
          {detail}
        </pre>
      )}

      <h2 className="mt-10 text-xl font-bold text-ink">Rider cash remittances</h2>
      <p className="text-xs text-ink-subtle">Cash on delivery collected by riders, to be handed to MandiBazaar.</p>
      <div className="mt-3 space-y-2">
        {remittances.map((r) => (
          <div
            key={r.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm ${
              r.problem ? "border-red-200" : "border-line"
            }`}
          >
            <div>
              <p className="font-medium">{r.order?.orderNumber}</p>
              <p className="text-ink-subtle">
                {r.rider ? `${r.rider.name} · ${r.rider.phone}` : "No rider"} · {r.status}
              </p>
              {r.problem && <p className="text-xs font-medium text-red-600">Check: {r.problem}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {formatCurrency(r.amount)}
                {(r.deliveryFeeInCash ?? 0) > 0 && (
                  <span className="ml-1 text-xs text-ink-subtle">
                    (incl. delivery fee {formatCurrency(r.deliveryFeeInCash ?? 0)})
                  </span>
                )}
              </span>
              {(r.status === "PENDING" || r.status === "SUBMITTED") && (
                <>
                  <Button type="button" onClick={() => remitAction(r, "RECEIVE_REMITTANCE")}>
                    {r.status === "SUBMITTED" ? "Confirm cash received" : "Mark received"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => remitAction(r, "DISPUTE_REMITTANCE")}>
                    Dispute
                  </Button>
                </>
              )}
              {r.status === "DISPUTED" && (
                <>
                  <Button type="button" variant="outline" onClick={() => remitAction(r, "RESOLVE_REMITTANCE", "PENDING")}>
                    Reset to pending
                  </Button>
                  <Button type="button" onClick={() => remitAction(r, "RESOLVE_REMITTANCE", "RECEIVED")}>
                    Resolve &amp; receive
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {!remittances.length && <p className="text-sm text-ink-subtle">No remittances yet.</p>}
      </div>
      <Pagination
        className="mt-3"
        page={remitPage}
        totalPages={remitMeta.totalPages}
        total={remitMeta.total}
        pageSize={PAGE_SIZE}
        itemLabel="remittances"
        onPageChange={setRemitPage}
      />

      <h2 className="mt-10 text-xl font-bold text-ink">Store payouts</h2>
      <div className="mt-3 space-y-2">
        {payouts.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium text-ink">{p.store.name}</p>
              <p className="text-ink-subtle">
                {new Date(p.periodStart).toLocaleDateString("en-PK")} –{" "}
                {new Date(p.periodEnd).toLocaleDateString("en-PK")} · Sales{" "}
                {formatCurrency(p.grossSales)} − {p.commissionRate}% commission{" "}
                {formatCurrency(p.commissionAmount)}
              </p>
              <p className="break-all text-xs text-ink-subtle">
                {p.store.jazzCashNumber
                  ? `JazzCash ${p.store.jazzCashNumber}`
                  : p.store.bankIban || p.store.bankAccountNumber
                    ? `Bank ${p.store.bankName || ""} ${p.store.bankIban || p.store.bankAccountNumber}`
                    : "No payout account on the store"}
                {p.payoutReference ? ` · Ref ${p.payoutReference}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-bold text-emerald-700">{formatCurrency(p.netAmount)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  p.status === "PAID"
                    ? "bg-emerald-100 text-emerald-800"
                    : p.status === "PENDING"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-ink-muted"
                }`}
              >
                {p.status}
              </span>
              {p.status === "PENDING" && (
                <Button type="button" variant="outline" onClick={() => markPaid(p)}>
                  Mark paid
                </Button>
              )}
            </div>
          </div>
        ))}
        {!payouts.length && (
          <p className="text-sm text-ink-subtle">No payouts yet — use &quot;Pay all stores&quot;.</p>
        )}
      </div>
      <Pagination
        className="mt-3"
        page={payoutPage}
        totalPages={payoutMeta.totalPages}
        total={payoutMeta.total}
        pageSize={PAGE_SIZE}
        itemLabel="payouts"
        onPageChange={setPayoutPage}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" }) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-line bg-card text-ink";
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <p className="text-xs font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
