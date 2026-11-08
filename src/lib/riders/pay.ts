/**
 * Rider pay — DB helpers. Pure rules live in `./pay-rules`.
 * `recordRiderFeeForOrder` is called inside the transaction that marks an order
 * DELIVERED (rider portal MARK_DELIVERED and admin status change).
 */
import { Prisma } from "@prisma/client";
import { toNumber } from "@/lib/utils";
import { computeRiderFee, DEFAULT_RIDER_PAY, type RiderPaySettings } from "./pay-rules";

export * from "./pay-rules";

type Db = Prisma.TransactionClient;

export async function getRiderPaySettings(db: Db): Promise<RiderPaySettings> {
  const s = await db.storeSettings.findFirst({ select: { riderBaseFee: true, riderPerKmFee: true } });
  if (!s) return { ...DEFAULT_RIDER_PAY };
  return { baseFee: toNumber(s.riderBaseFee), perKmFee: toNumber(s.riderPerKmFee) };
}

/**
 * Fix the rider fee for a delivered order (idempotent).
 * - Order must be DELIVERED and have a rider; otherwise nothing happens (null).
 * - Creates the Delivery row if missing (riderId from the order).
 * - Sets `riderFee` only while it is still null and unpaid — a fee already fixed
 *   is never changed, so later settings changes don't alter it.
 * Returns the fee now stored on the delivery (or null when not applicable).
 */
export async function recordRiderFeeForOrder(tx: Db, orderId: string): Promise<number | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      orderStatus: true,
      riderId: true,
      deliveredAt: true,
      deliveryDistanceKm: true,
      delivery: { select: { riderFee: true } },
    },
  });
  if (!order || order.orderStatus !== "DELIVERED" || !order.riderId) return null;
  if (order.delivery?.riderFee != null) return toNumber(order.delivery.riderFee);

  const settings = await getRiderPaySettings(tx);
  const fee = computeRiderFee(
    settings,
    order.deliveryDistanceKm == null ? null : toNumber(order.deliveryDistanceKm)
  );

  if (!order.delivery) {
    await tx.delivery.upsert({
      where: { orderId },
      create: {
        orderId,
        riderId: order.riderId,
        deliveredAt: order.deliveredAt ?? new Date(),
        riderFee: fee,
      },
      update: {},
    });
  }
  // Conditional write = safe against a concurrent first write.
  await tx.delivery.updateMany({
    where: { orderId, riderFee: null, riderPayoutId: null },
    data: { riderFee: fee, riderId: order.riderId },
  });
  const after = await tx.delivery.findUnique({ where: { orderId }, select: { riderFee: true } });
  return after?.riderFee == null ? null : toNumber(after.riderFee);
}
