"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ui/feedback";
import { Bike, Clock, Loader2, Users, XCircle } from "lucide-react";

type Bid = { id: string; riderId: string; riderName: string | null; amount: number; status: string };
type Req = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  customer: { name: string; phone: string } | null;
  acceptedRiderId: string | null;
  acceptedFee: number | null;
  summary: { itemCount?: number; distanceKm?: number; drop?: { city?: string | null; area?: string | null } } | null;
  bids: Bid[];
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800",
  ASSIGNED: "bg-emerald-100 text-emerald-800",
};

export default function AdminBiddingPage() {
  const [requests, setRequests] = useState<Req[] | null>(null);
  const [msg, setMsg] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/bidding", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (json?.success) setRequests(json.data.requests);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function cancel(id: string) {
    const { confirmed } = await confirm({
      title: "Cancel this delivery request?",
      message: "Its bids will be rejected and the request removed from riders.",
      confirmLabel: "Cancel request",
      tone: "danger",
    });
    if (!confirmed) return;
    setMsg("");
    const res = await fetch("/api/admin/bidding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CANCEL", requestId: id }),
    });
    const json = await res.json().catch(() => ({}));
    setMsg(json?.success ? "Request cancelled." : json?.error || "Could not cancel.");
    await load();
  }

  if (!requests) {
    return <div className="flex items-center justify-center py-20 text-ink-subtle"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bike className="h-6 w-6 text-ink" />
        <h1 className="font-display text-3xl text-ink">Rider Bidding</h1>
      </div>
      <p className="mt-1 text-sm text-ink-subtle">
        Live delivery auctions. You can cancel a stuck or abandoned request — its bids are rejected and the customer can request again.
      </p>

      {msg && <p className="mt-4 rounded-lg bg-app px-3 py-2 text-sm text-ink-muted">{msg}</p>}

      <div className="mt-6 space-y-3">
        {requests.length === 0 && <p className="text-sm text-ink-subtle">No live delivery requests right now.</p>}
        {requests.map((r) => {
          const drop = [r.summary?.drop?.area, r.summary?.drop?.city].filter(Boolean).join(", ");
          return (
            <div key={r.id} className="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-ink">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.status] || "bg-slate-100"}`}>
                      {r.expired ? "EXPIRED" : r.status}
                    </span>
                    {r.customer?.name || "Customer"} · {r.customer?.phone}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {r.summary?.itemCount ?? "—"} items · ~{r.summary?.distanceKm ?? "—"} km{drop ? ` · to ${drop}` : ""}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-subtle">
                    <Clock className="h-3 w-3" /> closes {new Date(r.expiresAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  onClick={() => void cancel(r.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Cancel request
                </button>
              </div>

              <div className="mt-3 rounded-xl bg-app p-3">
                <p className="flex items-center gap-1 text-xs font-semibold uppercase text-ink-subtle">
                  <Users className="h-3.5 w-3.5" /> {r.bids.length} bid{r.bids.length === 1 ? "" : "s"}
                </p>
                {r.bids.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-subtle">No bids yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {r.bids.map((b) => (
                      <li key={b.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink-muted">
                          {b.riderName || "Rider"}{" "}
                          {b.riderId === r.acceptedRiderId && <span className="text-[10px] font-bold text-emerald-600">· CHOSEN</span>}
                        </span>
                        <span className={`font-semibold ${b.status === "REJECTED" ? "text-ink-subtle line-through" : "text-ink"}`}>
                          {formatCurrency(b.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
