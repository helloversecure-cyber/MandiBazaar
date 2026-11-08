"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { ORDER_STATUS_LABELS } from "@/lib/orders/state-machine";
import type { OrderStatus } from "@prisma/client";

const PAGE_SIZE = 25;

type OrderRow = {
  id: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  deliveryFeePaid: number;
  productAmountPaid: number;
  remainingAmount: number;
  paymentMethod: string;
  deliveryFeePaymentStatus: string;
  productPaymentStatus: string;
  grandTotal: number;
  /** "Cash (rider)" for full cash-on-delivery orders */
  deliveryFeePaymentLabel?: string;
  fullCod?: boolean;
};

type Proof = {
  id: string;
  imageUrl: string;
  imageMissing: boolean;
  status: string;
  riderId: string | null;
  notes: string | null;
  reviewNotes: string | null;
  createdAt: string;
  amountDue: number;
  amountDueFor: string | null;
  canApprove: boolean;
  canRefund: boolean;
  blockedReason: string | null;
  order: {
    id: string;
    orderNumber: string;
    orderStatus: OrderStatus;
    paymentMethod: string;
    grandTotal: number;
    deliveryFee: number;
    deliveryFeePaid: number;
    productAmountPaid: number;
    customer: { fullName: string; phone: string } | null;
  } | null;
  uploadedBy: { fullName: string; phone: string | null; role?: { name: string } | null } | null;
  reviewedBy?: { fullName: string } | null;
};

const DUE_FOR: Record<string, string> = {
  FULL_PAYMENT: "products + delivery fee",
  DELIVERY_FEE: "delivery fee",
  PRODUCT_AMOUNT: "products",
};

