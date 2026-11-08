"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, Banknote, Clock, HandCoins, Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Submission = {
  id: string;
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};
type Obligation = {
  id: string;
  orderNumber: string;
  customer: string | null;
  collected: number;
  amountDue: number;
  amountRemitted: number;
  outstanding: number;
  status: string;
  collectedAt: string | null;
  dueAt: string | null;
  msLeft: number;
  overdue: boolean;
  receiptNo: string | null;
  receivedAt: string | null;
  submissions: Submission[];
};
type Payload = {
  items: Obligation[];
  outstandingTotal: number;
  overdueTotal: number;
  methods: string[];
  cashHandoverInstructions: string | null;
  restricted: boolean;
  restrictionReason: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  UNDER_VERIFICATION: "bg-indigo-100 text-indigo-800",
  PARTIALLY_REMITTED: "bg-sky-100 text-sky-800",
  RECEIVED: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800",
  OVERDUE: "bg-red-100 text-red-800",
  DISPUTED: "bg-red-100 text-red-800",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Remittance pending",
  SUBMITTED: "Submitted",
  UNDER_VERIFICATION: "Under verification",
  PARTIALLY_REMITTED: "Partially remitted",
  RECEIVED: "Remitted",
  REJECTED: "Rejected",
  OVERDUE: "Overdue",
  DISPUTED: "Disputed",
};
const METHOD_LABEL: Record<string, string> = {
  CASH_HANDOVER: "Cash handover",
  BANK: "Bank transfer",
  JAZZCASH: "JazzCash",
};

function Countdown({ dueAt, overdue }: { dueAt: string | null; overdue: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  if (ms <= 0 || overdue) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
        <AlertTriangle className="h-3.5 w-3.5" /> Overdue
      </span>
    );
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const urgent = ms < 6 * 3_600_000;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${urgent ? "text-red-600" : "text-ink-muted"}`}>
      <Clock className="h-3.5 w-3.5" /> {h}h {m}m {s}s left
    </span>
  );
}

export default function RiderRemittancesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await fetch("/api/rider/remittances", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json?.success) setData(json.data);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-subtle">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-extrabold text-ink">Cash → MandiBazaar</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        COD cash you collected (minus your delivery fee) must reach MandiBazaar within the deadline.
        Submit a payment and a supervisor confirms once the money is actually received.
      </p>

      {data.restricted && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="text-sm text-red-800">
            <p className="font-bold">New deliveries paused</p>
            <p className="mt-0.5">{data.restrictionReason || "Settle your overdue COD cash to resume taking deliveries."}</p>
            <p className="mt-1 text-xs text-red-600">You can still log in, see everything, and submit payment below.</p>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Outstanding to remit</p>
          <p className="mt-1 text-2xl font-black text-amber-900">{formatCurrency(data.outstandingTotal)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${data.overdueTotal > 0 ? "border-red-200 bg-red-50" : "border-line bg-card"}`}>
          <p className={`text-[11px] font-bold uppercase tracking-wide ${data.overdueTotal > 0 ? "text-red-700" : "text-ink-subtle"}`}>Overdue</p>
          <p className={`mt-1 text-2xl font-black ${data.overdueTotal > 0 ? "text-red-700" : "text-ink"}`}>{formatCurrency(data.overdueTotal)}</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {data.items.length === 0 && <p className="text-sm text-ink-subtle">No COD remittances yet.</p>}
        {data.items.map((o) => (
          <ObligationCard
            key={o.id}
            o={o}
            methods={data.methods}
            instructions={data.cashHandoverInstructions}
            open={openId === o.id}
            onToggle={() => setOpenId(openId === o.id ? null : o.id)}
            onDone={() => { setOpenId(null); void load(); }}
          />
        ))}
      </div>
    </div>
  );
}

