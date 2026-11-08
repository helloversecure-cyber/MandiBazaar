"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { ORDER_STATUS_LABELS } from "@/lib/orders/state-machine";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { isUsableImageUrl } from "@/lib/orders/proof-review";
import type { OrderStatus } from "@prisma/client";

type Item = {
  id: string;
  storeId: string;
  storeName: string;
  productName: string;
  variantName: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  imageUrl: string | null;
};

type Detail = {
  id: string;
  orderNumber: string;
  createdAt: string;
  orderStatus: OrderStatus;
  cancelReason: string | null;
  cancelledAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  couponCode: string | null;
  deliveryFee: number;
  deliveryDistanceKm: string | null;
  grandTotal: number;
  deliveryFeePaid: number;
  productAmountPaid: number;
  remainingAmount: number;
  paymentMethod: string;
  deliveryFeePaymentStatus: string;
  productPaymentStatus: string;
  /** Full cash on delivery (products + delivery fee in cash) */
  fullCod?: boolean;
  paymentLabel?: string | null;
  deliveryFeePaymentLabel?: string;
  cashDue?: { products: number; delivery: number; total: number };
  riderId: string | null;
  rider: { id: string; name: string; phone: string; vehicleType: string } | null;
  customer: { fullName: string; phone: string | null; email: string | null } | null;
  deliveryAddressSnapshot: Record<string, unknown>;
  items: Item[];
  payments: {
    id: string;
    type: string;
    method: string;
    amount: number;
    status: string;
    reference: string | null;
    paidAt: string | null;
    createdAt: string;
  }[];
  refunds: { id: string; amount: number; status: string; reason: string; createdAt: string }[];
  cashCollection: { amountCollected: number; collectedAt: string } | null;
  admin: {
    allowedNextStatuses: { status: OrderStatus; blockedReason: string | null; needsReason: boolean }[];
    canAssignRider: boolean;
    customerPhone: string | null;
    customerPhoneSource: string | null;
    accountPhoneInvalid: boolean;
    waitingFlag: string | null;
    fulfillmentMismatch: boolean;
    fulfillments: { id: string; storeId: string; storeName: string; storePhone: string | null; status: OrderStatus; subtotal: number }[];
    paymentProofs: {
      id: string;
      imageUrl: string;
      status: string;
      notes: string | null;
      reviewNotes: string | null;
      createdAt: string;
      uploadedBy: string | null;
      uploadedByRole: string | null;
      reviewedBy: string | null;
    }[];
    remittance: { amount: number; status: string; rider: { name: string; phone: string } | null } | null;
    money: {
      productDue: number;
      deliveryFee: number;
      billed: number;
      onlineCaptured: number;
      cashCollected: number;
      refunded: number;
      amountDueNow: number;
      overRecorded: number;
    };
    timeline: { at: string; action: string; by: string; detail: { from?: unknown; to?: unknown } | null }[];
  };
};

const ADDRESS_FIELDS: [string, string][] = [
  ["fullName", "Name"],
  ["phone", "Phone"],
  ["houseBuilding", "House / building"],
  ["street", "Street"],
  ["area", "Area"],
  ["city", "City"],
  ["province", "Province"],
  ["postalCode", "Postal code"],
  ["nearbyLandmark", "Landmark"],
  ["deliveryInstructions", "Delivery notes"],
];

