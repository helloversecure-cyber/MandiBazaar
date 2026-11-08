"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { HandCoins, Banknote, CheckCircle2, XCircle, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";

type Overview = {
  totalCodOrders: number; totalCollected: number; totalExpected: number; totalRemitted: number;
  totalPending: number; totalOverdue: number; totalPartiallyRemitted: number;
  ordersUnderVerification: number; pendingSubmissions: number; rejectedSubmissions: number; ridersWithOverdue: number;
};
type Sub = {
  id: string; method: string; amount: number; proofUrl: string | null; reference: string | null;
  createdAt: string; orderNumber: string | null; outstanding: number;
  rider: { id: string; name: string; phone: string } | null;
};
type LedgerRow = {
  riderId: string; name: string; phone: string; restricted: boolean; restrictionReason: string | null;
  collected: number; retained: number; due: number; remitted: number; outstanding: number; overdue: number;
  lastRemittance: string | null; nextDeadline: string | null;
};
type OrderRow = {
  id: string; orderNumber: string; customer: string | null; stores: string[];
  rider: { id: string; name: string } | null; productSubtotal: number; discount: number; deliveryFee: number;
  collected: number; riderRetained: number; amountDue: number; amountRemitted: number; outstanding: number; status: string;
};

const METHOD_LABEL: Record<string, string> = { CASH_HANDOVER: "Cash handover", BANK: "Bank transfer", JAZZCASH: "JazzCash" };
const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800", UNDER_VERIFICATION: "bg-indigo-100 text-indigo-800",
  PARTIALLY_REMITTED: "bg-sky-100 text-sky-800", RECEIVED: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-red-100 text-red-800", DISPUTED: "bg-red-100 text-red-800", SUBMITTED: "bg-blue-100 text-blue-800", REJECTED: "bg-red-100 text-red-800",
};

