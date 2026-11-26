"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { BiddingTabs } from "@/components/admin/BiddingTabs";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { formatQty, listStatusInfo } from "@/lib/lists/ui";
import { formatCurrency } from "@/lib/utils";

type Detail = {
  id: string;
  status: string;
  city: string;
  area: string | null;
  note: string | null;
  radiusKm: number;
  version: number;
  createdAt: string;
  expiresAt: string;
  round: number;
  roundEndsAt: string;
  cancelledAt: string | null;
  customer: { fullName: string; email: string | null; phone: string | null };
  lines: { id: string; name: string; quantity: number; unit: string; category: string | null; note: string | null }[];
  broadcasts: {
    storeId: string;
    storeName: string;
    storeArea: string | null;
    radiusKm: number;
    distanceKm: number | null;
    sentAt: string;
    seenAt: string | null;
    declinedAt: string | null;
    round: number;
  }[];
  bids: {
    id: string;
    storeName: string;
    status: string;
    accepted: boolean;
    itemsTotal: number;
    discount: number;
    total: number;
    coveredCount: number;
    prepMinutes: number | null;
    note: string | null;
    listVersion: number;
    round: number;
    outdated: boolean;
    createdAt: string;
    updatedAt: string;
    lines: { lineId: string; available: boolean; unitPrice: number | null }[];
  }[];
  order: { id: string; orderNumber: string; orderStatus: string; createdAt: string } | null;
  history: { at: string; action: string; by: string; store: string | null }[];
};

