import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/** Riders who may receive and bid on delivery requests (status-level gate). */
export const ELIGIBLE_RIDER_WHERE = {
  approvalStatus: "APPROVED",
  isActive: true,
  status: "AVAILABLE",
} satisfies Prisma.RiderWhereInput;

/** Order statuses that still represent a live commitment for the assigned rider. */
const COMMITTED_ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
] as const;

/**
 * A rider is "busy" while they still have a live commitment — either an order
 * pre-assigned to them (any non-terminal status, so a bid they already won counts
 * the moment the order is created) OR an accepted delivery request whose order
 * hasn't been placed yet. This prevents one rider winning several auctions.
 */
export async function riderHasActiveDelivery(
  riderId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const [committedOrders, acceptedRequests] = await Promise.all([
    tx.order.count({
      where: { riderId, orderStatus: { in: COMMITTED_ORDER_STATUSES as unknown as Prisma.EnumOrderStatusFilter["in"] } },
    }),
    // An accepted-but-unplaced request only reserves the rider for a grace window;
    // after that the customer is assumed to have abandoned it and the rider is freed.
    tx.deliveryRequest.count({
      where: {
        acceptedRiderId: riderId,
        status: "ASSIGNED",
        orderId: null,
        updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
    }),
  ]);
  return committedOrders > 0 || acceptedRequests > 0;
}

/**
 * Full eligibility for winning a bid: approved + active + available + no
 * conflicting active delivery. Checked at accept time (not only at bid time).
 */
export async function isRiderEligibleForAssignment(
  riderId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  return (await riderBidEligibility(riderId, tx)).eligible;
}

export type RiderBidEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: "NOT_APPROVED" | "SUSPENDED" | "OFFLINE" | "BUSY" | "COD_OVERDUE" };

/**
 * Same gate as {@link isRiderEligibleForAssignment} but returns *why* a rider
 * can't bid, so the UI can show a precise message instead of dead bid cards.
 */
export async function riderBidEligibility(
  riderId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<RiderBidEligibility> {
  const rider = await tx.rider.findUnique({
    where: { id: riderId },
    select: { approvalStatus: true, isActive: true, status: true, codRestrictedAt: true },
  });
  if (!rider || rider.approvalStatus !== "APPROVED") return { eligible: false, reason: "NOT_APPROVED" };
  if (!rider.isActive) return { eligible: false, reason: "SUSPENDED" };
  // Overdue COD cash blocks NEW assignments (the rider keeps full account access).
  if (rider.codRestrictedAt) return { eligible: false, reason: "COD_OVERDUE" };
  if (rider.status !== "AVAILABLE") return { eligible: false, reason: "OFFLINE" };
  if (await riderHasActiveDelivery(riderId, tx)) return { eligible: false, reason: "BUSY" };
  return { eligible: true, reason: null };
}