function ObligationCard({
  o, methods, instructions, open, onToggle, onDone,
}: {
  o: Obligation; methods: string[]; instructions: string | null; open: boolean; onToggle: () => void; onDone: () => void;
}) {
  const retained = Math.max(0, o.collected - o.amountDue);
  const settled = o.status === "RECEIVED";
  const lastRejected = o.submissions.find((s) => s.status === "REJECTED");
  const pendingSub = o.submissions.find((s) => s.status === "PENDING_REVIEW");

  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink">{o.orderNumber}</p>
          {o.customer && <p className="text-xs text-ink-subtle">{o.customer}</p>}
          <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[o.status] || "bg-slate-100"}`}>
            {STATUS_LABEL[o.status] || o.status}
          </span>
        </div>
        <div className="text-right">
          {!settled && <Countdown dueAt={o.dueAt} overdue={o.overdue} />}
          {settled && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Cleared</span>}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-app p-3 text-sm">
        <dt className="text-ink-subtle">Cash collected</dt>
        <dd className="text-right font-semibold text-ink">{formatCurrency(o.collected)}</dd>
        <dt className="text-ink-subtle">You keep (delivery fee)</dt>
        <dd className="text-right font-semibold text-emerald-700 dark:text-emerald-300">{formatCurrency(retained)}</dd>
        <dt className="text-ink-subtle">Payable to MandiBazaar</dt>
        <dd className="text-right font-bold text-ink">{formatCurrency(o.amountDue)}</dd>
        {o.amountRemitted > 0 && (
          <>
            <dt className="text-ink-subtle">Remitted so far</dt>
            <dd className="text-right font-semibold text-sky-700">{formatCurrency(o.amountRemitted)}</dd>
          </>
        )}
        <dt className="font-semibold text-ink-muted">Still owed</dt>
        <dd className="text-right text-base font-black text-amber-700">{formatCurrency(o.outstanding)}</dd>
      </dl>

      {settled && o.receiptNo && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/15 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Remittance receipt
            </span>
            <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{o.receiptNo}</span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-emerald-900 dark:text-emerald-200">
            {o.submissions.filter((s) => s.status === "APPROVED").map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <span>{METHOD_LABEL[s.method] || s.method}{s.reference ? ` · ${s.reference}` : ""}</span>
                <span className="font-semibold">{formatCurrency(s.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-emerald-200 pt-1 font-bold">
              <span>Total remitted{o.receivedAt ? ` · ${new Date(o.receivedAt).toLocaleDateString("en-PK")}` : ""}</span>
              <span>{formatCurrency(o.amountDue)}</span>
            </div>
          </div>
        </div>
      )}

      {lastRejected && !pendingSub && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Last submission rejected{lastRejected.rejectionReason ? `: ${lastRejected.rejectionReason}` : ""}. You can submit again.
        </p>
      )}
      {pendingSub && (
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          {formatCurrency(pendingSub.amount)} via {METHOD_LABEL[pendingSub.method] || pendingSub.method} is awaiting supervisor verification
          {pendingSub.reference ? ` · Ref ${pendingSub.reference}` : ""}.
        </p>
      )}

      {!settled && o.outstanding > 0 && !pendingSub && (
        <div className="mt-3">
          {!open ? (
            <Button className="w-full gap-2" onClick={onToggle}>
              <Banknote className="h-4 w-4" /> Send payment to MandiBazaar
            </Button>
          ) : (
            <SendPayment obligation={o} methods={methods} instructions={instructions} onCancel={onToggle} onDone={onDone} />
          )}
        </div>
      )}
    </div>
  );
}

function SendPayment({
  obligation, methods, instructions, onCancel, onDone,
}: {
  obligation: Obligation; methods: string[]; instructions: string | null; onCancel: () => void; onDone: () => void;
}) {
  const [method, setMethod] = useState<string>(methods[0] || "CASH_HANDOVER");
  const [amount, setAmount] = useState<string>(String(obligation.outstanding));
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const digital = method === "BANK" || method === "JAZZCASH";

  async function upload(file: File) {
    setErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "remittance-proofs");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!json?.success) { setErr(json?.error || "Upload failed."); return; }
      setProofUrl(json.data.url);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setErr("");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr("Enter a valid amount."); return; }
    if (digital && !proofUrl) { setErr("Please attach a payment screenshot."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/rider/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remittanceId: obligation.id, method, amount: amt, proofUrl: proofUrl || undefined, reference: reference || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.success) { setErr(json?.error || "Could not submit."); setBusy(false); return; }
      onDone();
    } catch {
      setErr("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-app p-3">
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              method === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-card text-ink-muted"
            }`}
          >
            {m === "CASH_HANDOVER" ? <HandCoins className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
            {METHOD_LABEL[m] || m}
          </button>
        ))}
      </div>

      {method === "CASH_HANDOVER" && (
        <p className="mt-3 rounded-lg bg-card px-3 py-2 text-xs text-ink-muted">
          {instructions || "Hand the cash to an authorized MandiBazaar supervisor. A reference is generated; the supervisor confirms the amount actually received."}
        </p>
      )}

      {digital && (
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-card px-3 py-3 text-xs font-semibold text-ink-muted hover:bg-app">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : proofUrl ? "Screenshot attached ✓ — replace" : "Attach payment screenshot"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Transaction ID / reference (optional)"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line bg-card px-2">
          <span className="text-xs text-ink-subtle">Rs</span>
          <input
            type="number"
            min={1}
            max={obligation.outstanding}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 bg-transparent px-2 py-2 text-sm outline-none"
          />
        </div>
        <span className="text-xs text-ink-subtle">of {formatCurrency(obligation.outstanding)} owed</span>
      </div>

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      <div className="mt-3 flex gap-2">
        <Button className="flex-1" disabled={busy || uploading} onClick={() => void submit()}>
          {busy ? "Submitting…" : method === "CASH_HANDOVER" ? "Request cash handover" : "Submit payment"}
        </Button>
        <button onClick={onCancel} className="rounded-lg px-3 text-sm font-semibold text-ink-subtle hover:text-ink-muted">
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-subtle">
        Submitting does not clear your balance — a supervisor must verify the money is received.
      </p>
    </div>
  );
}
