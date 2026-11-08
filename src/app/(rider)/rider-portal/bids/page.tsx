"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bike, MapPin, Package, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Summary = {
  itemCount?: number;
  storeCount?: number;
  distanceKm?: number;
  pickup?: string[];
  drop?: { city: string | null; area: string | null };
};

type Req = {
  id: string;
  expiresAt: string;
  summary: Summary | null;
  myBid: { id: string; amount: number; status: string } | null;
};

const INELIGIBLE_MESSAGE: Record<string, string> = {
  NOT_APPROVED: "Your rider account is still under review. You'll be able to bid once MandiBazaar approves you.",
  SUSPENDED: "Your rider account is currently suspended. Please contact MandiBazaar support.",
  OFFLINE: "You're offline. Go online from your dashboard to see delivery requests and bid.",
  BUSY: "You're on an active delivery. Finish it to start bidding on new requests.",
  COD_OVERDUE: "You have overdue COD cash to remit. Settle it from Cash → MandiBazaar to take new deliveries.",
};

export default function RiderBidsPage() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rider/bids", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setRequests(data.data.requests || []);
        setIneligibleReason(data.data.eligible === false ? data.data.reason ?? "OFFLINE" : null);
      }
    } catch {
      /* keep last list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), 8000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function bid(reqId: string) {
    const amount = Number(amounts[reqId]);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg((m) => ({ ...m, [reqId]: "Enter a valid fee." }));
      return;
    }
    setBusy(reqId);
    setMsg((m) => ({ ...m, [reqId]: "" }));
    try {
      const res = await fetch("/api/rider/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: reqId, amount }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg((m) => ({ ...m, [reqId]: data?.success ? "Bid submitted." : data?.error || "Couldn't submit bid." }));
      if (data?.success) void load();
    } catch {
      setMsg((m) => ({ ...m, [reqId]: "Network error. Please try again." }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Delivery requests</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Customers choose a rider by their bid. Offer a fair delivery fee — if the customer picks you,
          the job and the fee are yours.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-subtle">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading requests…
        </div>
      ) : ineligibleReason ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 py-14 px-6 text-center text-amber-900">
          <Bike className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          {INELIGIBLE_MESSAGE[ineligibleReason] ?? INELIGIBLE_MESSAGE.OFFLINE}
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card py-16 text-center text-ink-subtle">
          <Bike className="mx-auto mb-3 h-8 w-8 text-ink-subtle" />
          No open delivery requests right now. New ones appear here automatically.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const s = r.summary || {};
            const dropLabel = [s.drop?.area, s.drop?.city].filter(Boolean).join(", ") || "Customer location";
            const pickupLabel = (s.pickup || []).join(", ") || "Store";
            return (
              <div key={r.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Info icon={<MapPin className="h-4 w-4" />} label="Pickup" value={pickupLabel} />
                  <Info icon={<MapPin className="h-4 w-4" />} label="Drop" value={dropLabel} />
                  <Info
                    icon={<Package className="h-4 w-4" />}
                    label="Items / distance"
                    value={`${s.itemCount ?? "—"} items · ~${s.distanceKm ?? "—"} km`}
                  />
                </div>

                {r.myBid ? (
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 dark:bg-brand-500/10 px-4 py-3 text-sm">
                    <span className="font-medium text-ink">
                      Your bid: Rs {r.myBid.amount.toLocaleString("en-PK")}
                    </span>
                    <span className="text-xs text-ink-subtle">You can update it below until the customer picks.</span>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-xl border border-line bg-card px-3">
                    <span className="text-sm text-ink-subtle">Rs</span>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      placeholder="Your delivery fee"
                      value={amounts[r.id] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))}
                      className="w-36 bg-transparent px-2 py-2.5 text-sm outline-none"
                    />
                  </div>
                  <Button size="sm" disabled={busy === r.id} onClick={() => void bid(r.id)}>
                    {busy === r.id ? "Sending…" : r.myBid ? "Update bid" : "Submit bid"}
                  </Button>
                  <span className="ml-auto flex items-center gap-1 text-xs text-ink-subtle">
                    <Clock className="h-3.5 w-3.5" />
                    closes {new Date(r.expiresAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {msg[r.id] && <p className="mt-2 text-xs text-ink-muted">{msg[r.id]}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-brand-50 dark:bg-brand-500/10 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {icon} {label}
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}
