/**
 * Rider pay — DB helpers. Pure rules live in `./pay-rules`.
 * `recordRiderFeeForOrder` is called inside the transaction that marks an order
 * DELIVERED (rider portal MARK_DELIVERED and admin status change).
 */
import { Prisma } from "@prisma/client";
import { toNumber } from "@/lib/utils";
import { DEFAULT_RIDER_PAY, type RiderPaySettings } from "./pay-rules";

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
      deliveryFee: true,
      deliveryFeePaid: true,
      sponsoredDeliveryFee: true,
      delivery: { select: { riderFee: true } },
    },
  });
  if (!order || order.orderStatus !== "DELIVERED" || !order.riderId) return null;
  if (order.delivery?.riderFee != null) return toNumber(order.delivery.riderFee);

  // NEW-01 — "the rider keeps the delivery fee." The rider's pay for a delivery IS
  // the delivery fee. They already keep the cash part they collected; the platform
  // owes them only the part paid ONLINE (deliveryFeePaid) — Rs 0 for a normal COD
  // order, so they are never paid twice. recordRiderFeeForOrder runs BEFORE the
  // cash is recorded, so deliveryFeePaid here is the online portion only.
  // NEW-08 — on a store-sponsored free delivery the customer paid Rs 0, so the
  // store funds the rider's (notional) fee: add sponsoredDeliveryFee.
  const fee = Math.max(
    0,
    Math.round(toNumber(order.deliveryFeePaid) + toNumber(order.sponsoredDeliveryFee))
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
