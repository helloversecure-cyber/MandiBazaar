"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { DownloadInvoiceButton } from "@/components/orders/DownloadInvoiceButton";
import { OrderTimeline, type JourneyStep } from "@/components/orders/OrderTimeline";
import { useConfirm } from "@/components/ui/feedback";
import { RiderBidsSection } from "@/components/lists/RiderBidsSection";
import { Star } from "lucide-react";

const CANCELABLE = new Set([
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
]);

type OrderItem = {
  productId: string | null;
  storeId?: string;
  storeName?: string;
  productName: string;
  quantity: number;
  unit: string;
  finalPrice: number;
};

type Rider = {
  name: string;
  phone: string | null;
  vehicleType?: string | null;
} | null;

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  createdAt: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  deliveryFeePaid: number;
  productAmountPaid: number;
  remainingAmount: number;
  refundableAmount?: number;
  paymentMethod: string;
  /** "Cash on delivery (products + delivery fee)" for full COD orders */
  paymentLabel?: string | null;
  fullCod?: boolean;
  cancelReason?: string | null;
  deliveryAddressSnapshot: Record<string, string>;
  items: OrderItem[];
  rider?: Rider;
  refunds?: { id: string; amount: number; status: string; reason: string }[];
  statusTimeline?: JourneyStep[];
  paymentProofs?: { id: string; status: string; reviewNotes?: string | null }[];
  /** Set when the order came from an accepted item list (W7): rider bidding after packing. */
  itemList?: { id: string } | null;
  /** W9: 4-digit code for the rider (item-list orders) */
  deliveryCode?: { required: boolean; code: string | null; used: boolean; lockedUntil: string | null } | null;
  /** W9: the customer's rating of the store on this order */
  storeReview?: { rating: number; comment: string | null; storeName: string | null } | null;
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [msg, setMsgRaw] = useState("");
  const [msgError, setMsgError] = useState(false);
  // Track success vs error explicitly so errors never render in the green banner.
  const setMsg = (text: string, error = false) => {
    setMsgRaw(text);
    setMsgError(error);
  };
  const [busy, setBusy] = useState(false);
  const confirmDialog = useConfirm();
  const [refundReason, setRefundReason] = useState("");
  const [showRefund, setShowRefund] = useState(false);
  const [storeRating, setStoreRating] = useState<{ rating: number; comment: string; storeId: string }>({
    rating: 0,
    comment: "",
    storeId: "",
  });
  const [reviews, setReviews] = useState<
    Record<string, { rating: number; comment: string; submitted?: boolean }>
  >({});

  const load = useCallback(() => {
    fetch(`/api/orders/${params.orderNumber}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setOrder(d.data);
      });
  }, [params.orderNumber]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitStoreRating(defaultStoreId: string | undefined) {
    if (!storeRating.rating) {
      setMsg("Please pick 1 to 5 stars for the store", true);
      return;
    }
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/store-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order!.id,
        rating: storeRating.rating,
        comment: storeRating.comment || undefined,
        storeId: storeRating.storeId || defaultStoreId || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setMsg(data.error || "Could not save your rating", true);
      return;
    }
    setMsg("Thanks for rating the store");
    load();
  }

  // Mark items already reviewed on THIS order so they show a "submitted" state
  // instead of a blank form that would 409 on re-submit.
  useEffect(() => {
    const orderId = order?.id;
    if (!orderId) return;
    let cancelled = false;
    fetch(`/api/reviews?mine=true&orderId=${encodeURIComponent(orderId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.success) return;
        const pids = (d.data as Array<{ productId: string; orderId: string }>)
          .filter((rv) => rv.orderId === orderId)
          .map((rv) => rv.productId);
        if (!pids.length) return;
        setReviews((prev) => {
          const next = { ...prev };
          for (const pid of pids) {
            next[pid] = {
              rating: next[pid]?.rating ?? 0,
              comment: next[pid]?.comment ?? "",
              submitted: true,
            };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [order?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("from") === "list") {
      setMsg("Order placed. The store is preparing it; you'll choose a delivery rider here once it's packed.");
    }
    const notice = qs.get("notice");
    if (notice === "payment_review") {
      setMsg(
        "Payment arrived after this order closed. A refund has been queued — MandiBazaar will process it."
      );
    }
  }, []);

  if (!order) {
    return <div className="py-16 text-center text-sm text-ink-subtle">Loading order…</div>;
  }

  const address = order.deliveryAddressSnapshot;
  const paidOnline = (order.deliveryFeePaid || 0) + (order.productAmountPaid || 0);
  const refundable = order.refundableAmount ?? 0;
  const isCancelled = order.orderStatus === "CANCELLED";
  const isDelivered = order.orderStatus === "DELIVERED";
  const isListOrder = !!order.itemList;
  // List orders: the delivery fee comes from the rider the customer chooses after packing.
  const feePending = isListOrder && !order.rider && (order.deliveryFee || 0) <= 0;
  // JazzCash-QR receipt state: a submitted receipt keeps the order PENDING_PAYMENT
  // until an admin verifies, so surface it instead of a generic "pay again" prompt.
  const awaitingPayment = order.orderStatus === "PENDING_PAYMENT";
  const proofList = order.paymentProofs || [];
  const proofPending = awaitingPayment && proofList.some((p) => p.status === "PENDING_REVIEW");
  const proofRejected =
    awaitingPayment && !proofPending && proofList[0]?.status === "REJECTED" ? proofList[0] : null;
  const canRequestRefund =
    refundable > 0 &&
    order.orderStatus !== "PENDING_PAYMENT" &&
    !(order.refunds || []).some((r) =>
      ["PENDING", "APPROVED", "PROCESSING"].includes(r.status)
    );

  async function patchAction(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, orderId: order!.id, ...extra }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setMsg(data.error || "Action failed", true);
      return false;
    }
    return true;
  }

  async function cancelOrder() {
    const { confirmed } = await confirmDialog({
      title: "Cancel this order?",
      message: "If you paid online, a refund will be started automatically.",
      confirmLabel: "Yes, cancel",
      cancelLabel: "Keep order",
      tone: "danger",
    });
    if (!confirmed) return;
    const ok = await patchAction("CANCEL", { reason: "Cancelled by customer" });
    if (ok) {
      setMsg(
        "Order cancelled. If you paid online, a refund is started automatically."
      );
      load();
    }
  }

  async function reorder() {
    const ok = await patchAction("REORDER");
    if (ok) router.push("/cart");
  }

  async function requestRefund(e: React.FormEvent) {
    e.preventDefault();
    const ok = await patchAction("REQUEST_REFUND", {
      reason: refundReason || "Customer refund request",
    });
    if (ok) {
      setMsg("Refund request submitted");
      setShowRefund(false);
      setRefundReason("");
    }
  }

  async function resumePayment() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RESUME_PAYMENT", orderId: order!.id }),
    });
    const data = await res.json();
    if (!data.success) {
      setBusy(false);
      setMsg(data.error || "Could not resume payment", true);
      return;
    }
    if (data.data.stripeCheckout?.clientSecret) {
      sessionStorage.setItem(
        "mb_stripe_pay",
        JSON.stringify({
          clientSecret: data.data.stripeCheckout.clientSecret,
          publishableKey: data.data.stripeCheckout.publishableKey,
          orderNumber: data.data.orderNumber,
          amountPkr: data.data.stripeCheckout.amountPkr || 0,
        })
      );
      window.location.assign(
        `/checkout/payment?order=${encodeURIComponent(data.data.orderNumber)}&orderId=${encodeURIComponent(order!.id)}&card=1`
      );
      return;
    }
    if (data.data.requiresJazzCashQr && data.data.jazzcashQr) {
      const q = data.data.jazzcashQr;
      window.location.assign(
        `/checkout/jazzcash-qr?order=${encodeURIComponent(q.orderNumber)}&orderId=${encodeURIComponent(q.orderId)}&amount=${encodeURIComponent(String(q.amountPkr))}`
      );
      return;
    }
    if (data.data.stripeCheckout?.url) {
      window.location.assign(data.data.stripeCheckout.url);
      return;
    }
    const form = data.data.paymentForm;
    if (!form?.isConfigured) {
      setBusy(false);
      setMsg(
        form
          ? "JazzCash isn't available right now. Please try again shortly or contact support."
          : data.error || "Could not resume payment — try again or contact support.",
        true
      );
      return;
    }
    const el = document.createElement("form");
    el.method = "POST";
    el.action = form.paymentUrl;
    Object.entries(form.fields as Record<string, string>).forEach(([k, v]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      el.appendChild(input);
    });
    document.body.appendChild(el);
    el.submit();
  }

  async function submitReview(productId: string) {
    const draft = reviews[productId];
    if (!draft?.rating) {
      setMsg("Please select a rating", true);
      return;
    }
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        orderId: order!.id,
        rating: draft.rating,
        comment: draft.comment || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setMsg(data.error || "Could not submit review", true);
      return;
    }
    setReviews((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], submitted: true },
    }));
    setMsg("Review submitted for moderation");
  }

  return (
    <div>
      <PageHeader
        title={order.orderNumber}
        subtitle={`${order.orderStatus.replace(/_/g, " ")} · ${new Date(order.createdAt).toLocaleString()}`}
        badge="Order"
        action={
          <Button href="/account/orders" variant="outline" size="sm">
            Back to orders
          </Button>
        }
      />

      {msg && (
        <p
          className={cn(
            "mb-4 rounded-xl px-4 py-2.5 text-sm",
            msgError
              ? "bg-red-50 text-red-600"
              : "bg-emerald-50 text-emerald-700"
          )}
        >
          {msg}
        </p>
      )}

      {/* Delivery journey — real timestamps from the order's status journal (not live GPS) */}
      {order.statusTimeline && order.statusTimeline.length > 0 && (
        <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card">
          <h2 className="mb-4 text-sm font-bold text-ink">Order progress</h2>
          <OrderTimeline steps={order.statusTimeline} />
          {proofPending ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              Receipt received — MandiBazaar is verifying your payment. Your order
              is confirmed once it’s checked. No need to pay again.
            </p>
          ) : proofRejected ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-300">
              Your receipt was declined
              {proofRejected.reviewNotes ? ` — ${proofRejected.reviewNotes}` : ""}.
              Please upload a new JazzCash receipt using “Complete payment”.
            </p>
          ) : order.orderStatus === "PENDING_PAYMENT" ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              Waiting for payment confirmation before the order is confirmed.
            </p>
          ) : null}
        </div>
      )}

      {isCancelled && (
        <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          Order cancelled
          {order.cancelReason ? ` — ${order.cancelReason}` : ""}
        </div>
      )}

      {isListOrder && !isCancelled && <RiderBidsSection orderNumber={order.orderNumber} onAssigned={load} />}

      {order.rider && !isListOrder && (
        <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card text-sm">
          <h2 className="font-bold text-ink">Assigned rider</h2>
          <p className="mt-2 text-ink-muted">
            {order.rider.name}
            {order.rider.phone ? ` · ${order.rider.phone}` : ""}
            {order.rider.vehicleType ? ` · ${order.rider.vehicleType}` : ""}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            Contact details only — live tracking is not available.
          </p>
        </div>
      )}

      {order.deliveryCode?.code && (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-card p-5 shadow-card text-sm">
          <h2 className="font-bold text-ink">Delivery code</h2>
          <p className="mt-2 font-mono text-3xl font-bold tracking-[0.4em] text-ink">
            {order.deliveryCode.code}
          </p>
          <p className="mt-2 text-xs text-ink-subtle">
            Give this code to the rider only when you have your order in hand. MandiBazaar staff
            will never ask for it.
          </p>
          {order.deliveryCode.lockedUntil && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              Too many wrong codes were entered. The code is paused until{" "}
              {new Date(order.deliveryCode.lockedUntil).toLocaleTimeString()}. Call MandiBazaar
              support if you need help.
            </p>
          )}
        </div>
      )}

      {order.orderStatus === "DELIVERED" &&
        (() => {
          const stores = Array.from(
            new Map(
              order.items.filter((i) => i.storeId).map((i) => [i.storeId!, i.storeName || "Store"])
            ).entries()
          );
          if (order.storeReview) {
            return (
              <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card text-sm">
                <h2 className="font-bold text-ink">Your store rating</h2>
                <p className="mt-2 text-ink-muted">
                  {order.storeReview.storeName ? `${order.storeReview.storeName} · ` : ""}
                  {order.storeReview.rating} / 5
                  {order.storeReview.comment ? ` — ${order.storeReview.comment}` : ""}
                </p>
              </div>
            );
          }
          if (!stores.length) return null;
          return (
            <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card text-sm">
              <h2 className="font-bold text-ink">Rate the store</h2>
              {stores.length > 1 && (
                <select
                  className="mt-3 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm"
                  value={storeRating.storeId}
                  onChange={(e) => setStoreRating((p) => ({ ...p, storeId: e.target.value }))}
                >
                  <option value="">Choose the store</option>
                  {stores.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
              <div className="mt-3 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStoreRating((p) => ({ ...p, rating: n }))}
                    className="p-0.5"
                    aria-label={`${n} stars`}
                  >
                    <Star
                      className={cn(
                        "h-6 w-6",
                        n <= storeRating.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"
                      )}
                    />
                  </button>
                ))}
              </div>
              <textarea
                className="mt-3 w-full rounded-xl border border-line bg-app px-4 py-3 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
                placeholder="How was the store? (optional)"
                maxLength={1000}
                value={storeRating.comment}
                onChange={(e) => setStoreRating((p) => ({ ...p, comment: e.target.value }))}
              />
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={busy || (stores.length > 1 && !storeRating.storeId)}
                onClick={() => submitStoreRating(stores.length === 1 ? stores[0][0] : undefined)}
              >
                Submit store rating
              </Button>
            </div>
          );
        })()}

      <div className="mb-6 flex flex-wrap gap-2">
        <DownloadInvoiceButton
          orderNumber={order.orderNumber}
          variant="outline"
          size="sm"
        />
        {awaitingPayment && !proofPending && (
          <Button type="button" size="sm" disabled={busy} onClick={resumePayment}>
            {proofRejected ? "Upload a new receipt" : "Complete payment"}
          </Button>
        )}
        {CANCELABLE.has(order.orderStatus) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={cancelOrder}
            className="border-deal-200 text-deal-600 hover:bg-red-50"
          >
            Cancel order
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={reorder}>
          Reorder
        </Button>
        {canRequestRefund && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setShowRefund((v) => !v)}
          >
            Request refund
          </Button>
        )}
      </div>

      {(order.refunds || []).length > 0 && (
        <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card text-sm">
          <h2 className="font-bold text-ink">Refunds</h2>
          <ul className="mt-2 space-y-2">
            {(order.refunds || []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 text-ink-muted">
                <span>
                  {formatCurrency(r.amount)} · {r.status}
                </span>
                <span className="text-xs text-ink-subtle">{r.reason}</span>
              </li>
            ))}
          </ul>
          {refundable > 0 && (
            <p className="mt-2 text-xs text-ink-subtle">
              Still refundable: {formatCurrency(refundable)}
            </p>
          )}
        </div>
      )}

      {showRefund && canRequestRefund && (
        <form
          onSubmit={requestRefund}
          className="mb-6 space-y-3 rounded-2xl border border-line bg-card p-5 shadow-card"
        >
          <h2 className="font-bold text-ink">Request refund</h2>
          <p className="text-xs text-ink-subtle">
            Refundable online amount: {formatCurrency(refundable)}
            {paidOnline > 0 ? ` (ledger paid ${formatCurrency(paidOnline)})` : ""}
          </p>
          <label className="mb-1 block text-sm font-medium text-ink">Reason for refund</label>
          <textarea
            className="w-full rounded-xl border border-line bg-app px-4 py-3 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
            placeholder="Tell us why you're requesting a refund"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            rows={3}
            maxLength={500}
            required
          />
          <Button type="submit" size="sm" disabled={busy}>
            Submit refund request
          </Button>
        </form>
      )}

      <div className="rounded-2xl border border-line bg-card p-5 shadow-card space-y-3 text-sm">
        <Row label="Product subtotal" value={formatCurrency(order.subtotal)} />
        <Row label="Discount" value={`-${formatCurrency(order.discount)}`} />
        <Row label="Delivery fee" value={feePending ? "Set by rider bidding" : formatCurrency(order.deliveryFee)} />
        <Row
          label={
            order.fullCod && (order.deliveryFeePaid || 0) <= 0
              ? "Delivery fee (pay in cash on delivery)"
              : order.fullCod
                ? "Delivery fee paid (cash)"
                : "Delivery fee paid"
          }
          value={formatCurrency(order.deliveryFeePaid)}
        />
        <Row label="Product amount paid" value={formatCurrency(order.productAmountPaid)} />
        <Row
          label={order.fullCod ? "Cash to pay rider (products + delivery)" : "Remaining"}
          value={formatCurrency(order.remainingAmount)}
        />
        <Row
          label="Payment"
          value={
            order.paymentLabel ||
            (order.paymentMethod === "MIXED"
              ? "Online + cash on delivery"
              : order.paymentMethod === "JAZZCASH_QR"
                ? "JazzCash QR"
                : order.paymentMethod === "COD"
                  ? "Cash on delivery"
                  : String(order.paymentMethod || "").replace(/_/g, " "))
          }
        />
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-card">
        <h2 className="font-bold text-ink">Items</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span>
                {i.productName} × {i.quantity} ({i.unit})
              </span>
              <span className="shrink-0 font-medium">{formatCurrency(i.finalPrice)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-card text-sm">
        <h2 className="font-bold text-ink">Delivery address</h2>
        <p className="mt-2 text-ink-muted">
          {address?.fullName}, {address?.phone}
          <br />
          {address?.houseBuilding}, {address?.area}, {address?.city}, {address?.province}
        </p>
      </div>

      {isDelivered && (
        <div className="mt-6 space-y-4">
          <h2 className="font-bold text-ink">Leave a review</h2>
          {order.items
            .filter((i) => i.productId)
            .map((item) => {
              const pid = item.productId!;
              const draft = reviews[pid] || { rating: 0, comment: "" };
              if (draft.submitted) {
                return (
                  <div
                    key={pid}
                    className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700"
                  >
                    Review submitted for {item.productName}
                  </div>
                );
              }
              return (
                <div
                  key={pid}
                  className="rounded-2xl border border-line bg-card p-5 shadow-card"
                >
                  <p className="font-semibold text-ink">{item.productName}</p>
                  <div className="mt-3 flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() =>
                          setReviews((prev) => ({
                            ...prev,
                            [pid]: { ...draft, rating: n },
                          }))
                        }
                        className="p-0.5"
                        aria-label={`${n} stars`}
                      >
                        <Star
                          className={cn(
                            "h-6 w-6",
                            n <= draft.rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-slate-300"
                          )}
                        />
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="mt-3 w-full rounded-xl border border-line bg-app px-4 py-3 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
                    placeholder="Share your experience (optional)"
                    maxLength={1000}
                    value={draft.comment}
                    onChange={(e) =>
                      setReviews((prev) => ({
                        ...prev,
                        [pid]: { ...draft, comment: e.target.value },
                      }))
                    }
                    rows={3}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    disabled={busy || !draft.rating}
                    onClick={() => submitReview(pid)}
                  >
                    Submit review
                  </Button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-subtle">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