export default function CashCollectionPage() {
  const [tab, setTab] = useState<"queue" | "ledger" | "orders">("queue");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<Sub[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const [ov, q, l, o] = await Promise.all([
      fetch("/api/admin/finance/remittances?resource=overview").then((r) => r.json()),
      fetch("/api/admin/finance/remittances?resource=queue").then((r) => r.json()),
      fetch("/api/admin/finance/remittances?resource=ledger").then((r) => r.json()),
      fetch("/api/admin/finance/remittances?resource=orders").then((r) => r.json()),
    ]);
    if (ov.success) setOverview(ov.data);
    if (q.success) setQueue(q.data.submissions);
    if (l.success) setLedger(l.data.riders);
    if (o.success) setOrders(o.data.orders);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function act(body: Record<string, unknown>, okMsg: string) {
    setMsg("");
    const res = await fetch("/api/admin/finance/remittances", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setMsg(json?.success ? okMsg : json?.error || "Action failed");
    await refresh();
  }

  if (!overview) {
    return <div className="flex items-center justify-center py-20 text-ink-subtle"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <HandCoins className="h-6 w-6 text-ink" />
        <h1 className="font-display text-3xl text-ink">Cash Collection &amp; Remittance</h1>
      </div>
      <p className="mt-1 text-sm text-ink-subtle">
        COD cash riders collected, what they owe MandiBazaar, and verification of their remittances.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="COD collected" value={formatCurrency(overview.totalCollected)} sub={`${overview.totalCodOrders} orders`} />
        <Stat label="Expected to MandiBazaar" value={formatCurrency(overview.totalExpected)} sub={`Remitted ${formatCurrency(overview.totalRemitted)}`} />
        <Stat label="Pending to collect" value={formatCurrency(overview.totalPending)} tone={overview.totalPending > 0 ? "amber" : undefined} />
        <Stat label="Overdue" value={formatCurrency(overview.totalOverdue)} sub={`${overview.ridersWithOverdue} riders restricted`} tone={overview.totalOverdue > 0 ? "red" : undefined} />
      </div>

      {msg && <p className="mt-4 rounded-lg bg-app px-3 py-2 text-sm text-ink-muted">{msg}</p>}

      <div className="mt-6 flex gap-2 border-b border-line">
        {([["queue", `Review queue (${queue.length})`], ["ledger", "Rider ledger"], ["orders", "Order reconciliation"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-brand-600 text-ink" : "border-transparent text-ink-subtle"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="mt-4 space-y-3">
          {queue.length === 0 && <p className="text-sm text-ink-subtle">Nothing awaiting verification.</p>}
          {queue.map((s) => (
            <QueueCard key={s.id} s={s} onAct={act} />
          ))}
        </div>
      )}

      {tab === "ledger" && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="text-left text-xs uppercase text-ink-subtle">
              <tr><th className="py-2">Rider</th><th>Collected</th><th>Retained</th><th>Due</th><th>Remitted</th><th>Outstanding</th><th>Overdue</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.riderId} className="border-t border-line">
                  <td className="py-2"><p className="font-semibold text-ink">{r.name}</p><p className="text-xs text-ink-subtle">{r.phone}</p></td>
                  <td>{formatCurrency(r.collected)}</td>
                  <td className="text-emerald-700">{formatCurrency(r.retained)}</td>
                  <td>{formatCurrency(r.due)}</td>
                  <td className="text-sky-700">{formatCurrency(r.remitted)}</td>
                  <td className="font-semibold text-amber-700">{formatCurrency(r.outstanding)}</td>
                  <td className={r.overdue > 0 ? "font-bold text-red-600" : "text-ink-subtle"}>{formatCurrency(r.overdue)}</td>
                  <td>{r.restricted ? <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600"><AlertTriangle className="h-3 w-3" />Restricted</span> : <span className="text-xs text-emerald-600">OK</span>}</td>
                  <td>{r.restricted && (
                    <button onClick={() => { const reason = prompt("Reason for clearing this rider's COD restriction?"); if (reason) void act({ action: "CLEAR_RESTRICTION", riderId: r.riderId, reason }, "Restriction cleared"); }}
                      className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-muted hover:bg-app">Clear</button>
                  )}</td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-ink-subtle">No rider cash activity yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "orders" && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase text-ink-subtle">
              <tr><th className="py-2">Order</th><th>Rider</th><th>Products</th><th>Fee</th><th>Collected</th><th>Rider keeps</th><th>Due</th><th>Remitted</th><th>Outstanding</th><th>Status</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="py-2"><p className="font-semibold text-ink">{o.orderNumber}</p><p className="text-xs text-ink-subtle">{o.customer} · {o.stores.join(", ")}</p></td>
                  <td>{o.rider?.name || "—"}</td>
                  <td>{formatCurrency(o.productSubtotal - o.discount)}</td>
                  <td>{formatCurrency(o.deliveryFee)}</td>
                  <td>{formatCurrency(o.collected)}</td>
                  <td className="text-emerald-700">{formatCurrency(o.riderRetained)}</td>
                  <td className="font-semibold">{formatCurrency(o.amountDue)}</td>
                  <td className="text-sky-700">{formatCurrency(o.amountRemitted)}</td>
                  <td className="font-semibold text-amber-700">{formatCurrency(o.outstanding)}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[o.status] || "bg-slate-100"}`}>{o.status}</span></td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-ink-subtle">No COD orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" | "red" }) {
  const toneCls = tone === "red" ? "border-red-200 bg-red-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-line bg-card";
  return (
    <div className={`rounded-2xl border p-4 shadow-card ${toneCls}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
    </div>
  );
}

function QueueCard({ s, onAct }: { s: Sub; onAct: (body: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [amount, setAmount] = useState(String(s.amount));
  const handover = s.method === "CASH_HANDOVER";
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            {handover ? <HandCoins className="h-4 w-4 text-amber-600" /> : <Banknote className="h-4 w-4 text-sky-600" />}
            {METHOD_LABEL[s.method] || s.method} · {formatCurrency(s.amount)}
          </p>
          <p className="text-xs text-ink-subtle">{s.orderNumber} · {s.rider?.name} ({s.rider?.phone})</p>
          <p className="text-xs text-ink-subtle">Owes {formatCurrency(s.outstanding)} · {s.reference ? `Ref ${s.reference}` : "no reference"}</p>
        </div>
        {s.proofUrl && (
          <a href={s.proofUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 underline">View proof</a>
        )}
      </div>

      {handover ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-ink-subtle"><ShieldCheck className="h-3.5 w-3.5" /> Confirm cash actually received:</span>
          <div className="flex items-center rounded-lg border border-line bg-card px-2">
            <span className="text-xs text-ink-subtle">Rs</span>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 bg-transparent px-2 py-1.5 text-sm outline-none" />
          </div>
          <Button size="sm" className="gap-1" onClick={() => void onAct({ action: "CONFIRM_HANDOVER", submissionId: s.id, decision: "APPROVE", confirmedAmount: Number(amount) }, "Handover confirmed")}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm received
          </Button>
          <button onClick={() => { const reason = prompt("Reason for rejecting this handover?"); if (reason) void onAct({ action: "CONFIRM_HANDOVER", submissionId: s.id, decision: "REJECT", rejectionReason: reason }, "Rejected"); }}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Reject</button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="gap-1" onClick={() => void onAct({ action: "REVIEW_PROOF", submissionId: s.id, decision: "APPROVE" }, "Payment verified")}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Verify &amp; approve
          </Button>
          <button onClick={() => { const reason = prompt("Reason for rejecting this proof?"); if (reason) void onAct({ action: "REVIEW_PROOF", submissionId: s.id, decision: "REJECT", rejectionReason: reason }, "Rejected"); }}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}
