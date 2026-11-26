"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, MapPin, Star } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatQty } from "@/lib/lists/ui";
import { cn, formatCurrency } from "@/lib/utils";
import type { Offer } from "@/components/lists/types";

/** One store's offer, built so several sit side by side from 1024 px and stack as cards on phones (L-05). */
export function OfferCard({
  offer,
  selected,
  canAct,
  onSelect,
  onAccept,
}: {
  offer: Offer;
  selected: boolean;
  /** The list is still open for accepting. */
  canAct: boolean;
  onSelect: () => void;
  onAccept: () => void;
}) {
  const o = offer;
  const accepted = o.status === "ACCEPTED";
  const notSelected = o.status === "NOT_SELECTED";
  const actionable = canAct && o.acceptable;
  return (
    <article
      data-testid="offer-card"
      data-bid-id={o.bidId}
      aria-label={`Offer from ${o.store.name}`}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-card sm:p-5",
        accepted
          ? "border-emerald-400 ring-1 ring-emerald-400"
          : selected && actionable
            ? "border-brand-500 ring-1 ring-brand-500"
            : "border-line",
        notSelected && "opacity-70"
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-bold text-ink">
            <Link href={`/stores/${o.store.slug}`} className="hover:text-brand-700 hover:underline max-md:inline-flex max-md:items-center">
              {o.store.name}
            </Link>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <Star className={cn("h-3.5 w-3.5", o.store.rating != null ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
              {o.store.rating != null ? (
                <>
                  {o.store.rating.toFixed(1)} <span className="text-ink-subtle">({o.store.ratingCount})</span>
                </>
              ) : (
                "No ratings yet"
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {[o.store.area, o.store.city].filter(Boolean).join(", ")}
              {o.distanceKm != null ? ` · ${o.distanceKm.toFixed(1)} km` : ""}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold text-ink" data-testid="offer-total">
            {formatCurrency(o.total)}
          </p>
          {o.discount > 0 && (
            <p className="text-xs text-ink-subtle">
              <span className="line-through">{formatCurrency(o.itemsTotal)}</span>{" "}
              <span className="font-semibold text-emerald-600">-{formatCurrency(o.discount)}</span>
            </p>
          )}
        </div>
      </header>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {accepted && <Badge tone="success">Accepted</Badge>}
        {notSelected && <Badge tone="neutral">Not selected</Badge>}
        {o.tags.includes("LOWEST_PRICE") && <Badge tone="success">Lowest price</Badge>}
        {o.tags.includes("FASTEST") && <Badge tone="info">Fastest</Badge>}
        {o.fullCoverage && <Badge tone="brand">Has everything</Badge>}
      </div>

      {o.needsUpdate && (
        <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          You changed your list. This store is updating its offer, so it can&apos;t be accepted yet.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-app px-3 py-2">
          <dt className="text-xs text-ink-subtle">Items covered</dt>
          <dd className={cn("font-semibold", o.fullCoverage ? "text-emerald-700 dark:text-emerald-300" : "text-ink")}>
            {o.needsUpdate ? "Updating…" : `${o.coveredCount} of ${o.lineCount}`}
          </dd>
        </div>
        <div className="rounded-xl bg-app px-3 py-2">
          <dt className="text-xs text-ink-subtle">Ready in</dt>
          <dd className="flex items-center gap-1 font-semibold text-ink">
            <Clock className="h-3.5 w-3.5" />
            {o.prepMinutes != null ? `${o.prepMinutes} min` : "Not given"}
          </dd>
        </div>
      </dl>

      {o.missingItems.length > 0 && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
          <span className="font-semibold">Doesn&apos;t have:</span> {o.missingItems.join(", ")}
        </p>
      )}
      {o.estimatedDeliveryFee != null && (
        <p className="mt-2 text-xs text-ink-subtle">
          Delivery fee about {formatCurrency(o.estimatedDeliveryFee)}, set later by rider bidding.
        </p>
      )}
      {o.note && <p className="mt-2 break-words rounded-lg bg-app px-3 py-2 text-xs text-ink-muted">“{o.note}”</p>}

      <details className="group mt-3 rounded-xl border border-line">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-ink">
          Item prices
          <span className="text-xs font-normal text-ink-subtle group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-ink-subtle group-open:inline">Hide</span>
        </summary>
        <ul className="divide-y divide-line border-t border-line text-sm">
          {o.lines.map((l) => (
            <li key={l.lineId} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0 break-words">
                <span className={cn(!l.available && "text-ink-subtle line-through")}>{l.name}</span>
                <span className="block text-xs text-ink-subtle">
                  {formatQty(l.quantity)} {l.unit}
                  {l.unitPrice != null ? ` × ${formatCurrency(l.unitPrice)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right font-medium">
                {l.available && l.lineTotal != null ? formatCurrency(l.lineTotal) : <span className="text-xs text-red-600">Not available</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {canAct && o.status === "PENDING" && (
        <div className="mt-auto pt-4">
          {/* Phones/tablets: pick the offer, the sticky bar has the Accept button. Desktop: accept right here. */}
          <button
            type="button"
            onClick={onSelect}
            disabled={!o.acceptable}
            aria-pressed={selected}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold lg:hidden",
              selected ? "bg-brand-50 text-brand-700 ring-1 ring-brand-500 dark:bg-brand-500/15 dark:text-brand-200" : "border border-line text-ink hover:bg-app",
              "disabled:opacity-50"
            )}
          >
            {selected ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Selected
              </>
            ) : (
              "Select this offer"
            )}
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={!o.acceptable}
            className="hidden w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 lg:inline-flex"
          >
            Accept offer
          </button>
        </div>
      )}
    </article>
  );
}
