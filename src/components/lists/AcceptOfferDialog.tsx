"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Bike, X } from "lucide-react";
import { AddressPicker } from "@/components/lists/ListBits";
import type { Offer, SavedAddress } from "@/components/lists/types";
import { acceptOfferErrorMessage, newIdempotencyKey } from "@/lib/lists/ui";
import { formatCurrency } from "@/lib/utils";

export type AcceptResult = { orderNumber: string; reused: boolean; droppedItems: string[] };

/**
 * Confirm screen before accepting an offer (E-04): which items are dropped, the
 * delivery address, cash on delivery, and that the delivery fee comes later
 * from rider bidding. Sends the list version and the total the customer saw, so
 * a changed list or offer is refused instead of silently accepted. The same
 * request key is reused on a retry so a double tap can't place two orders.
 */
export function AcceptOfferDialog({
  listId,
  listVersion,
  offer,
  addresses,
  defaultAddressId,
  onClose,
  onAccepted,
  onStale,
}: {
  listId: string;
  listVersion: number;
  offer: Offer;
  addresses: SavedAddress[] | null;
  defaultAddressId: string;
  onClose: () => void;
  onAccepted: (r: AcceptResult) => void;
  /** Offers or the list changed: reload them (dialog closes). */
  onStale: (message: string) => void;
}) {
  const [addressId, setAddressId] = useState(defaultAddressId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey("list"));
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!addressId && defaultAddressId) setAddressId(defaultAddressId);
  }, [defaultAddressId, addressId]);

  useEffect(() => {
    confirmBtn.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  async function accept() {
    if (!addressId) {
      setError("Choose a delivery address");
      return;
    }
    setBusy(true);
    setError(null);
    let res: Response | null = null;
    let data: { success?: boolean; data?: AcceptResult; error?: string; code?: string } | null = null;
    try {
      res = await fetch(`/api/lists/${listId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidId: offer.bidId,
          addressId,
          idempotencyKey: key.current,
          listVersion,
          expectedTotal: offer.total,
        }),
      });
      data = await res.json().catch(() => null);
    } catch {
      res = null;
    }
    if (res && data?.success && data.data) {
      onAccepted(data.data);
      return;
    }
    setBusy(false);
    const f = acceptOfferErrorMessage(res ? { status: res.status, code: data?.code, error: data?.error } : null);
    if (!f.keepKey) key.current = newIdempotencyKey("list");
    if (f.reload) onStale(f.message);
    else setError(f.message);
  }

  const dropped = offer.lines.filter((l) => !l.available).map((l) => l.name);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 sm:items-center sm:px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accept-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="accept-title" className="text-lg font-bold text-ink">
              Accept this offer?
            </h2>
            <p className="break-words text-sm text-ink-muted">{offer.store.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="inline-flex items-center justify-center rounded-lg p-2 text-ink-muted hover:bg-app"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="space-y-1.5 rounded-xl bg-app p-3">
            <div className="flex justify-between gap-3">
              <span className="text-ink-muted">Items ({offer.coveredCount} of {offer.lineCount})</span>
              <span>{formatCurrency(offer.itemsTotal)}</span>
            </div>
            {offer.discount > 0 && (
              <div className="flex justify-between gap-3 text-emerald-600">
                <span>Store discount</span>
                <span>-{formatCurrency(offer.discount)}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-bold text-ink">
              <span>Products total</span>
              <span data-testid="accept-total">{formatCurrency(offer.total)}</span>
            </div>
          </div>

          {dropped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold">These items will be left out</p>
              <p className="mt-0.5 break-words">{dropped.join(", ")}</p>
              <p className="mt-1 text-xs">The store doesn&apos;t have them. You can order them separately.</p>
            </div>
          )}

          <div>
            <h3 className="mb-2 font-semibold text-ink">Deliver to</h3>
            <AddressPicker
              addresses={addresses}
              value={addressId}
              onChange={(id) => {
                setAddressId(id);
                setError(null);
              }}
              returnTo={`/account/lists/${listId}`}
              name="accept-address"
            />
          </div>

          <p className="flex gap-2 text-ink-muted">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <strong className="text-ink">Cash on delivery.</strong> You pay the products total to the rider when your
              order arrives.
            </span>
          </p>
          <p className="flex gap-2 text-ink-muted">
            <Bike className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              <strong className="text-ink">Delivery fee is set later by rider bidding.</strong> When the store has packed
              your order, nearby riders bid and you choose one on the order page
              {offer.estimatedDeliveryFee != null ? ` (usually about ${formatCurrency(offer.estimatedDeliveryFee)})` : ""}.
            </span>
          </p>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        {/* Sticky action bar (stays in view on phones while the content scrolls). */}
        <div className="flex gap-2 border-t border-line bg-card px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-app"
          >
            Back
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={accept}
            disabled={busy || !addressId}
            className="flex-[2] rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Placing order…" : `Accept and place order`}
          </button>
        </div>
      </div>
    </div>
  );
}
