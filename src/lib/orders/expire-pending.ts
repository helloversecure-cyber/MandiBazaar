import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { cancelOrderInTx } from "@/lib/orders/cancel-order";

const DEFAULT_TTL_MINUTES = 45;

/** Hobby cron is once/day — traffic-driven sweeps are the primary path. */
let lastSweepAt = 0;
const SWEEP_COOLDOWN_MS = 45_000;

/** Payment window for PENDING_PAYMENT orders (env PENDING_PAYMENT_TTL_MINUTES, min 5). */
export function pendingPaymentTtlMinutes() {
  const raw = process.env.PENDING_PAYMENT_TTL_MINUTES;
  const n = raw ? parseInt(raw, 10) : DEFAULT_TTL_MINUTES;
  return Number.isFinite(n) && n >= 5 ? n : DEFAULT_TTL_MINUTES;
}

/**
 * Which unpaid orders are past the payment window.
 * Orders whose customer uploaded a JazzCash receipt that is still waiting for admin
 * review are NOT expired (the customer says they paid — the admin decides), and a
 * customer whose receipt was just declined gets one more window to upload again.
 */
export function expiredPendingWhere(cutoff: Date): Prisma.OrderWhereInput {
  return {
    orderStatus: OrderStatus.PENDING_PAYMENT,
    createdAt: { lt: cutoff },
    paymentProofs: {
      none: {
        OR: [
          { status: "PENDING_REVIEW" },
          { status: "REJECTED", reviewedAt: { gte: cutoff } },
        ],
      },
    },
  };
}

/**
 * Cancel abandoned PENDING_PAYMENT orders: release reserved stock + coupon use.
 * Safe to call frequently (idempotent per order). Works through ALL expired orders
 * in batches up to `maxOrders`, so a backlog cannot hide old orders.
 */
export async function expirePendingPayments(opts?: {
  olderThanMinutes?: number;
  /** batch size */
  limit?: number;
  /** stop after this many orders in one run */
  maxOrders?: number;
}) {
  const minutes = opts?.olderThanMinutes ?? pendingPaymentTtlMinutes();
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const batch = Math.max(1, opts?.limit ?? 50);
  const maxOrders = Math.max(batch, opts?.maxOrders ?? batch);

  let scanned = 0;
  let expired = 0;
  const orderNumbers: string[] = [];
  const failedIds = new Set<string>();

  while (scanned < maxOrders) {
    const stale = await prisma.order.findMany({
      where: {
        ...expiredPendingWhere(cutoff),
        ...(failedIds.size ? { id: { notIn: Array.from(failedIds) } } : {}),
      },
      select: { id: true, orderNumber: true },
      orderBy: { createdAt: "asc" },
      take: Math.min(batch, maxOrders - scanned),
    });
    if (!stale.length) break;
    scanned += stale.length;

    for (const order of stale) {
      try {
        const result = await prisma.$transaction((tx) =>
          cancelOrderInTx(tx, order.id, {
            reason: `Auto-cancelled: payment not completed within ${minutes} minutes`,
            onlyIfStatusIn: [OrderStatus.PENDING_PAYMENT],
          })
        );
        if (!result.cancelled) {
          failedIds.add(order.id);
          continue;
        }

        await writeAuditLog({
          userId: null,
          action: "ORDER_PAYMENT_EXPIRED",
          entity: "Order",
          entityId: order.id,
          newValue: {
            orderNumber: order.orderNumber,
            olderThanMinutes: minutes,
          },
        });

        try {
          const { notifyOrderEvent } = await import("@/lib/notifications/service");
          await notifyOrderEvent(
            order.id,
            "ORDER_CANCELLED",
            "Order cancelled",
            `Order ${order.orderNumber} was cancelled because payment was not completed within ${minutes} minutes.`
          );
        } catch {
          /* notification is best effort */
        }

        expired += 1;
        orderNumbers.push(order.orderNumber);
      } catch (e) {
        failedIds.add(order.id);
        console.error("[expirePendingPayments]", order.orderNumber, e);
      }
    }
  }

  return { scanned, expired, orderNumbers, ttlMinutes: minutes };
}

/**
 * Traffic-driven sweep (daily cron is only a backup).
 * Cooldown avoids hammering DB on every cart poll; checkout should use `force`.
 * Callers on serverless should `await` it — a fire-and-forget promise can be
 * frozen once the response is sent.
 */
export async function sweepExpiredPendingPayments(opts?: {
  force?: boolean;
  limit?: number;
}) {
  const now = Date.now();
  if (!opts?.force && now - lastSweepAt < SWEEP_COOLDOWN_MS) {
    return { skipped: true as const };
  }
  lastSweepAt = now;
  const result = await expirePendingPayments({
    limit: opts?.limit ?? 50,
  });
  return { skipped: false as const, ...result };
}