function PaymentsInner() {
  const sp = useSearchParams();
  const confirm = useConfirm();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [tab, setTab] = useState<"PENDING_REVIEW" | "REVIEWED">("PENDING_REVIEW");
  const [search, setSearch] = useState(sp.get("q") || "");
  const [q, setQ] = useState(sp.get("q") || "");
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [proofPage, setProofPage] = useState(1);
  const [proofMeta, setProofMeta] = useState({ total: 0, totalPages: 1 });
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderMeta, setOrderMeta] = useState({ total: 0, totalPages: 1 });
  const [busyId, setBusyId] = useState("");

  const loadProofs = useCallback(async () => {
    const params = new URLSearchParams({
      resource: "payment-proofs",
      page: String(proofPage),
      limit: String(PAGE_SIZE),
    });
    if (tab === "PENDING_REVIEW") params.set("status", "PENDING_REVIEW");
    if (q) params.set("q", q);
    const d = await fetch(`/api/admin/payouts?${params}`).then((r) => r.json());
    if (d.success) {
      setProofs(d.data.items);
      setProofMeta({ total: d.data.pagination.total, totalPages: d.data.pagination.totalPages });
    } else toastRef.current.error(d.error || "Could not load receipts");
  }, [proofPage, tab, q]);

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams({ page: String(orderPage), limit: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    const d = await fetch(`/api/orders?${params}`).then((r) => r.json());
    if (d.success) {
      setOrders(d.data.items);
      setOrderMeta({ total: d.data.pagination.total, totalPages: d.data.pagination.totalPages });
    }
  }, [orderPage, q]);

  useEffect(() => {
    loadProofs();
  }, [loadProofs]);
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  async function send(proof: Proof, body: Record<string, unknown>, ok: string) {
    setBusyId(proof.id);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVIEW_PAYMENT_PROOF", proofId: proof.id, ...body }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.fieldErrors ? Object.values(data.fieldErrors).join(" ") : data.error || "Review failed");
        return;
      }
      toast.success(ok);
      loadProofs();
      loadOrders();
    } catch {
      toast.error("Network error — try again");
    } finally {
      setBusyId("");
    }
  }

  async function approve(p: Proof) {
    const r = await confirm({
      title: `Approve payment for ${p.order?.orderNumber}?`,
      message: (
        <span>
          Only approve if <strong>{formatCurrency(p.amountDue)}</strong> has really arrived in the
          JazzCash Till. Type the amount shown on the receipt to double-check it matches — the
          order is then confirmed and sent to the store.
        </span>
      ),
      confirmLabel: "Payment received — approve",
      reason: {
        label: "Amount on the receipt (Rs.) — optional, to cross-check",
        required: false,
        maxLength: 12,
        placeholder: String(p.amountDue ?? ""),
      },
    });
    if (!r.confirmed) return;
    const typed = (r.reason || "").replace(/[,\s]/g, "");
    let receiptAmount: number | undefined;
    if (typed) {
      receiptAmount = Number(typed);
      if (!Number.isFinite(receiptAmount) || receiptAmount < 0) {
        toast.error("Enter a valid receipt amount, or leave it blank");
        return;
      }
    }
    await send(
      p,
      receiptAmount !== undefined ? { decision: "APPROVED", receiptAmount } : { decision: "APPROVED" },
      "Payment received — order confirmed."
    );
  }

  async function decline(p: Proof) {
    const r = await confirm({
      title: `Decline this receipt for ${p.order?.orderNumber}?`,
      message: "The customer sees your reason and can upload a new receipt.",
      confirmLabel: "Decline receipt",
      tone: "danger",
      reason: { label: "Reason (shown to the customer)", required: true, minLength: 3, maxLength: 300, placeholder: "e.g. The screenshot is unclear" },
    });
    if (r.confirmed) await send(p, { decision: "REJECTED", notes: r.reason }, "Receipt declined — customer notified.");
  }

  async function refund(p: Proof) {
    const r = await confirm({
      title: `Money arrived for cancelled order ${p.order?.orderNumber}?`,
      message:
        "Use this only if the money is really in the JazzCash Till. It is recorded as a late payment and a refund is queued on the Refunds page — the order stays cancelled. Type the amount shown on the receipt.",
      confirmLabel: "Record & queue refund",
      tone: "danger",
      reason: { label: `Amount received (Rs., max ${p.order?.grandTotal ?? 0})`, required: true, minLength: 1, maxLength: 10, placeholder: String(p.order?.grandTotal ?? "") },
    });
    if (!r.confirmed) return;
    const amount = Number((r.reason || "").replace(/[, ]/g, ""));
    if (!Number.isFinite(amount) || amount < 1 || amount > (p.order?.grandTotal ?? 0)) {
      toast.error(`Enter an amount between Rs. 1 and Rs. ${p.order?.grandTotal ?? 0}`);
      return;
    }
    await send(p, { decision: "REFUND", amount }, "Recorded — refund queued on the Refunds page.");
  }

  function ProofCard({ p }: { p: Proof }) {
    const pending = p.status === "PENDING_REVIEW";
    const isRider = !!p.riderId || p.uploadedBy?.role?.name === "RIDER";
    return (
      <div
        className={`flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row ${
          pending ? "border-amber-300 ring-1 ring-amber-100" : "border-line"
        }`}
      >
        {p.imageMissing ? (
          <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-red-300 bg-red-50 p-3 text-center text-xs font-semibold text-red-700">
            Receipt image missing or blank
          </div>
        ) : (
          <a
            href={p.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="block h-36 w-36 shrink-0 overflow-hidden rounded-xl border border-line bg-app"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- receipts may live on any storage host */}
            <img
              src={p.imageUrl}
              alt="Payment receipt"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).replaceWith(
                  Object.assign(document.createElement("span"), {
                    className: "flex h-full items-center justify-center p-2 text-center text-xs font-semibold text-red-700",
                    textContent: "Image could not be loaded — check before approving",
                  })
                );
              }}
            />
          </a>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {p.order ? (
              <Link
                href={`/admin/orders/${encodeURIComponent(p.order.orderNumber)}`}
                className="font-semibold text-ink hover:underline"
              >
                {p.order.orderNumber}
              </Link>
            ) : (
              <span className="font-semibold">Order</span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                pending
                  ? "bg-amber-100 text-amber-800"
                  : p.status === "APPROVED"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {pending ? "Awaiting review" : p.status === "APPROVED" ? "Received" : "Declined"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">
              {isRider ? "Rider proof" : "Customer receipt"}
            </span>
            {p.order && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">
                Order {ORDER_STATUS_LABELS[p.order.orderStatus]}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {p.order?.customer?.fullName} · {p.order?.customer?.phone}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:max-w-md">
            <div className="rounded-xl bg-app px-3 py-2">
              <p className="text-[11px] text-ink-subtle">Order total</p>
              <p className="font-semibold">{formatCurrency(p.order?.grandTotal ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-[11px] text-amber-700">
                Amount due now{p.amountDueFor ? ` (${DUE_FOR[p.amountDueFor] || ""})` : ""}
              </p>
              <p className="font-semibold">{formatCurrency(p.amountDue)}</p>
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">
            Already paid: delivery {formatCurrency(p.order?.deliveryFeePaid ?? 0)} · products{" "}
            {formatCurrency(p.order?.productAmountPaid ?? 0)} · uploaded by{" "}
            {p.uploadedBy?.fullName || "user"} on {new Date(p.createdAt).toLocaleString("en-PK")}
          </p>
          {p.notes && <p className="mt-1 text-xs text-ink-subtle">Note: {p.notes}</p>}
          {p.reviewNotes && <p className="mt-1 text-xs text-red-600">Review note: {p.reviewNotes}</p>}
          {p.reviewedBy?.fullName && !pending && (
            <p className="mt-1 text-xs text-ink-subtle">Reviewed by {p.reviewedBy.fullName}</p>
          )}

          {pending && (
            <div className="mt-3 space-y-2">
              {p.blockedReason ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                  {p.blockedReason}
                </p>
              ) : (
                <p className="text-xs font-medium text-ink-muted">
                  Check the receipt: did {formatCurrency(p.amountDue)} arrive in the JazzCash Till?
                  Approve only if it did.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {p.canApprove && (
                  <Button
                    disabled={busyId === p.id}
                    onClick={() => approve(p)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {busyId === p.id ? "Saving…" : "Payment received — Approve"}
                  </Button>
                )}
                {p.canRefund && (
                  <Button variant="outline" disabled={busyId === p.id} onClick={() => refund(p)}>
                    Money arrived — record &amp; refund
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busyId === p.id}
                  onClick={() => decline(p)}
                  className="border-red-300 text-red-700 hover:bg-red-50"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-ink">Payments</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Customers&apos; JazzCash QR / Till receipts arrive here. <strong>Approve</strong> confirms the
        order. <strong>Decline</strong> lets the customer send a new receipt. Receipts on cancelled
        orders cannot be approved — if the money arrived anyway, record it and refund the customer.
      </p>

      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setProofPage(1);
          setOrderPage(1);
          setQ(search.trim());
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order number, e.g. ORD-20261031-000001"
          aria-label="Search by order number"
          className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm sm:max-w-md"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>

      <div className="mt-6 flex gap-2">
        {(["PENDING_REVIEW", "REVIEWED"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setProofPage(1);
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              tab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-ink-muted"
            }`}
          >
            {t === "PENDING_REVIEW" ? `Awaiting your decision${tab === t ? ` (${proofMeta.total})` : ""}` : "All receipts"}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {proofs.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-app px-4 py-6 text-sm text-ink-subtle">
            {tab === "PENDING_REVIEW" ? "No receipts waiting for review." : "No receipts found."}
          </p>
        )}
        {proofs.map((p) => (
          <ProofCard key={p.id} p={p} />
        ))}
      </div>
      <Pagination
        className="mt-3"
        page={proofPage}
        totalPages={proofMeta.totalPages}
        total={proofMeta.total}
        pageSize={PAGE_SIZE}
        itemLabel="receipts"
        onPageChange={setProofPage}
      />

      <h2 className="mt-10 text-xl font-bold text-ink">Order payments</h2>
      <div className="mt-4 overflow-x-auto rounded-3xl bg-card shadow-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-app">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Delivery paid</th>
              <th className="px-4 py-3">Products paid</th>
              <th className="px-4 py-3">Cash to collect</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Payment status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/orders/${encodeURIComponent(o.orderNumber)}`} className="hover:underline">
                    {o.orderNumber}
                  </Link>
                  <span className="block text-xs text-ink-subtle">{ORDER_STATUS_LABELS[o.orderStatus]}</span>
                </td>
                <td className="px-4 py-3">{formatCurrency(o.grandTotal)}</td>
                <td className="px-4 py-3">{formatCurrency(o.deliveryFeePaid)}</td>
                <td className="px-4 py-3">{formatCurrency(o.productAmountPaid)}</td>
                <td className="px-4 py-3">{formatCurrency(o.remainingAmount)}</td>
                <td className="px-4 py-3">
                  {o.fullCod ? "Cash on delivery (products + delivery)" : o.paymentMethod.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 text-xs">
                  Delivery: {o.deliveryFeePaymentLabel || o.deliveryFeePaymentStatus}
                  <br />
                  Products: {o.productPaymentStatus.replace(/_/g, " ")}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                  No orders found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        className="mt-3"
        page={orderPage}
        totalPages={orderMeta.totalPages}
        total={orderMeta.total}
        pageSize={PAGE_SIZE}
        itemLabel="orders"
        onPageChange={setOrderPage}
      />
    </div>
  );
}

export default function AdminPaymentsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-40 rounded-3xl" />}>
      <PaymentsInner />
    </Suspense>
  );
}
