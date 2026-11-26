"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bike, CheckCircle2, Clock, LocateFixed, Loader2, MapPin, Navigation, Package, Store } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { Countdown } from "@/components/lists/ListBits";
import { riderBidErrorMessage, validateRiderFee } from "@/lib/lists/store-ui";
import { cn, formatCurrency } from "@/lib/utils";

type Summary = {
  itemCount?: number;
  storeCount?: number;
  distanceKm?: number;
  pickup?: string[];
  drop?: { city: string | null; area: string | null };
  storeName?: string;
};

type Req = {
  id: string;
  trigger: "CHECKOUT" | "POST_PACK";
  expiresAt: string;
  summary: Summary | null;
  /** POST_PACK: km from the rider's last position to the store (null = matched by city). */
  pickupDistanceKm?: number | null;
  /** POST_PACK: new bids still taken (a rider who bid may change it until the customer chooses). */
  biddingOpen?: boolean;
  myBid: { id: string; amount: number; status: string } | null;
};

type Won = { id: string; orderNumber: string; orderStatus: string; deliveryFee?: number };

const INELIGIBLE: Record<string, { text: string; href?: string; cta?: string }> = {
  NOT_APPROVED: { text: "Your rider account is still under review. You'll be able to bid once MandiBazaar approves you." },
  SUSPENDED: { text: "Your rider account is suspended. Please contact MandiBazaar support." },
  OFFLINE: { text: "You're offline. Go online from your dashboard to see delivery requests and bid.", href: "/rider-portal", cta: "Go to dashboard" },
  BUSY: { text: "You're on a delivery. Finish it to bid on new requests.", href: "/rider-portal/deliveries", cta: "Open my deliveries" },
  COD_OVERDUE: {
    text: "You have overdue cash to hand over to MandiBazaar. Settle it to take new deliveries.",
    href: "/rider-portal/remittances",
    cta: "Settle cash",
  },
};

const POLL_MS = 8000;