function label(s: string) {
  return ORDER_STATUS_LABELS[s as OrderStatus] || s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function summarizeChange(detail: { from?: unknown; to?: unknown } | null): string {
  if (!detail) return "";
  const pick = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const f = pick(detail.from);
  const t = pick(detail.to);
  const parts: string[] = [];
  if (f.status || t.status) {
    parts.push(`${f.status ? label(String(f.status)) : "?"} → ${t.status ? label(String(t.status)) : "?"}`);
  }
  if (t.reason) parts.push(`Reason: ${String(t.reason)}`);
  if (t.amount != null) parts.push(`Rs. ${String(t.amount)}`);
  if (t.notes) parts.push(String(t.notes));
  return parts.join(" · ");
}

/** "Rs 650 cash (products Rs 500 + delivery Rs 150)" */
function cashText(o: { remainingAmount: number; cashDue?: { products: number; delivery: number } }) {
  if (o.cashDue && o.cashDue.delivery > 0) {
    return `${formatCurrency(o.remainingAmount)} cash (products ${formatCurrency(o.cashDue.products)} + delivery ${formatCurrency(o.cashDue.delivery)})`;
  }
  return `${formatCurrency(o.remainingAmount)} cash`;
}

export default function AdminOrderDetailPage({ params }: { params: { orderNumber: string } }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [order, setOrder] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [riders, setRiders] = useState<{ id: string; name: string; phone?: string }[]>([]);
  const [riderId, setRiderId] = useState("");

  const load = useCallback(() => {
    fetch(`/api/orders/${encodeURIComponent(params.orderNumber)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setOrder(d.data);
          setError("");
        } else setError(d.error || "Order not found");
      })
      .catch(() => setError("Could not load the order"));
  }, [params.orderNumber]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!order?.admin?.canAssignRider) return;
    fetch("/api/admin?resource=riders&assignable=1")
      .then((r) => r.json())
      .then((d) => setRiders(d.success && Array.isArray(d.data?.items) ? d.data.items : []))
      .catch(() => setRiders([]));
  }, [order?.admin?.canAssignRider]);

  const byStore = useMemo(() => {
    const map = new Map<string, { name: string; items: Item[]; total: number }>();
    for (const i of order?.items || []) {
      const g = map.get(i.storeId) || { name: i.storeName, items: [], total: 0 };
      g.items.push(i);
      g.total += i.finalPrice;
      map.set(i.storeId, g);
    }
    return Array.from(map.entries());
  }, [order]);

  async function patch(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order!.id, ...body }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || "Update failed");
        return false;
      }
      toast.success(data.data?.message || success);
      if (data.data?.refund?.detail) toast.info(`Refund: ${data.data.refund.detail}`);
      load();
      return true;
    } catch {
      toast.error("Network error — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(to: OrderStatus, needsReason: boolean) {
    if (!order) return;
    const danger = to === "CANCELLED" || to === "FAILED" || to === "RETURNED";
    const r = await confirm({
      title: `Move ${order.orderNumber} to “${label(to)}”?`,
      message:
        to === "CANCELLED"
          ? "Stock and the coupon (if unpaid) are released. If the customer paid online, a refund is queued automatically. This cannot be undone."
          : to === "DELIVERED"
            ? "Stock is deducted as sold. This cannot be undone."
            : `The order goes from ${label(order.orderStatus)} to ${label(to)}. The customer is notified.`,
      confirmLabel: to === "CANCELLED" ? "Cancel order" : `Mark ${label(to)}`,
      tone: danger ? "danger" : "default",
      ...(needsReason
        ? { reason: { label: "Reason (saved on the order)", required: true, minLength: 3, maxLength: 500 } }
        : {}),
    });
    if (!r.confirmed) return;
    await patch({ orderStatus: to, ...(r.reason ? { notes: r.reason } : {}) }, "Order updated");
  }

  async function assignRider() {
    if (!order || !riderId) return;
    const rider = riders.find((x) => x.id === riderId);
    const r = await confirm({
      title: `Assign ${rider?.name || "rider"}?`,
      message: order.riderId
        ? `This replaces the current rider (${order.rider?.name || "—"}).`
        : "The rider is notified with pick-up and drop-off details.",
      confirmLabel: "Assign rider",
    });
    if (!r.confirmed) return;
    if (await patch({ action: "ASSIGN_RIDER", riderId }, "Rider assigned")) setRiderId("");
  }

  async function recordCash() {
    if (!order) return;
    const r = await confirm({
      title: `Record ${cashText(order)} received?`,
      message: order.riderId
        ? `The rider ${order.rider?.name || ""} then owes this cash to MandiBazaar (shown under Payouts → Rider remittances).`
        : "No rider is assigned, so this is recorded as cash received directly by MandiBazaar.",
      confirmLabel: "Record cash",
    });
    if (!r.confirmed) return;
    await patch({ collectCash: true, amountCollected: order.remainingAmount }, "Cash recorded");
  }

  if (error) {
    return (
      <div>
        <Link href="/admin/orders" className="text-sm text-leaf-600">
          ← Orders
        </Link>
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!order) return <div className="skeleton h-60 rounded-3xl" />;

  const a = order.admin;
  const addr = order.deliveryAddressSnapshot || {};
  const codOpen =
    order.remainingAmount > 0 &&
    !order.cashCollection &&
    (["CASH_ON_DELIVERY", "PARTIALLY_PAID"].includes(order.productPaymentStatus) ||
      order.deliveryFeePaymentStatus === "CASH_ON_DELIVERY") &&
    !["PENDING_PAYMENT", "CANCELLED", "FAILED", "RETURNED"].includes(order.orderStatus);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orders" className="text-sm text-leaf-600">
          ← Orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl sm:text-3xl">{order.orderNumber}</h1>
          <span className="rounded-full bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-sm font-semibold text-ink">
            {label(order.orderStatus)}
          </span>
          {a.waitingFlag && (
            <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
              {a.waitingFlag}
            </span>
          )}
        </div>
        <p className="text-sm text-ink-subtle">
          Placed {new Date(order.createdAt).toLocaleString("en-PK")}
          {order.cancelReason ? ` · Reason: ${order.cancelReason}` : ""}
        </p>
        {a.fulfillmentMismatch && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A store still shows a different status for this order than the order itself. The next
            status change here brings the store side in line.
          </p>
        )}
        {a.money.overRecorded > 0 && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
            {formatCurrency(a.money.overRecorded)} more is recorded as paid than this order billed
            ({formatCurrency(a.money.billed)}). Check the payment records below before refunding or
            paying out.
          </p>
        )}
      </div>

      {/* Actions */}
      <section className="rounded-3xl bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Actions</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {a.allowedNextStatuses.length === 0 && (
            <p className="text-sm text-ink-subtle">
              No status changes are possible from {label(order.orderStatus)}.
              {order.orderStatus === "PENDING_PAYMENT" &&
                " It is confirmed when the payment is recorded (Payments page or payment gateway)."}
            </p>
          )}
          {a.allowedNextStatuses.map((s) => (
            <div key={s.status} className="flex flex-col">
              <Button
                size="sm"
                variant={s.status === "CANCELLED" || s.status === "FAILED" ? "outline" : "primary"}
                disabled={busy || !!s.blockedReason}
                onClick={() => changeStatus(s.status, s.needsReason)}
                className={s.status === "CANCELLED" ? "border-red-300 text-red-700" : ""}
              >
                {s.status === "CANCELLED" ? "Cancel order" : `Mark ${label(s.status)}`}
              </Button>
              {s.blockedReason && (
                <span className="mt-1 text-[11px] text-amber-700">{s.blockedReason}</span>
              )}
            </div>
          ))}
          {codOpen && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={recordCash}>
              Record cash received ({cashText(order)})
            </Button>
          )}
        </div>

        {a.canAssignRider && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              aria-label="Rider"
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm sm:max-w-xs"
              disabled={riders.length === 0}
            >
              <option value="">
                {riders.length === 0
                  ? "No approved, active riders"
                  : order.riderId
                    ? "Re-assign to another rider…"
                    : "Choose a rider…"}
              </option>
              {riders
                .filter((r) => r.id !== order.riderId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </option>
                ))}
            </select>
            <Button size="sm" disabled={busy || !riderId} onClick={assignRider}>
              Assign rider
            </Button>
            {riders.length === 0 && (
              <Link href="/admin/riders" className="text-xs font-semibold text-leaf-600 underline">
                Open Riders
              </Link>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Customer */}
        <section className="rounded-3xl bg-card p-5 shadow-card">
          <h2 className="font-display text-lg">Customer &amp; delivery</h2>
          <p className="mt-2 text-sm font-medium">{order.customer?.fullName || "—"}</p>
          <p className="text-sm text-ink-muted">
            {a.customerPhone || "No valid phone"}
            {a.customerPhoneSource === "address" && " (from delivery address)"}
            {order.customer?.email ? ` · ${order.customer.email}` : ""}
          </p>
          {a.accountPhoneInvalid && (
            <p className="text-xs text-amber-700">
              The phone saved on this account is not a valid number ({order.customer?.phone}).
            </p>
          )}
          <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            {ADDRESS_FIELDS.filter(([k]) => addr[k]).map(([k, l]) => (
              <div key={k} className="contents">
                <dt className="text-ink-subtle">{l}</dt>
                <dd className="break-words">{String(addr[k])}</dd>
              </div>
            ))}
          </dl>
          {order.notes && <p className="mt-2 text-sm text-ink-muted">Order note: {order.notes}</p>}
          <div className="mt-4 border-t pt-3 text-sm">
            <p className="font-semibold">Rider</p>
            {order.rider ? (
              <p className="text-ink-muted">
                {order.rider.name} · {order.rider.phone} · {order.rider.vehicleType}
              </p>
            ) : (
              <p className="text-ink-subtle">No rider assigned</p>
            )}
            {a.remittance && (
              <p className="mt-1 text-xs text-ink-subtle">
                Cash remittance {formatCurrency(a.remittance.amount)} · {a.remittance.status}
                {a.remittance.rider ? ` · ${a.remittance.rider.name}` : " · no rider (check)"}
              </p>
            )}
          </div>
        </section>

        {/* Payment */}
        <section className="rounded-3xl bg-card p-5 shadow-card">
          <h2 className="font-display text-lg">Payment</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Line k="Products (after discount)" v={formatCurrency(a.money.productDue)} />
            {order.discount > 0 && (
              <Line
                k={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`}
                v={`− ${formatCurrency(order.discount)}`}
              />
            )}
            <Line
              k={`Delivery fee${order.deliveryDistanceKm ? ` (${Number(order.deliveryDistanceKm).toFixed(1)} km)` : ""}`}
              v={formatCurrency(order.deliveryFee)}
            />
            <Line k="Order total" v={formatCurrency(order.grandTotal)} strong />
            <Line k="Method" v={order.paymentLabel || order.paymentMethod.replace(/_/g, " ")} />
            <Line
              k="Delivery fee status"
              v={order.deliveryFeePaymentLabel || order.deliveryFeePaymentStatus}
            />
            <Line k="Product payment status" v={order.productPaymentStatus.replace(/_/g, " ")} />
            <Line k="Delivery fee paid" v={formatCurrency(order.deliveryFeePaid)} />
            <Line k="Products paid" v={formatCurrency(order.productAmountPaid)} />
            <Line
              k={
                order.cashDue && order.cashDue.delivery > 0
                  ? "Cash still to collect (products + delivery)"
                  : "Cash still to collect"
              }
              v={
                order.cashDue && order.cashDue.delivery > 0
                  ? `${formatCurrency(order.remainingAmount)} (${formatCurrency(order.cashDue.products)} + ${formatCurrency(order.cashDue.delivery)})`
                  : formatCurrency(order.remainingAmount)
              }
            />
            <Line k="Online captured (successful)" v={formatCurrency(a.money.onlineCaptured)} />
            <Line k="Cash collected" v={formatCurrency(a.money.cashCollected)} />
            <Line k="Refunded" v={formatCurrency(a.money.refunded)} />
          </dl>
          {order.payments.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="text-ink-subtle">
                  <tr>
                    <th className="py-1">Payment</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-1">
                        {p.type.replace(/_/g, " ").toLowerCase()}
                        <span className="block text-ink-subtle">
                          {new Date(p.paidAt || p.createdAt).toLocaleString("en-PK")}
                        </span>
                      </td>
                      <td>{p.method}</td>
                      <td>{formatCurrency(p.amount)}</td>
                      <td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {order.refunds.length > 0 && (
            <div className="mt-3 text-xs">
              <p className="font-semibold">Refunds</p>
              {order.refunds.map((r) => (
                <p key={r.id} className="text-ink-muted">
                  {formatCurrency(r.amount)} · {r.status} · {r.reason}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Items per store */}
      <section className="rounded-3xl bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Items</h2>
        <div className="mt-3 space-y-4">
          {byStore.map(([storeId, g]) => {
            const f = a.fulfillments.find((x) => x.storeId === storeId);
            return (
              <div key={storeId} className="rounded-2xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {g.name}
                    {f?.storePhone ? <span className="text-xs text-ink-subtle"> · {f.storePhone}</span> : null}
                  </p>
                  {f && (
                    <span className="rounded-full bg-brand-50 dark:bg-brand-500/10 px-2 py-0.5 text-xs">
                      Store: {label(f.status)}
                    </span>
                  )}
                </div>
                <ul className="mt-2 divide-y text-sm">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0">
                        {i.productName}
                        {i.variantName ? ` (${i.variantName})` : ""}
                        <span className="block text-xs text-ink-subtle">
                          {i.quantity} × {formatCurrency(i.unitPrice)} / {i.unit}
                        </span>
                      </span>
                      <span className="shrink-0">{formatCurrency(i.finalPrice)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-right text-xs text-ink-subtle">Store total {formatCurrency(g.total)}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Receipts */}
      <section className="rounded-3xl bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Payment receipts</h2>
        {a.paymentProofs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-subtle">No receipts uploaded.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {a.paymentProofs.map((p) => (
              <div key={p.id} className="flex gap-3 rounded-2xl border border-line p-3 text-sm">
                {isUsableImageUrl(p.imageUrl) ? (
                  <a href={p.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- receipt may be on any storage host */}
                    <img src={p.imageUrl} alt="Payment receipt" className="h-24 w-24 rounded-xl border object-cover" />
                  </a>
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-center text-[11px] text-red-700">
                    Image missing
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold">{p.status.replace(/_/g, " ")}</p>
                  <p className="text-xs text-ink-subtle">
                    {p.uploadedByRole === "RIDER" ? "Rider" : "Customer"} · {p.uploadedBy || "—"} ·{" "}
                    {new Date(p.createdAt).toLocaleString("en-PK")}
                  </p>
                  {p.notes && <p className="text-xs">{p.notes}</p>}
                  {p.reviewNotes && <p className="text-xs text-red-600">{p.reviewNotes}</p>}
                  {p.status === "PENDING_REVIEW" && (
                    <Link href={`/admin/payments?q=${encodeURIComponent(order.orderNumber)}`} className="text-xs font-semibold text-leaf-600">
                      Review on Payments →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="rounded-3xl bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">History</h2>
        <ol className="mt-3 space-y-2 border-l border-line pl-4 text-sm">
          {a.timeline.map((t, i) => (
            <li key={i}>
              <p className="font-medium">{label(t.action)}</p>
              <p className="text-xs text-ink-subtle">
                {new Date(t.at).toLocaleString("en-PK")} · {t.by}
                {summarizeChange(t.detail) ? ` · ${summarizeChange(t.detail)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <dt className="text-ink-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
