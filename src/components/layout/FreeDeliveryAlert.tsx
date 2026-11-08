"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Truck, X, Sparkles } from "lucide-react";
import {
  refreshCartDeliveryProgress,
  useCartStore,
} from "@/lib/store/cart";
import { formatCurrency, cn } from "@/lib/utils";

export function FreeDeliveryAlert() {
  const count = useCartStore((s) => s.count);
  const revision = useCartStore((s) => s.revision);
  const productTotal = useCartStore((s) => s.productTotal);
  const threshold = useCartStore((s) => s.freeDeliveryThreshold);
  const isFree = useCartStore((s) => s.isFreeDelivery);

  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const wasFree = useRef(false);
  const hydrated = useRef(false);

  useEffect(() => {
    refreshCartDeliveryProgress().then(() => {
      hydrated.current = true;
      wasFree.current = useCartStore.getState().isFreeDelivery;
    });
  }, []);

  useEffect(() => {
    if (!hydrated.current && revision === 0) return;
    refreshCartDeliveryProgress().then(() => {
      const free = useCartStore.getState().isFreeDelivery;
      if (free && !wasFree.current) {
        setToast("Free delivery unlocked!");
        setDismissed(false);
        const t = setTimeout(() => setToast(null), 4500);
        wasFree.current = true;
        return () => clearTimeout(t);
      }
      if (!free) wasFree.current = false;
    });
  }, [revision, count]);

  const remaining = Math.max(0, threshold - productTotal);
  const progress = threshold > 0 ? Math.min(100, (productTotal / threshold) * 100) : 0;
  // Same rule as delivery-fee.ts: products subtotal before coupon; no bar without a threshold
  const showBar = count > 0 && !dismissed && (threshold > 0 || isFree);

  return (
    <>
      {showBar && (
        <div
          className={cn(
            "sticky top-[var(--header-offset,0px)] z-40 border-b shadow-sm",
            isFree
              ? "border-emerald-200 bg-gradient-to-r from-emerald-50 via-brand-50 to-teal-50"
              : "border-amber-200/80 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50"
          )}
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 sm:px-4 lg:px-6">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm",
                isFree
                  ? "bg-gradient-to-br from-brand-600 to-emerald-700"
                  : "bg-gradient-to-br from-accent-500 to-orange-600"
              )}
            >
              {isFree ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {isFree ? (
                <p className="text-xs font-bold text-emerald-800 sm:text-sm">
                  Free delivery — your cart qualifies
                  {threshold > 0 && productTotal >= threshold
                    ? ` (Rs ${threshold.toLocaleString("en-PK")}+ of products)`
                    : ""}
                </p>
              ) : (
                <p className="text-xs font-semibold text-amber-900 sm:text-sm">
                  Free delivery alert — add{" "}
                  <span className="font-black text-accent-600">
                    {formatCurrency(remaining)}
                  </span>{" "}
                  more of products for free delivery
                </p>
              )}
              <div className="mt-1.5 h-1.5 max-w-md overflow-hidden rounded-full bg-card/80 ring-1 ring-black/5">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    isFree
                      ? "bg-gradient-to-r from-brand-500 to-emerald-500"
                      : "bg-gradient-to-r from-accent-500 to-orange-500"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <Link
              href="/cart"
              className="hidden shrink-0 rounded-lg bg-card/90 px-3 py-1.5 text-xs font-bold text-ink shadow-sm ring-1 ring-black/5 transition hover:bg-card sm:inline-flex"
            >
              View cart
            </Link>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg p-1.5 text-ink-subtle hover:bg-card/70 hover:text-ink"
              aria-label="Dismiss free delivery alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4 sm:top-24">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-200 bg-card px-4 py-3 shadow-[0_12px_40px_-12px_rgba(5,150,105,0.45)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-emerald-700 text-white">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black text-emerald-800">{toast}</p>
              <p className="text-xs text-ink-subtle">
                No delivery fee on this order
              </p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 rounded-lg p-1 text-ink-subtle hover:bg-app hover:text-ink-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
