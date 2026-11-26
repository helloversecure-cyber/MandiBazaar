"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bike, Hourglass, PackageCheck, Phone, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Countdown } from "@/components/lists/ListBits";
import type { RiderBidsView } from "@/components/lists/types";
import { acceptRiderErrorMessage, newIdempotencyKey, vehicleLabel } from "@/lib/lists/ui";
import { formatCurrency } from "@/lib/utils";

const REFRESH_MS = 10_000;
/** Order statuses before packing: riders can't bid yet. */
const BEFORE_PACKING = new Set(["PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "PACKED"]);

/**
 * Rider bidding on an item-list order (W8 API): after the store packs, nearby
 * riders bid a delivery fee, cheapest first; the customer picks one. Accepting
 * sends the fee the customer saw (expectedAmount) and reuses one request key per
 * bid, so a double tap or a retry can't choose twice.
 */
export function RiderBidsSection({ orderNumber, onAssigned }: { orderNumber: string; onAssigned?: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<RiderBidsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/rider-bids`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (d?.success) setView(d.data);
    } catch {
      /* keep the last view */
    }
  }, [orderNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const req = view?.request ?? null;
  const live =
    !!view &&
    !view.assignedRider &&
    ((req === null && BEFORE_PACKING.has(view.orderStatus)) || req?.status === "OPEN");

  useEffect(() => {
    if (!live || busyId) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [live, busyId, load]);

  async function choose(bid: RiderBidsView["bids"][number]) {
    const r = await confirm({
      title: `Choose ${bid.rider.name}?`,
      message: (
        <span>
          Delivery fee <strong>{formatCurrency(bid.amount)}</strong>. You pay the products and the delivery fee in cash to
          the rider when your order arrives.
        </span>
      ),
      confirmLabel: "Choose rider",
      cancelLabel: "Back",
    });
    if (!r.confirmed) return;
    let key = keys.current.get(bid.id);
    if (!key) {
      key = newIdempotencyKey("rider");
      keys.current.set(bid.id, key);
    }
    setBusyId(bid.id);
    setError(null);
    let res: Response | null = null;
    let d: { success?: boolean; error?: string; code?: string; data?: { reused?: boolean } } | null = null;
    try {
      res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/rider-bids/${bid.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key, expectedAmount: bid.amount }),
      });
      d = await res.json().catch(() => null);
    } catch {
      res = null;
    }
    setBusyId(null);
    if (res && d?.success) {
      toast.success(`${bid.rider.name} is delivering your order`);
      await load();
      onAssigned?.();
      return;
    }
    const f = acceptRiderErrorMessage(res ? { status: res.status, code: d?.code, error: d?.error } : null);
    if (!f.keepKey) keys.current.delete(bid.id);
    setError(f.message);
    if (f.reload) {
      await load();
      onAssigned?.();
    }
  }

  if (!view) {
    return <div className="mb-6 skeleton h-28 rounded-2xl" />;
  }

  const fee = view.deliveryFee;

  return (
    <section
      data-testid="rider-bids"
      aria-labelledby="rider-bids-title"
      className="mb-6 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rider-bids-title" className="flex items-center gap-2 font-bold text-ink">
          <Bike className="h-4 w-4" /> Delivery rider
        </h2>
        {req?.status === "OPEN" && req.biddingOpen && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
            <Hourglass className="h-3.5 w-3.5" /> Bidding <Countdown until={req.expiresAt} onEnd={() => void load()} />
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {view.assignedRider ? (
        <div className="mt-3 flex flex-wrap items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-500/10" data-testid="assigned-rider">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{view.assignedRider.name} is delivering your order</p>
            <p className="mt-0.5 text-ink-muted">
              {vehicleLabel(view.assignedRider.vehicleType)}
              {fee != null ? ` · Delivery fee ${formatCurrency(fee)}` : ""}
            </p>
            <p className="mt-0.5 text-ink-muted">Cash to pay the rider: {formatCurrency(view.remainingAmount)}</p>
          </div>
          {view.assignedRider.phone && (
            <a
              href={`tel:${view.assignedRider.phone}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-card px-3 py-2 text-sm font-semibold text-emerald-700"
            >
              <Phone className="h-4 w-4" /> Call {view.assignedRider.phone}
            </a>
          )}
        </div>
      ) : req === null ? (
        <p className="mt-3 flex gap-2 text-sm text-ink-muted">
          <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {BEFORE_PACKING.has(view.orderStatus)
            ? "When the store has packed your order, nearby riders will bid on the delivery fee. You'll choose one here."
            : "Rider bidding isn't open for this order."}
        </p>
      ) : req.status === "NO_BIDS" ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          No rider bid on this delivery. MandiBazaar will assign a rider for you and let you know.
        </p>
      ) : req.status === "OPEN" && view.bids.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          {req.biddingOpen
            ? "Waiting for rider bids… Nearby riders are being told about your order."
            : "No rider has bid yet. We're asking riders a bit further away."}
        </p>
      ) : req.status === "OPEN" ? (
        <>
          <p className="mt-1 text-xs text-ink-subtle">
            Cheapest first. You pay the products and the delivery fee in cash to the rider.
            {!req.biddingOpen && " Bidding has ended — choose one of these riders."}
          </p>
          <ul className="mt-3 space-y-2">
            {view.bids.map((b, i) => (
              <li
                key={b.id}
                data-testid="rider-bid"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 sm:flex-nowrap"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                    <span className="break-words">{b.rider.name}</span>
                    {i === 0 && view.bids.length > 1 && <Badge tone="success">Cheapest</Badge>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {vehicleLabel(b.rider.vehicleType)} · {b.rider.completedDeliveries} deliveries
                  </p>
                  {b.note && <p className="mt-0.5 break-words text-xs text-ink-subtle">“{b.note}”</p>}
                </div>
                <p className="text-base font-bold text-ink">{formatCurrency(b.amount)}</p>
                <button
                  type="button"
                  onClick={() => choose(b)}
                  disabled={!!busyId}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
                >
                  {busyId === b.id ? "Choosing…" : "Choose rider"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Rider bidding on this order has closed.</p>
      )}
    </section>
  );
}
