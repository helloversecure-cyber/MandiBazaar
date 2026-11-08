import { OrderStatus, Prisma } from "@prisma/client";
import { releaseReservedStock } from "@/lib/inventory/stock";
import { releaseCouponUsageForOrder } from "@/lib/orders/coupons";
import { canTransition } from "@/lib/orders/state-machine";

/**
 * One cancel routine for every path (customer cancel, admin cancel, payment expiry)
 * so stock, coupon use, store fulfilments and open payment attempts are always
 * released the same way (QA N2 / CHK-08 / EDGE-02).
 *
 * Must run inside a transaction. Re-reads and locks the order, so a second call
 * (double click, cron + traffic sweep at the same time) is a no-op.
 */
export async function cancelOrderInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  opts: {
    reason: string;
    actorId?: string | null;
    /** Only cancel if the order is still in one of these statuses (e.g. expiry → PENDING_PAYMENT only) */
    onlyIfStatusIn?: OrderStatus[];
    status?: typeof OrderStatus.CANCELLED | typeof OrderStatus.FAILED;
  }
): Promise<{ cancelled: boolean; previousStatus?: OrderStatus; reason?: string }> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return { cancelled: false, reason: "NOT_FOUND" };
  const target = opts.status ?? OrderStatus.CANCELLED;
  if (order.orderStatus === target) {
    return { cancelled: false, previousStatus: order.orderStatus, reason: "ALREADY" };
  }
  if (opts.onlyIfStatusIn && !opts.onlyIfStatusIn.includes(order.orderStatus)) {
    return { cancelled: false, previousStatus: order.orderStatus, reason: "STATUS_CHANGED" };
  }
  if (!canTransition(order.orderStatus, target)) {
    return { cancelled: false, previousStatus: order.orderStatus, reason: "INVALID_TRANSITION" };
  }

  await tx.order.update({
    where: { id: order.id },
    data: {
      orderStatus: target,
      cancelledAt: new Date(),
      cancelReason: opts.reason.slice(0, 500),
    },
  });

  await tx.storeFulfillment.updateMany({
    where: { orderId: order.id },
    data: { status: target },
  });

  for (const item of order.items) {
    if (!item.productId) continue;
    await releaseReservedStock(tx, {
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      orderId: order.id,
      createdById: opts.actorId || undefined,
    });
  }

  await releaseCouponUsageForOrder(tx, order.id);

  await tx.payment.updateMany({
    where: {
      orderId: order.id,
      status: { in: ["PENDING", "INITIATED", "PROCESSING"] },
    },
    data: { status: "CANCELLED" },
  });
  await tx.paymentTransaction.updateMany({
    where: {
      orderId: order.id,
      status: { in: ["PENDING", "INITIATED", "PROCESSING"] },
    },
    data: { status: "CANCELLED" },
  });

  return { cancelled: true, previousStatus: order.orderStatus };
}
