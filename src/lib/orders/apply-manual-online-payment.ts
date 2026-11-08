import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  syncFulfillmentsToOrderStatus,
  syncOrderAfterFulfillmentReady,
} from "@/lib/orders/fulfillment-sync";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { addPayment, toLedgerOrder } from "@/lib/orders/payment-ledger";
import { recordCustomerPaymentLedger, recordOrderConfirmedLedger } from "@/lib/finance/ledger";

type Order = Prisma.OrderGetPayload<Record<string, never>>;

/** Pure: which part of the order the online receipt pays, and how much is due. */
export function manualPaymentDue(order: {
  deliveryFeePaymentStatus: string;
  productPaymentStatus: string;
  subtotal: unknown;
  discount: unknown;
  deliveryFee: unknown;
  deliveryFeePaid: unknown;
  productAmountPaid: unknown;
}): { type: "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT"; amount: number } | null {
  const l = toLedgerOrder(order);
  const feeOpen =
    ["PENDING", "INITIATED", "PROCESSING", "FAILED"].includes(order.deliveryFeePaymentStatus) &&
    l.deliveryFee - l.deliveryFeePaid > 0.001;
  const productOpen =
    ["PENDING", "FAILED", "PARTIALLY_PAID"].includes(order.productPaymentStatus) &&
    Math.max(0, l.subtotal - l.discount) - l.productAmountPaid > 0.001;
  const fee = Math.max(0, l.deliveryFee - l.deliveryFeePaid);
  const product = Math.max(0, l.subtotal - l.discount - l.productAmountPaid);
  if (feeOpen && productOpen) return { type: "FULL_PAYMENT", amount: Math.round((fee + product) * 100) / 100 };
  if (feeOpen) return { type: "DELIVERY_FEE", amount: Math.round(fee * 100) / 100 };
  if (productOpen) return { type: "PRODUCT_AMOUNT", amount: Math.round(product * 100) / 100 };
  return null;
}

/**
 * After MandiBazaar approves a customer JazzCash Till/QR receipt,
 * mark the pending online portion of the order as paid and confirm it.
 *
 * Idempotent: the order row is locked, the order must still be PENDING_PAYMENT,
 * and the Payment reference is derived from the proof id (unique), so the same
 * receipt can never be recorded twice and paid amounts never exceed what is due.
 */
export async function applyApprovedPaymentProof(
  orderId: string,
  opts: { proofId?: string } = {}
): Promise<{ updated: boolean; order: Order | null; paymentId?: string; reason?: string }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");
    if (order.orderStatus !== OrderStatus.PENDING_PAYMENT) {
      return { updated: false as const, order, reason: "NOT_PENDING_PAYMENT" };
    }
    const due = manualPaymentDue(order);
    if (!due || due.amount <= 0) {
      return { updated: false as const, order, reason: "NOTHING_DUE" };
    }

    const reference = opts.proofId
      ? `till_qr_proof_${opts.proofId}`
      : `till_qr_approved_${order.orderNumber}_${Date.now()}`;
    const existing = await tx.payment.findUnique({ where: { reference } });
    if (existing) {
      return { updated: false as const, order, reason: "ALREADY_APPLIED" };
    }

    const payment = await tx.payment.create({
      data: {
        orderId,
        type: due.type,
        method: "JAZZCASH",
        amount: due.amount,
        status: "SUCCESS",
        paidAt: new Date(),
        reference,
        metadata: {
          provider: "jazzcash_till_qr",
          approvedVia: "payment_proof",
          ...(opts.proofId ? { proofId: opts.proofId } : {}),
        },
      },
    });

    const ledger = addPayment(toLedgerOrder(order), due.type, due.amount);
    const productCod = order.productPaymentStatus === "CASH_ON_DELIVERY";
    await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryFeePaid: ledger.deliveryFeePaid,
        productAmountPaid: ledger.productAmountPaid,
        remainingAmount: productCod
          ? order.remainingAmount
          : ledger.remainingAmount,
        ...(ledger.feeFullyPaid ? { deliveryFeePaymentStatus: "PAID" as const } : {}),
        ...(due.type !== "DELIVERY_FEE"
          ? {
              productPaymentStatus: ledger.productFullyPaid
                ? ("PAID" as const)
                : ("PARTIALLY_PAID" as const),
            }
          : {}),
        paymentMethod: productCod ? "MIXED" : "JAZZCASH",
        orderStatus: OrderStatus.CONFIRMED,
      },
    });

    await syncFulfillmentsToOrderStatus(tx, orderId, OrderStatus.CONFIRMED);
    await syncOrderAfterFulfillmentReady(tx, orderId);

    // Append-only ledger: record the customer payment + snapshot the sale,
    // commission and earnings now that the order is confirmed (idempotent).
    await recordCustomerPaymentLedger(tx, { orderId, amount: due.amount, refId: payment.id });
    await recordOrderConfirmedLedger(tx, orderId);

    return { updated: true as const, order, paymentId: payment.id };
  });

  if (!result.updated) {
    return { updated: false, order: result.order, reason: result.reason };
  }

  await notifyOrderEvent(
    orderId,
    "PAYMENT_SUCCESS",
    "Payment verified",
    `JazzCash Till payment for order ${result.order.orderNumber} was approved. Your order is confirmed.`
  );
  await notifyOrderEvent(
    orderId,
    "ORDER_CONFIRMED",
    "Order confirmed",
    `Your order ${result.order.orderNumber} has been confirmed.`
  );

  const fresh = await prisma.order.findUnique({ where: { id: orderId } });
  return { updated: true, order: fresh, paymentId: result.paymentId };
}
