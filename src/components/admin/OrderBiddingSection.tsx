"use client";

import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { postPackStateLabel } from "@/lib/lists/store-ui";
import { formatCurrency } from "@/lib/utils";

export type OrderBidding = {
  list: {
    id: string;
    status: string;
    createdAt: string;
    acceptedAt: string | null;
    storesSent: number;
    offers: { id: string; storeName: string; status: string; accepted: boolean; total: number; coveredCount: number; updatedAt: string }[];
  } | null;
  riderBidding: {
    requestId: string;
    trigger: string;
    status: string;
    reopenCount: number;
    expiresAt: string;
    createdAt: string;
    acceptedFee: number | null;
    bids: {
      id: string;
      riderName: string;
      riderPhone: string | null;
      amount: number;
      status: string;
      won: boolean;
      createdAt: string;
      updatedAt: string;
    }[];
  } | null;
};

const TONE: Record<string, BadgeTone> = {
  PENDING: "info",
  ACCEPTED: "success",
  NOT_SELECTED: "neutral",
  WITHDRAWN: "neutral",
  REJECTED: "neutral",
  EXPIRED: "warning",
};
const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-PK") : "—");

/** Admin order page (W15, I-02): the list and offers behind the order, rider bids, delivery-code tries. */
export function OrderBiddingSection({
  bidding,
  code,
}: {
  bidding: OrderBidding;
  code?: { required?: boolean; attempts?: number; lockedUntil?: string | null };
}) {
  const { list, riderBidding: rb } = bidding;
  const rbState = rb ? postPackStateLabel({ status: rb.status, biddingOpen: new Date(rb.expiresAt).getTime() > Date.now() }) : null;
  const locked = code?.lockedUntil && new Date(code.lockedUntil) > new Date();
  return (
    <section className="rounded-3xl bg-card p-5 shadow-card" data-testid="order-bidding">
      <h2 className="font-display text-lg">Bidding history</h2>
      {list && (
        <div className="mt-3">
          <p className="text-sm text-ink-muted">
            From an item list sent to {list.storesSent} store{list.storesSent === 1 ? "" : "s"} on {when(list.createdAt)}
            {list.acceptedAt ? `, offer accepted ${when(list.acceptedAt)}` : ""}.{" "}
            <Link href={`/admin/bidding/lists/${list.id}`} className="font-semibold text-brand-700 underline dark:text-brand-300">
              Open the list
            </Link>
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
            {list.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 text-ink">
                  {o.storeName} <span className="text-ink-subtle">· {o.coveredCount} item{o.coveredCount === 1 ? "" : "s"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(o.total)}</span>
                  <Badge tone={o.accepted ? "success" : TONE[o.status] ?? "neutral"}>{o.accepted ? "Accepted" : human(o.status)}</Badge>
                </span>
              </li>
            ))}
            {list.offers.length === 0 && <li className="px-3 py-2 text-ink-subtle">No offers.</li>}
          </ul>
        </div>
      )}
      {rb && (
        <div className="mt-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{rb.trigger === "POST_PACK" ? "Rider bidding after packing" : "Rider bidding at checkout"}:</span>
            {rbState && (
              <Badge tone={rbState.tone} dot>
                {rbState.label}
              </Badge>
            )}
            <span className="text-xs text-ink-subtle">
              opened {when(rb.createdAt)} · re-opened {rb.reopenCount}×
              {rb.acceptedFee != null ? ` · fee ${formatCurrency(rb.acceptedFee)}` : ""}
            </span>
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm" data-testid="order-rider-bids">
            {rb.bids.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 text-ink">
                  {b.riderName}
                  {b.riderPhone ? <span className="text-ink-subtle"> · {b.riderPhone}</span> : null}
                  <span className="block text-xs text-ink-subtle">bid {when(b.createdAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(b.amount)}</span>
                  <Badge tone={b.won ? "success" : TONE[b.status] ?? "neutral"}>{b.won ? "Won" : human(b.status)}</Badge>
                </span>
              </li>
            ))}
            {rb.bids.length === 0 && <li className="px-3 py-2 text-ink-subtle">No rider bids.</li>}
          </ul>
        </div>
      )}
      {code?.required && (
        <p className="mt-4 text-sm text-ink-muted" data-testid="code-attempts">
          Delivery code: {code.attempts ?? 0} wrong {code.attempts === 1 ? "try" : "tries"}
          {locked ? ` · locked until ${new Date(code.lockedUntil!).toLocaleTimeString("en-PK")}` : " · not locked"}
        </p>
      )}
    </section>
  );
}
