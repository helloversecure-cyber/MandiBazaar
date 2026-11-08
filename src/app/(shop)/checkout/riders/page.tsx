"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bike, Clock, Loader2, Star, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { PageHeader } from "@/components/layout/PageHeader";

type Address = { id: string; label?: string; city?: string };
type Bid = {
  id: string;
  amount: number;
  status: string;
  rider: { id: string; name: string; vehicleType: string; completedDeliveries: number };
};
type Req = {
  id: string;
  status: string;
  expiresAt: string;
  acceptedFee: number | null;
  acceptedRiderId: string | null;
  bids: Bid[];
};

export default function ChooseRiderPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string>("");
  const [req, setReq] = useState<Req | null>(null);
  const [phase, setPhase] = useState<"loading" | "need-address" | "waiting" | "accepted" | "none">("loading");
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/checkout/delivery-request", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const r: Req | null = data?.data?.request ?? null;
      setReq(r);
      if (r?.status === "ASSIGNED" || r?.acceptedFee != null) setPhase("accepted");
      else if (r?.status === "OPEN") setPhase("waiting");
    } catch {
      /* keep last state */
    }
  }, []);

  const openRequest = useCallback(
    async (addr: string) => {
      setError("");
      try {
        const res = await fetch("/api/checkout/delivery-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addressId: addr }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data?.success) {
          setError(data?.error || "Couldn't request riders. Please try again.");
          return;
        }
        setPhase("waiting");
        void poll();
      } catch {
        setError("Network error. Please try again.");
      }
    },
    [poll]
  );

  // Load addresses + any existing request on mount.
  useEffect(() => {
    (async () => {
      try {
        const [aRes, rRes] = await Promise.all([
          fetch("/api/addresses", { cache: "no-store" }),
          fetch("/api/checkout/delivery-request", { cache: "no-store" }),
        ]);
        const aData = await aRes.json().catch(() => ({}));
        const rData = await rRes.json().catch(() => ({}));
        const list: Address[] = aData?.data || [];
        setAddresses(list);
        const existing: Req | null = rData?.data?.request ?? null;
        if (existing) {
          setReq(existing);
          setPhase(existing.status === "ASSIGNED" || existing.acceptedFee != null ? "accepted" : "waiting");
          return;
        }
        if (list.length === 0) {
          setPhase("need-address");
          return;
        }
        setAddressId(list[0].id);
        await openRequest(list[0].id);
      } catch {
        setPhase("none");
        setError("Something went wrong. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while waiting for bids.
  useEffect(() => {
    if (phase !== "waiting") return;
    timer.current = setInterval(() => void poll(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [phase, poll]);

  async function accept(bidId: string) {
    setAccepting(bidId);
    setError("");
    try {
      const res = await fetch("/api/checkout/delivery-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", bidId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) {
        setError(data?.error || "Couldn't accept that bid. Please choose another.");
        void poll();
        return;
      }
      setPhase("accepted");
      void poll();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setAccepting(null);
    }
  }

  async function retry() {
    if (!addressId && addresses[0]) setAddressId(addresses[0].id);
    const addr = addressId || addresses[0]?.id;
    if (addr) await openRequest(addr);
  }

  // Cancel the auction and fall back to standard (km-based) delivery at checkout.
  async function continueWithStandard() {
    try {
      if (req?.id) {
        await fetch("/api/checkout/delivery-request", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", requestId: req.id }),
        });
      }
    } catch {
      /* best-effort */
    }
    window.location.assign("/checkout");
  }

  const bids = (req?.bids || []).filter((b) => b.status === "PENDING");

  return (
    <ShopContainer width="md" className="py-6">
      <PageHeader title="Choose your rider" subtitle="Riders bid for your delivery — pick the one you want." badge="Checkout" />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {phase === "loading" && (
        <div className="flex items-center justify-center py-16 text-ink-subtle">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Setting up…
        </div>
      )}

      {phase === "need-address" && (
        <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
          <p className="text-ink-muted">Please add a delivery address first so riders can bid.</p>
          <Button href="/account/addresses" className="mt-5">Add an address</Button>
        </div>
      )}

      {phase === "accepted" && req && (
        <div className="rounded-2xl border border-emerald-200 bg-card p-8 text-center shadow-card">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h2 className="mt-3 text-xl font-extrabold text-ink">Rider selected</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Your delivery fee is{" "}
            <strong>Rs {(req.acceptedFee ?? 0).toLocaleString("en-PK")}</strong>. Continue to payment to place
            your order.
          </p>
          <Button href="/checkout" className="mt-6 gap-2">
            Continue to payment <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {phase === "waiting" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Clock className="h-4 w-4" />
            Waiting for riders to bid… new offers appear here automatically.
            {req?.expiresAt && (
              <span className="ml-auto text-xs">
                closes {new Date(req.expiresAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {bids.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-card py-14 text-center text-ink-subtle">
              <Bike className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              No bids yet — waiting for online riders. If none bid, you can continue at the
              standard delivery fee and a rider will be assigned once available.
              <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
                <button onClick={() => void retry()} className="text-sm font-semibold text-brand-600 underline">
                  Retry request
                </button>
                <button onClick={() => void continueWithStandard()} className="text-sm font-semibold text-ink-muted underline">
                  Continue with standard delivery
                </button>
              </div>
            </div>
          ) : (
            bids.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    <Bike className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold text-ink">{b.rider.name}</p>
                    <p className="flex items-center gap-1 text-xs text-ink-subtle">
                      <Star className="h-3 w-3 text-amber-400" /> {b.rider.completedDeliveries} deliveries ·{" "}
                      {b.rider.vehicleType}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold text-ink">Rs {b.amount.toLocaleString("en-PK")}</p>
                  <Button size="sm" disabled={accepting === b.id} onClick={() => void accept(b.id)} className="mt-1">
                    {accepting === b.id ? "…" : "Choose"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-ink-subtle">
        <Link href="/cart" className="hover:underline">
          ← Back to cart
        </Link>
      </p>
    </ShopContainer>
  );
}
