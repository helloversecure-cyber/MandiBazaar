"use client";

/**
 * Admin Riders page — "Pay rider" button (confirm dialog with summary, method and
 * transfer reference) and per-rider payout history. Rider pay model (owner decision 7).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { RIDER_PAYOUT_METHODS, RIDER_PAYOUT_METHOD_LABELS, type RiderPayoutMethod } from "@/lib/riders/pay-rules";

type Preview = {
  rider: { id: string; name: string; phone: string };
  payoutAccount: string;
  payRule: string;
  items: { orderId: string; orderNumber: string; pay: number; feeFixed: boolean }[];
  count: number;
  amount: number;
};

function MethodPicker({ initial, onChange }: { initial: RiderPayoutMethod; onChange: (m: RiderPayoutMethod) => void }) {
  const [m, setM] = useState<RiderPayoutMethod>(initial);
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1 block font-medium text-ink-muted">How did you pay?</span>
      <select
        value={m}
        onChange={(e) => {
          const v = e.target.value as RiderPayoutMethod;
          setM(v);
          onChange(v);
        }}
        className="w-full rounded-xl border border-line px-3 py-2 text-sm"
      >
        {RIDER_PAYOUT_METHODS.map((k) => (
          <option key={k} value={k}>
            {RIDER_PAYOUT_METHOD_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PayRiderButton({
  riderId,
  riderName,
  onPaid,
}: {
  riderId: string;
  riderName: string;
  onPaid: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const method = useRef<RiderPayoutMethod>("BANK_TRANSFER");

  async function pay() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/rider-payouts?riderId=${encodeURIComponent(riderId)}&preview=1`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (!d.success) {
        toast.error(d.error || "Could not load unpaid deliveries");
        return;
      }
      const p = d.data as Preview;
      if (!p.count) {
        toast.info(`${riderName} has nothing unpaid`);
        onPaid();
        return;
      }
      const noAccount = p.payoutAccount === "No payout account";
      method.current = noAccount ? "CASH" : p.payoutAccount.startsWith("JazzCash") ? "JAZZCASH" : "BANK_TRANSFER";
      const priced = p.items.filter((i) => !i.feeFixed).length;
      const c = await confirm({
        title: `Pay ${p.rider.name} ${formatCurrency(p.amount)}?`,
        message: (
          <div className="space-y-1 text-sm text-ink-muted">
            <p>
              <strong>{p.count}</strong> unpaid {p.count === 1 ? "delivery" : "deliveries"} ·{" "}
              <strong>{formatCurrency(p.amount)}</strong>
            </p>
            <p>Pay to: {p.payoutAccount}</p>
            <p className="text-xs text-ink-subtle">Rule: {p.payRule}.</p>
            {priced > 0 && (
              <p className="text-xs text-amber-700">
                {priced} older {priced === 1 ? "delivery has" : "deliveries have"} no fixed fee yet — priced with the
                current rule and saved with this payment.
              </p>
            )}
            <p className="text-xs text-ink-subtle">
              Send the money first, then record it here. This marks these deliveries as paid.
            </p>
            <MethodPicker initial={method.current} onChange={(m) => (method.current = m)} />
          </div>
        ),
        confirmLabel: "Record payment",
        reason: {
          label: "Transfer reference / transaction ID (required for bank and JazzCash)",
          required: false,
          maxLength: 80,
          placeholder: "e.g. TID 01234567890",
        },
      });
      if (!c.confirmed) return;
      const post = await fetch("/api/admin/rider-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riderId,
          orderIds: p.items.map((i) => i.orderId),
          expectedAmount: p.amount,
          expectedCount: p.count,
          method: method.current,
          reference: c.reason || "",
        }),
      });
      const r = await post.json();
      if (!r.success) {
        toast.error(r.error || "Could not record the payment");
        if (post.status === 409) onPaid();
        return;
      }
      toast.success(r.data.message || "Payment recorded");
      onPaid();
    } catch {
      toast.error("Could not record the payment. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void pay()}
      className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
    >
      {busy ? "Loading…" : "Pay rider"}
    </button>
  );
}

type PayoutRow = {
  id: string;
  amount: number;
  deliveryCount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  paidBy: string | null;
  orderNumbers: string[];
};

export function RiderPayPanel({ riderId }: { riderId: string }) {
  const [items, setItems] = useState<PayoutRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, limit: 10 });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(
        `/api/admin/rider-payouts?riderId=${encodeURIComponent(riderId)}&page=${page}&limit=10`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!d.success) {
        setError(d.error || "Could not load payouts");
        return;
      }
      setItems(d.data.items);
      setMeta(d.data.pagination);
    } catch {
      setError("Could not load payouts. Check your connection.");
    }
  }, [riderId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-4 rounded-xl border border-line bg-app p-3">
      <p className="text-sm font-semibold text-ink-muted">Payout history</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {!items && !error && <p className="mt-2 text-xs text-ink-subtle">Loading…</p>}
      {items && items.length === 0 && <p className="mt-2 text-xs text-ink-subtle">No payouts yet.</p>}
      <div className="mt-2 space-y-2">
        {items?.map((p) => (
          <div key={p.id} className="rounded-lg bg-card px-3 py-2 text-xs text-ink-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{formatCurrency(p.amount)}</p>
              <p>{new Date(p.paidAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</p>
            </div>
            <p>
              {p.deliveryCount} {p.deliveryCount === 1 ? "delivery" : "deliveries"} ·{" "}
              {p.method ? RIDER_PAYOUT_METHOD_LABELS[p.method as RiderPayoutMethod] || p.method : "—"}
              {p.reference ? ` · Ref ${p.reference}` : ""}
              {p.paidBy ? ` · by ${p.paidBy}` : ""}
            </p>
            {p.orderNumbers.length > 0 && (
              <p className="break-all text-ink-subtle">
                {p.orderNumbers.join(", ")}
                {p.deliveryCount > p.orderNumbers.length ? ` +${p.deliveryCount - p.orderNumbers.length} more` : ""}
              </p>
            )}
          </div>
        ))}
      </div>
      {meta.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={meta.totalPages}
          total={meta.total}
          pageSize={meta.limit}
          onPageChange={setPage}
          itemLabel="payouts"
        />
      )}
    </div>
  );
}
