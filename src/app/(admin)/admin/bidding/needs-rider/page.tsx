"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BiddingTabs } from "@/components/admin/BiddingTabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Countdown } from "@/components/lists/ListBits";
import { postPackStateLabel } from "@/lib/lists/store-ui";
import { formatCurrency } from "@/lib/utils";

type Item = {
  requestId: string;
  status: string;
  needsRider: boolean;
  reopenCount: number;
  expiresAt: string;
  biddingOpen: boolean;
  pendingBids: number;
  lowestBid: number | null;
  since: string;
  storeName: string | null;
  pickup: string | null;
  drop: string | null;
  distanceKm: number | null;
  itemCount: number | null;
  order: { id: string; orderNumber: string; orderStatus: string; grandTotal: number; customerName: string } | null;
};
type Rider = { id: string; name: string; phone?: string };

export default function NeedsRiderPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<{ needsRider: Item[]; bidding: Item[] } | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/lists?view=needs-rider", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (d?.success) setData(d.data);
    else setData((x) => x ?? { needsRider: [], bidding: [] });
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    fetch("/api/admin?resource=riders&assignable=1")
      .then((r) => r.json())
      .then((d) => setRiders(d.success && Array.isArray(d.data?.items) ? d.data.items : []))
      .catch(() => setRiders([]));
    return () => window.clearInterval(t);
  }, [load]);

  async function assign(i: Item) {
    const riderId = pick[i.requestId];
    if (!i.order || !riderId) return;
    const rider = riders.find((r) => r.id === riderId);
    const c = await confirm({
      title: `Assign ${rider?.name || "this rider"} to ${i.order.orderNumber}?`,
      message: "Rider bidding on this order closes and the rider is told the pickup and drop-off.",
      confirmLabel: "Assign rider",
    });
    if (!c.confirmed) return;
    setBusy(i.requestId);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: i.order.id, action: "ASSIGN_RIDER", riderId }),
      });
      const d = await res.json();
      if (d.success) toast.success(`${rider?.name || "Rider"} assigned to ${i.order.orderNumber}`);
      else toast.error(d.error || "Couldn't assign the rider");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusy("");
      void load();
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <BiddingTabs needsRider={data?.needsRider.length} />
      <h1 className="font-display text-3xl text-ink">Needs rider</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Packed list orders where no rider bid, even after bidding was re-opened once. Assign a rider by hand.
      </p>

      {!data ? (
        <div className="skeleton mt-5 h-40 rounded-2xl" />
      ) : (
        <>
          <section className="mt-5 space-y-3" data-testid="needs-rider">
            {data.needsRider.length === 0 && (
              <p className="rounded-2xl border border-dashed border-line bg-card px-4 py-10 text-center text-sm text-ink-subtle">
                Nothing waiting. Every packed list order has riders bidding or a rider assigned.
              </p>
            )}
            {data.needsRider.map((i) => (
              <QueueCard key={i.requestId} i={i}>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Rider for ${i.order?.orderNumber}`}
                    value={pick[i.requestId] || ""}
                    onChange={(e) => setPick({ ...pick, [i.requestId]: e.target.value })}
                    disabled={riders.length === 0}
                    className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm sm:max-w-xs"
                  >
                    <option value="">{riders.length ? "Choose a rider…" : "No approved, active riders"}</option>
                    {riders.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button type="button" disabled={!pick[i.requestId] || busy === i.requestId} onClick={() => void assign(i)}>
                    {busy === i.requestId ? "Assigning…" : "Assign rider"}
                  </Button>
                </div>
              </QueueCard>
            ))}
          </section>

          {data.bidding.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-bold text-ink">Riders bidding now ({data.bidding.length})</h2>
              <div className="mt-3 space-y-3">
                {data.bidding.map((i) => (
                  <QueueCard key={i.requestId} i={i} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function QueueCard({ i, children }: { i: Item; children?: React.ReactNode }) {
  const st = postPackStateLabel(i);
  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-card" data-testid="queue-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
          {i.order && (
            <Link href={`/admin/orders/${i.order.orderNumber}`} className="inline-flex min-h-[44px] items-center font-semibold text-brand-700 hover:underline dark:text-brand-300">
              {i.order.orderNumber}
            </Link>
          )}
        </div>
        <span className="text-xs text-ink-subtle">
          {i.biddingOpen ? <Countdown until={i.expiresAt} /> : `since ${new Date(i.since).toLocaleTimeString("en-PK")}`}
        </span>
      </div>
      <p className="mt-1 break-words text-sm text-ink-muted">
        {i.storeName ? `${i.storeName} · ` : ""}
        {i.pickup || "Store"} → {i.drop || "Customer"}
        {i.distanceKm ? ` · ~${i.distanceKm} km` : ""}
        {i.itemCount != null ? ` · ${i.itemCount} items` : ""}
      </p>
      <p className="text-xs text-ink-subtle">
        {i.order ? `${i.order.customerName} · ${formatCurrency(i.order.grandTotal)} · ` : ""}
        re-opened {i.reopenCount} time{i.reopenCount === 1 ? "" : "s"}
        {i.pendingBids ? ` · ${i.pendingBids} bid${i.pendingBids === 1 ? "" : "s"}, lowest ${formatCurrency(i.lowestBid ?? 0)}` : ""}
      </p>
      {children}
    </article>
  );
}
