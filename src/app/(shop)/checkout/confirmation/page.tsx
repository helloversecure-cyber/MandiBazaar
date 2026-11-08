"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { DownloadInvoiceButton } from "@/components/orders/DownloadInvoiceButton";
import { ORDER_STATUS_LABELS } from "@/lib/orders/state-machine";
import { OrderStatus } from "@prisma/client";
import { DeliveryEtaNote } from "@/components/shop/DeliveryEtaNote";
import { fullCodPaymentLabel } from "@/lib/orders/full-cod";

function ConfirmationContent() {
  const sp = useSearchParams();
  const orderNumber = sp.get("order");
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderNumber) {
      setLoading(false);
      return;
    }
    fetch(`/api/orders/${orderNumber}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setOrder(d.data);
      })
      .finally(() => setLoading(false));
  }, [orderNumber]);

  if (loading) return <div className="p-16 text-center">Verifying order...</div>;

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-display text-3xl">Order not found</h1>
        <Button href="/account/orders" className="mt-6">
          View orders
        </Button>
      </div>
    );
  }

  const address = order.deliveryAddressSnapshot as Record<string, string>;
  const items = order.items as {
    productName: string;
    quantity: number;
    finalPrice: number;
    unit: string;
  }[];
  const status = order.orderStatus as OrderStatus;
  const fullCodLabel = fullCodPaymentLabel({
    deliveryFee: Number(order.deliveryFee) || 0,
    deliveryFeePaymentStatus: String(order.deliveryFeePaymentStatus || ""),
  });
  const awaitingPayment = status === "PENDING_PAYMENT";
  // A JazzCash-QR customer uploads a receipt and the order stays PENDING_PAYMENT
  // until an admin verifies. Expose that state so we don't tell a customer who
  // already paid that they're unpaid and nudge a second payment.
  const proofs =
    (order.paymentProofs as { status: string; reviewNotes?: string | null }[] | undefined) || [];
  const pendingReview = awaitingPayment && proofs.some((p) => p.status === "PENDING_REVIEW");
  const latestProof = proofs[0];
  const rejectedProof =
    awaitingPayment && !pendingReview && latestProof?.status === "REJECTED" ? latestProof : null;
  const failed =
    status === "CANCELLED" || status === "FAILED" || status === "RETURNED";
  const confirmed =
    !awaitingPayment &&
    !failed &&
    [
      "CONFIRMED",
      "PROCESSING",
      "PACKED",
      "READY_FOR_DISPATCH",
      "ASSIGNED_TO_RIDER",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ].includes(status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-3xl bg-card p-8 shadow-soft text-center">
        {awaitingPayment && pendingReview ? (
          <>
            <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
              Receipt received
            </p>
            <h1 className="mt-2 font-display text-4xl text-ink">
              We’re verifying your payment
            </h1>
            <p className="mt-2 text-ink-subtle">
              Thanks — we’ve received your receipt for order{" "}
              {order.orderNumber as string}. MandiBazaar will confirm it shortly,
              usually within a few hours. No need to pay again.
            </p>
          </>
        ) : awaitingPayment && rejectedProof ? (
          <>
            <p className="text-sm font-medium uppercase tracking-widest text-red-600">
              Receipt needs attention
            </p>
            <h1 className="mt-2 font-display text-4xl text-ink">
              We couldn’t verify your payment
            </h1>
            <p className="mt-2 text-ink-subtle">
              {rejectedProof.reviewNotes
                ? `Your receipt for order ${order.orderNumber as string} was declined: ${rejectedProof.reviewNotes}. Please upload a clear JazzCash receipt again.`
                : `Your receipt for order ${order.orderNumber as string} couldn’t be verified. Please upload a clear JazzCash receipt again.`}
            </p>
          </>
        ) : awaitingPayment ? (
          <>
            <p className="text-sm font-medium uppercase tracking-widest text-amber-700">
              Awaiting payment
            </p>
            <h1 className="mt-2 font-display text-4xl text-ink">
              Complete payment to confirm your order
            </h1>
            <p className="mt-2 text-ink-subtle">
              Order {order.orderNumber as string} is not confirmed until payment
              succeeds.
            </p>
          </>
        ) : failed ? (
          <>
            <p className="text-sm font-medium uppercase tracking-widest text-red-600">
              {ORDER_STATUS_LABELS[status] || status}
            </p>
            <h1 className="mt-2 font-display text-4xl text-ink">
              This order was not completed
            </h1>
            <p className="mt-2 text-ink-subtle">
              Order {order.orderNumber as string}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium uppercase tracking-widest text-leaf-600">
              Success
            </p>
            <h1 className="mt-2 font-display text-4xl text-ink">
              {confirmed
                ? "Your order has been confirmed."
                : "Order received"}
            </h1>
            <p className="mt-2 text-ink-subtle">
              Order {order.orderNumber as string}
            </p>
          </>
        )}

        <div className="mt-8 space-y-3 text-left text-sm">
          <div className="flex justify-between">
            <span>Status</span>
            <span className="font-medium">
              {ORDER_STATUS_LABELS[status] || status}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Product total</span>
            <span>{formatCurrency(order.subtotal as number)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatCurrency(order.discount as number)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery fee</span>
            <span>{formatCurrency(order.deliveryFee as number)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery fee paid</span>
            <span>{formatCurrency(order.deliveryFeePaid as number)}</span>
          </div>
          <div className="flex justify-between">
            <span>Product amount paid</span>
            <span>{formatCurrency(order.productAmountPaid as number)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Remaining amount</span>
            <span>{formatCurrency(order.remainingAmount as number)}</span>
          </div>
          <div className="flex justify-between">
            <span>Payment method</span>
            <span className="text-right">
              {fullCodLabel || String(order.paymentMethod).replace(/_/g, " ")}
            </span>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <DeliveryEtaNote />
          <div className="rounded-2xl bg-brand-50 dark:bg-brand-500/10 p-4 text-left text-sm">
            <p className="font-semibold text-ink">Delivery address</p>
            <p className="mt-1 text-ink-muted">
              {address?.fullName}, {address?.phone}
              <br />
              {address?.houseBuilding}, {address?.area}, {address?.city}
            </p>
          </div>
        </div>

        <ul className="mt-6 space-y-2 text-left text-sm">
          {items?.map((item, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {item.productName} × {item.quantity} ({item.unit})
              </span>
              <span>{formatCurrency(item.finalPrice)}</span>
            </li>
          ))}
        </ul>

        {pendingReview && (
          <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Your payment receipt is with MandiBazaar for verification. We’ll confirm
            your order as soon as it’s checked — no need to pay again. You can track
            the status on your order page.
          </p>
        )}

        {awaitingPayment && !pendingReview && (
          <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Unpaid orders expire automatically after a while and release reserved
            stock. Finish payment from your order page.
          </p>
        )}

        {!awaitingPayment && (order.remainingAmount as number) > 0 && (
          <p className="mt-6 rounded-xl bg-honey-400/15 px-4 py-3 text-sm text-ink">
            Pay {formatCurrency(order.remainingAmount as number)} in cash to the rider
            {fullCodLabel ? " (products + delivery fee)" : ""} when your order arrives.
          </p>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {awaitingPayment && pendingReview ? (
            // Receipt is under review — no payment action, avoid a double-pay nudge.
            // The "View order" / "Continue shopping" buttons below remain.
            null
          ) : awaitingPayment ? (
            <Button
              href={`/checkout/payment?order=${encodeURIComponent(String(order.orderNumber))}&orderId=${encodeURIComponent(String(order.id))}`}
            >
              {rejectedProof ? "Upload a new receipt" : "Complete payment"}
            </Button>
          ) : (
            <DownloadInvoiceButton
              orderNumber={String(order.orderNumber)}
              variant="primary"
            />
          )}
          <Button href={`/account/orders/${order.orderNumber}`} variant="outline">
            View order
          </Button>
          <Button href="/products" variant="outline">
            Continue shopping
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<div className="p-16 text-center">Loading...</div>}>
      <ConfirmationContent />
    </Suspense>
  );
}
