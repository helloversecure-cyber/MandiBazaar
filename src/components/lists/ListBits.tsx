"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatCountdown, listStatusInfo } from "@/lib/lists/ui";
import { cn } from "@/lib/utils";
import { useListBidding } from "@/components/lists/useListBidding";
import type { ListAddress, SavedAddress } from "@/components/lists/types";

export function ListStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = listStatusInfo(status);
  return (
    <Badge tone={s.tone} dot className={className}>
      {s.label}
    </Badge>
  );
}

/** Ticking "1h 05m left" until `until`; calls onEnd once when it reaches zero. */
export function Countdown({ until, onEnd, className }: { until: string; onEnd?: () => void; className?: string }) {
  const end = new Date(until).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = end - now;
  const ended = left <= 0;
  useEffect(() => {
    if (ended) onEnd?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  return (
    <span className={cn("tabular-nums", className)} aria-live="off">
      {formatCountdown(left)}
    </span>
  );
}

export function addressLine(a: ListAddress | SavedAddress | null | undefined): string {
  if (!a) return "";
  return [a.houseBuilding, a.street, a.area, a.city].filter(Boolean).join(", ");
}

/** Radio list of saved addresses + a link to add one. */
export function AddressPicker({
  addresses,
  value,
  onChange,
  error,
  returnTo,
  name = "address",
}: {
  addresses: SavedAddress[] | null;
  value: string;
  onChange: (id: string) => void;
  error?: string | null;
  returnTo: string;
  name?: string;
}) {
  const addHref = `/account/addresses?returnTo=${encodeURIComponent(returnTo)}`;
  if (addresses === null) return <div className="skeleton h-20 rounded-xl" />;
  if (!addresses.length) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">
        <p>You have no saved address yet. Stores need it to know where to deliver.</p>
        <Link href={addHref} className="mt-2 inline-flex items-center font-semibold text-brand-600 hover:underline">
          Add an address
        </Link>
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
    );
  }
  return (
    <fieldset>
      <legend className="sr-only">Delivery address</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {addresses.map((a) => {
          const checked = value === a.id;
          const noPin = a.latitude == null || a.longitude == null;
          return (
            <label
              key={a.id}
              className={cn(
                "flex min-h-[44px] cursor-pointer gap-3 rounded-xl border p-3 text-sm transition",
                checked ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-500/10" : "border-line bg-card hover:border-brand-300"
              )}
            >
              <input
                type="radio"
                name={name}
                value={a.id}
                checked={checked}
                onChange={() => onChange(a.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                  {a.label || "Address"}
                  {a.isDefault && <Badge tone="brand">Default</Badge>}
                </span>
                <span className="mt-0.5 block break-words text-ink-muted">{addressLine(a)}</span>
                {noPin && (
                  <span className="mt-1 block text-xs text-amber-700">
                    No map pin: only stores in {a.city} will see your list.
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <Link
        href={addHref}
        className="mt-2 inline-flex items-center text-sm font-semibold text-brand-600 hover:underline max-md:min-h-[44px]"
      >
        + Add a new address
      </Link>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </fieldset>
  );
}

/** Home page card: "Can't find it? Send a list". Hidden when the feature is off for this person. */
export function SendListCard({ className }: { className?: string }) {
  const on = useListBidding();
  if (!on) return null;
  return (
    <section className={cn("mx-auto w-full max-w-7xl px-4 lg:px-6", className)} aria-label="Send a list to stores">
      <div className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-brand-500/20 dark:bg-brand-500/10">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-bold text-ink">Send your shopping list to nearby stores</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Write what you need, even items not in the catalogue. Stores send you prices and you pick the best offer.
            </p>
          </div>
        </div>
        <Link
          href="/lists/new"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Send a list
        </Link>
      </div>
    </section>
  );
}