const BID_TONE: Record<string, BadgeTone> = {
  PENDING: "info",
  ACCEPTED: "success",
  NOT_SELECTED: "neutral",
  WITHDRAWN: "neutral",
  EXPIRED: "warning",
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-PK") : "—");
const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function AdminListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  async function cancelList() {
    if (!d) return;
    const r = await confirm({
      title: "Cancel this list?",
      message: "Stores can no longer send offers. Open offers are closed and the customer and the stores that bid are told.",
      confirmLabel: "Cancel list",
      cancelLabel: "Keep list",
      tone: "danger",
      reason: { label: "Reason (shown to the customer)", placeholder: "e.g. Duplicate list", required: true, minLength: 5, maxLength: 500 },
    });
    if (!r.confirmed) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/lists/${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", reason: r.reason }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.success) {
        setD(j.data);
        toast.success("List cancelled");
      } else toast.error(j.error || "Couldn't cancel the list");
    } catch {
      toast.error("Couldn't cancel the list");
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    fetch(`/api/admin/lists/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.success ? setD(j.data) : setError(j.error || "List not found")))
      .catch(() => setError("Couldn't load the list"));
  }, [id]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <BiddingTabs />
      <Link href="/admin/bidding/lists" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
        <ArrowLeft className="h-4 w-4" /> All lists
      </Link>
      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!d ? (
        !error && <div className="skeleton mt-4 h-64 rounded-2xl" />
      ) : (
        <div className="mt-3 space-y-5">
          <section className="rounded-2xl border border-line bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={listStatusInfo(d.status).tone} dot>
                {d.status === "BIDDING" ? "Bidding" : d.status === "ACCEPTED" ? "Offer accepted" : listStatusInfo(d.status).label}
              </Badge>
              <Badge tone="neutral">Round {d.round}</Badge>
              <span className="text-xs text-ink-subtle">Version {d.version}</span>
              {(d.status === "BIDDING" || d.status === "NO_STORES") && (
                <button
                  type="button"
                  onClick={cancelList}
                  disabled={cancelling}
                  data-testid="admin-cancel-list"
                  className="ml-auto min-h-[44px] rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {cancelling ? "Cancelling…" : "Cancel list"}
                </button>
              )}
            </div>
            <h1 className="mt-2 font-display text-2xl text-ink">List from {d.customer.fullName}</h1>
            <p className="mt-1 break-words text-sm text-ink-muted">
              {[d.area, d.city].filter(Boolean).join(", ")} · radius {d.radiusKm} km · sent {when(d.createdAt)} · {d.status === "BIDDING" ? `round ${d.round} ends` : "closed round"}{" "}
              {when(d.roundEndsAt ?? d.expiresAt)}
              {d.cancelledAt ? ` · cancelled ${when(d.cancelledAt)}` : ""}
            </p>
            {d.order && (
              <p className="mt-2 text-sm">
                Order:{" "}
                <Link href={`/admin/orders/${d.order.orderNumber}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                  {d.order.orderNumber}
                </Link>{" "}
                <span className="text-ink-subtle">({human(d.order.orderStatus)}, {when(d.order.createdAt)})</span>
              </p>
            )}
            {d.note && <p className="mt-2 break-words text-sm text-ink-muted">Note: {d.note}</p>}
          </section>

          <section className="rounded-2xl border border-line bg-card">
            <h2 className="border-b border-line px-5 py-3 text-sm font-bold text-ink">Items ({d.lines.length})</h2>
            <ul className="divide-y divide-line text-sm">
              {d.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                  <span className="min-w-0 break-words text-ink">{l.name}</span>
                  <span className="text-ink-muted">
                    {formatQty(l.quantity)} {l.unit}
                    {l.category ? ` · ${l.category}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-card" data-testid="broadcasts">
            <h2 className="border-b border-line px-5 py-3 text-sm font-bold text-ink">Sent to {d.broadcasts.length} stores</h2>
            <ul className="divide-y divide-line text-sm">
              {d.broadcasts.map((b) => (
                <li key={b.storeId} className="grid grid-cols-1 gap-1 px-5 py-2.5 md:grid-cols-4">
                  <span className="font-medium text-ink">{b.storeName}</span>
                  <span className="text-ink-muted">
                    {b.distanceKm != null ? `${b.distanceKm.toFixed(1)} km` : "same city"} · radius {b.radiusKm} km
                  </span>
                  <span className="text-ink-muted">
                    Sent {when(b.sentAt)} · round {b.round}
                  </span>
                  <span className="text-ink-muted">
                    {b.declinedAt ? `Can't supply (${when(b.declinedAt)})` : b.seenAt ? `Seen ${when(b.seenAt)}` : "Not opened yet"}
                  </span>
                </li>
              ))}
              {d.broadcasts.length === 0 && <li className="px-5 py-3 text-ink-subtle">No store got this list.</li>}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-card" data-testid="offers">
            <h2 className="border-b border-line px-5 py-3 text-sm font-bold text-ink">Offers ({d.bids.length})</h2>
            <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
              {d.bids.map((b) => (
                <article key={b.id} className="min-w-0 rounded-xl border border-line p-4" data-testid="admin-offer">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{b.storeName}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={BID_TONE[b.status] ?? "neutral"}>{human(b.status)}</Badge>
                      {b.outdated && <Badge tone="warning">Update needed</Badge>}
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatCurrency(b.total)} · {b.coveredCount} of {d.lines.length} items
                    {b.discount > 0 ? ` · discount ${formatCurrency(b.discount)}` : ""}
                    {b.prepMinutes != null ? ` · ${b.prepMinutes} min` : ""} · list v{b.listVersion} · round {b.round}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    First sent {when(b.createdAt)} · last change {when(b.updatedAt)}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {d.lines.map((l) => {
                      const x = b.lines.find((y) => y.lineId === l.id);
                      return (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate text-ink-muted">{l.name}</span>
                          <span className="shrink-0 tabular-nums text-ink">
                            {x?.available && x.unitPrice != null ? formatCurrency(x.unitPrice) : "Don't have"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {b.note && <p className="mt-2 break-words text-xs text-ink-muted">“{b.note}”</p>}
                </article>
              ))}
              {d.bids.length === 0 && <p className="text-sm text-ink-subtle">No offers.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card" data-testid="list-history">
            <h2 className="border-b border-line px-5 py-3 text-sm font-bold text-ink">History</h2>
            <ol className="divide-y divide-line text-sm">
              {d.history.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                  <span className="text-ink">
                    {human(h.action)}
                    {h.store ? ` · ${h.store}` : ""} <span className="text-ink-subtle">by {h.by}</span>
                  </span>
                  <span className="text-xs text-ink-subtle">{when(h.at)}</span>
                </li>
              ))}
              {d.history.length === 0 && <li className="px-5 py-3 text-ink-subtle">Nothing recorded.</li>}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
