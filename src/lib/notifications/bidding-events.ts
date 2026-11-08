/** Rider bidding notifications (best-effort, never block the bidding path). */
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { sendNotification } from "@/lib/notifications/service";

/** A new delivery request opened — ping every online/available rider so they can
 *  bid right away. Best-effort and deduped per request; never blocks checkout. */
export async function notifyRidersOfNewRequest(requestId: string): Promise<void> {
  try {
    const riders = await prisma.rider.findMany({
      where: {
        approvalStatus: "APPROVED",
        isActive: true,
        status: "AVAILABLE",
        codRestrictedAt: null,
      },
      select: { userId: true },
      take: 200,
    });
    await Promise.all(
      riders
        .filter((r): r is { userId: string } => Boolean(r.userId))
        .map((r) =>
          sendNotification({
            userId: r.userId,
            type: "NEW_DELIVERY_REQUEST",
            title: "New delivery request",
            body: "A customer is choosing a rider — open Delivery requests to place your bid.",
            metadata: { requestId },
          }).catch(() => {})
        )
    );
  } catch (e) {
    console.error("[notify:new-request]", e);
  }
}

/** The customer chose this rider's bid — the delivery and the fee are theirs. */
export async function notifyBidAccepted(riderId: string, amount: number): Promise<void> {
  try {
    const r = await prisma.rider.findUnique({ where: { id: riderId }, select: { userId: true } });
    if (!r?.userId) return;
    await sendNotification({
      userId: r.userId,
      type: "BID_ACCEPTED",
      title: "Your bid was accepted",
      body: `A customer chose you for a delivery at ${formatCurrency(amount)}. Head to your deliveries to start.`,
    });
  } catch (e) {
    console.error("[notify:bid-accepted]", e);
  }
}