export default function RiderBidsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<Req[]>([]);
  const [ineligible, setIneligible] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [won, setWon] = useState<Won[]>([]);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locState, setLocState] = useState<"idle" | "asking" | "denied" | "on">("idle");
  const locRef = useRef(loc);
  locRef.current = loc;

  const load = useCallback(async () => {
    try {
      const l = locRef.current;
      const qs = l ? `?lat=${l.lat.toFixed(6)}&lng=${l.lng.toFixed(6)}` : "";
      const [res, del] = await Promise.all([
        fetch(`/api/rider/bids${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/rider?resource=deliveries&status=ASSIGNED_TO_RIDER&limit=5", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (res?.success) {
        setRequests(res.data.requests || []);
        setIneligible(res.data.eligible === false ? res.data.reason ?? "OFFLINE" : null);
      }
      if (del?.success) setWon(del.data.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Use the rider's position when the browser already allows it (no prompt on open).
  useEffect(() => {
    let alive = true;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    perms
      ?.query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (alive && p.state === "granted") askLocation();
        if (alive && p.state === "denied") setLocState("denied");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  function askLocation() {
    if (!("geolocation" in navigator)) {
      setLocState("denied");
      return;
    }
    setLocState("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        locRef.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        setLocState("on");
        void load();
      },
      () => setLocState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 }
    );
  }

  async function bid(r: Req) {
    const v = validateRiderFee(amounts[r.id] ?? "");
    if (v.error) {
      setErrors((e) => ({ ...e, [r.id]: v.error! }));
      return;
    }
    setBusy(r.id);
    setErrors((e) => ({ ...e, [r.id]: "" }));
    try {
      const res = await fetch("/api/rider/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, amount: v.amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        toast.success(r.myBid ? `Bid changed to ${formatCurrency(v.amount!)}` : `Bid of ${formatCurrency(v.amount!)} sent`);
        setAmounts((a) => ({ ...a, [r.id]: "" }));
      } else {
        const m = riderBidErrorMessage({ status: res.status, code: data?.code, error: data?.error });
        setErrors((e) => ({ ...e, [r.id]: m.message }));
      }
    } catch {
      setErrors((e) => ({ ...e, [r.id]: riderBidErrorMessage(null).message }));
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function withdraw(r: Req) {
    const c = await confirm({
      title: "Withdraw your bid?",
      message: "The customer will no longer see it.",
      confirmLabel: "Withdraw bid",
      tone: "danger",
    });
    if (!c.confirmed) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/rider/bids?requestId=${encodeURIComponent(r.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (data?.success) toast.success("Bid withdrawn");
      else setErrors((e) => ({ ...e, [r.id]: riderBidErrorMessage({ status: res.status, code: data?.code, error: data?.error }).message }));
    } finally {
      setBusy(null);
      void load();
    }
  }

  const info = ineligible ? INELIGIBLE[ineligible] ?? INELIGIBLE.OFFLINE : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-ink">Delivery requests</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Offer a fair delivery fee. If the customer picks you, the job and the fee are yours. You see the pickup and drop
          area only; the full address shows once you win.
        </p>
      </div>

      {won.length > 0 && (
        <section
          data-testid="won-jobs"
          className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5" /> You won {won.length === 1 ? "a delivery" : `${won.length} deliveries`}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-emerald-900 dark:text-emerald-200">
            {won.map((w) => (
              <li key={w.id}>
                Order {w.orderNumber}: pick it up from the store, then start the delivery.
              </li>
            ))}
          </ul>
          <Link
            href="/rider-portal/deliveries"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Open my deliveries
          </Link>
        </section>
      )}

      {!ineligible && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-ink-muted">
            <LocateFixed className="h-4 w-4" />
            {locState === "on"
              ? "Using your current location to show nearby pickups."
              : locState === "denied"
                ? "Location is off. You see requests in your city only."
                : "Share your location to see after-packing requests near you."}
          </span>
          {locState !== "on" && locState !== "denied" && (
            <Button type="button" variant="outline" size="sm" className="min-h-[44px]" disabled={locState === "asking"} onClick={askLocation}>
              {locState === "asking" ? "Locating…" : "Use my location"}
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-subtle">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading requests…
        </div>
      ) : info ? (
        <div role="status" data-testid="ineligible" className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-12 text-center text-amber-900">
          <Bike className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <p>{info.text}</p>
          {info.href && (
            <Link
              href={info.href}
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700"
            >
              {info.cta}
            </Link>
          )}
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card py-16 text-center text-ink-subtle">
          <Bike className="mx-auto mb-3 h-8 w-8 text-ink-subtle" />
          No open delivery requests right now. New ones appear here automatically.
        </div>
      ) : (
        <div className="space-y-4" data-testid="rider-requests">
          {requests.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              amount={amounts[r.id] ?? ""}
              error={errors[r.id]}
              busy={busy === r.id}
              onAmount={(v) => setAmounts((a) => ({ ...a, [r.id]: v }))}
              onBid={() => void bid(r)}
              onWithdraw={() => void withdraw(r)}
              onEnd={() => void load()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  r,
  amount,
  error,
  busy,
  onAmount,
  onBid,
  onWithdraw,
  onEnd,
}: {
  r: Req;
  amount: string;
  error?: string;
  busy: boolean;
  onAmount: (v: string) => void;
  onBid: () => void;
  onWithdraw: () => void;
  onEnd: () => void;
}) {
  const s = r.summary || {};
  const postPack = r.trigger === "POST_PACK";
  const pending = r.myBid?.status === "PENDING";
  const closedForNew = postPack && r.biddingOpen === false;
  const drop = [s.drop?.area, s.drop?.city].filter(Boolean).join(", ") || "Customer's area";
  const pickup = (s.pickup || []).join(", ") || "Store";
  return (
    <article data-testid="rider-request" data-request-id={r.id} className="rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={postPack ? "brand" : "info"}>{postPack ? "Packed order · ready for pickup" : "Before checkout"}</Badge>
        <span className={cn("flex items-center gap-1 text-xs font-medium", closedForNew ? "text-amber-700" : "text-ink-muted")}>
          <Clock className="h-3.5 w-3.5" />
          {closedForNew ? "Bidding closed · customer is choosing" : <Countdown until={r.expiresAt} onEnd={onEnd} />}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Info icon={<Store className="h-4 w-4" />} label="Pickup" value={s.storeName ? `${s.storeName} · ${pickup}` : pickup} />
        <Info icon={<MapPin className="h-4 w-4" />} label="Drop" value={drop} />
        <Info
          icon={<Navigation className="h-4 w-4" />}
          label="Trip"
          value={`${s.distanceKm ? `~${s.distanceKm} km store → customer` : "Distance not known"}${
            postPack && r.pickupDistanceKm != null ? ` · store is ${r.pickupDistanceKm.toFixed(1)} km from you` : ""
          }`}
        />
        <Info icon={<Package className="h-4 w-4" />} label="Items" value={`${s.itemCount ?? "—"} item${s.itemCount === 1 ? "" : "s"}`} />
      </div>

      {pending && (
        <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink dark:bg-brand-500/10" data-testid="my-bid">
          Your bid: <strong>{formatCurrency(r.myBid!.amount)}</strong>
          <span className="text-ink-subtle"> · you can change or withdraw it until the customer chooses.</span>
        </p>
      )}

      {closedForNew && !pending ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-h-[44px] items-center rounded-xl border border-line bg-card px-3 focus-within:border-brand-400">
            <span className="text-sm text-ink-subtle">Rs</span>
            <input
              type="number"
              min={1}
              max={10000}
              inputMode="numeric"
              aria-label="Your delivery fee in rupees"
              placeholder={pending ? "New fee" : "Your delivery fee"}
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              className="min-h-[44px] w-32 bg-transparent px-2 py-0 text-sm text-ink outline-none"
            />
          </label>
          <Button type="button" className="min-h-[44px]" disabled={busy} onClick={onBid}>
            {busy ? "Sending…" : pending ? "Change bid" : "Place bid"}
          </Button>
          {pending && postPack && (
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={onWithdraw}>
              Withdraw
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </article>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-brand-50 px-3 py-2.5 dark:bg-brand-500/10">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {icon} {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-ink">{value}</p>
    </div>
  );
}
