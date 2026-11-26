/**
 * Self-service account deletion (required by Google Play for the Android app).
 *
 * The account is closed immediately: it can no longer sign in, app sessions and
 * push tokens are removed, and open item lists are cancelled. Order, payment and
 * payout records are kept where the law requires it (see /privacy and
 * /delete-account).
 */
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/password-check";
import { isPlatformAdminRole } from "@/lib/auth/permissions";

export class DeletionError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
    this.name = "DeletionError";
  }
}

const FINISHED: OrderStatus[] = ["DELIVERED", "CANCELLED", "FAILED", "RETURNED"];
const OPEN_REMITTANCE = ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED", "OVERDUE", "DISPUTED"] as const;

export async function requestAccountDeletion(userId: string, meta: RequestMeta = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, riderProfile: { select: { id: true } } },
  });
  if (!user || !user.isActive) throw new DeletionError("NOT_FOUND", "Account not found.", 404);

  if (isPlatformAdminRole(user.role.name)) {
    throw new DeletionError("STAFF_ACCOUNT", "Staff accounts are closed by a MandiBazaar admin.", 403);
  }
  if (user.role.name === "STORE_OWNER") {
    const stores = await prisma.store.count({ where: { ownerId: userId, status: { not: "REJECTED" } } });
    if (stores > 0) {
      throw new DeletionError(
        "STORE_ACCOUNT",
        "Your store has orders and payouts to settle. Please contact MandiBazaar support to close a store account."
      );
    }
  }

  const activeOrders = await prisma.order.count({
    where: { customerId: userId, orderStatus: { notIn: FINISHED } },
  });
  if (activeOrders > 0) {
    throw new DeletionError("ACTIVE_ORDERS", "Please wait until your active orders are delivered or cancelled.");
  }

  const riderId = user.riderProfile?.id;
  if (riderId) {
    const [deliveries, cash] = await Promise.all([
      prisma.order.count({ where: { riderId, orderStatus: { in: ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"] } } }),
      prisma.cashRemittance.count({ where: { riderId, status: { in: [...OPEN_REMITTANCE] } } }),
    ]);
    if (deliveries > 0) throw new DeletionError("ACTIVE_DELIVERIES", "Please finish your active deliveries first.");
    if (cash > 0) throw new DeletionError("COD_OPEN", "Please remit the cash you collected before closing your account.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } });
    if (riderId) await tx.rider.update({ where: { id: riderId }, data: { isActive: false, status: "OFFLINE" } });
    await tx.mobileRefreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    const lists = await tx.itemList.findMany({ where: { customerId: userId, status: "BIDDING" }, select: { id: true } });
    if (lists.length) {
      const ids = lists.map((l) => l.id);
      await tx.storeBid.updateMany({ where: { listId: { in: ids }, status: "PENDING" }, data: { status: "NOT_SELECTED" } });
      await tx.itemList.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    }
  });

  await writeAuditLog({
    userId,
    action: "ACCOUNT_DELETION_REQUESTED",
    entity: "User",
    entityId: userId,
    newValue: { role: user.role.name },
    ...meta,
  }).catch((e) => console.error("[account:delete] audit", e));

  return { closed: true };
}
