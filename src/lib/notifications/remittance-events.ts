/**
 * COD remittance notifications (spec §14). In-app now; SMS/email ride the same
 * service when a provider is configured. All helpers are best-effort — they never
 * block or fail the financial path — and dedup where a backend job may re-run.
 */
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { sendNotification, notifySuperAdminsInApp } from "@/lib/notifications/service";

async function riderUserId(riderId: string | null | undefined): Promise<string | null> {
  if (!riderId) return null;
  const r = await prisma.rider.findUnique({ where: { id: riderId }, select: { userId: true } });
  return r?.userId ?? null;
}

/** True if a notification of this type already exists for this order+user (dedup). */
async function already(type: string, userId: string | null, orderId: string | null): Promise<boolean> {
  if (!userId || !orderId) return false;
  const n = await prisma.notification.count({ where: { type, userId, orderId } });
  return n > 0;
}

export async function notifyCodCollected(orderId: string): Promise<void> {
  try {
    await notifySuperAdminsInApp({
      type: "COD_COLLECTED",
      title: "New COD cash collected",
      body: "A rider collected COD cash — a remittance is now due.",
      metadata: { orderId },
    });
  } catch (e) { console.error("[notify:cod-collected]", e); }
}

export async function notifyRemittanceSubmitted(opts: {
  orderId: string | null;
  riderId: string | null;
  method: string;
  amount: number;
}): Promise<void> {
  try {
    const handover = opts.method === "CASH_HANDOVER";
    await notifySuperAdminsInApp({
      type: handover ? "REMITTANCE_HANDOVER_PENDING" : "REMITTANCE_SUBMITTED",
      title: handover ? "Cash handover awaiting confirmation" : "Remittance submitted for verification",
      body: `${formatCurrency(opts.amount)} ${handover ? "handover" : "payment"} needs your review.`,
      metadata: { orderId: opts.orderId, method: opts.method },
    });
    const uid = await riderUserId(opts.riderId);
    if (uid) {
      await sendNotification({
        userId: uid,
        orderId: opts.orderId ?? undefined,
        type: "REMITTANCE_SUBMITTED",
        title: "Remittance submitted",
        body: `Your ${formatCurrency(opts.amount)} submission is awaiting MandiBazaar verification.`,
      });
    }
  } catch (e) { console.error("[notify:remittance-submitted]", e); }
}

export async function notifyRemittanceReviewed(opts: {
  orderId: string | null;
  riderId: string | null;
  approved: boolean;
  amount: number;
  reason?: string | null;
}): Promise<void> {
  try {
    const uid = await riderUserId(opts.riderId);
    if (!uid) return;
    await sendNotification({
      userId: uid,
      orderId: opts.orderId ?? undefined,
      type: opts.approved ? "REMITTANCE_APPROVED" : "REMITTANCE_REJECTED",
      title: opts.approved ? "Remittance verified" : "Remittance rejected",
      body: opts.approved
        ? `MandiBazaar verified ${formatCurrency(opts.amount)} received.`
        : `Your ${formatCurrency(opts.amount)} submission was rejected${opts.reason ? `: ${opts.reason}` : ""}. You can submit again.`,
    });
  } catch (e) { console.error("[notify:remittance-reviewed]", e); }
}

export async function notifyRemittanceOverdue(riderId: string, amount: number, orderId: string | null): Promise<void> {
  try {
    const uid = await riderUserId(riderId);
    if (uid && !(await already("REMITTANCE_OVERDUE", uid, orderId))) {
      await sendNotification({
        userId: uid,
        orderId: orderId ?? undefined,
        type: "REMITTANCE_OVERDUE",
        title: "COD remittance overdue — deliveries paused",
        body: `Settle ${formatCurrency(amount)} to resume taking new deliveries.`,
      });
    }
    await notifySuperAdminsInApp({
      type: "RIDER_OVERDUE",
      title: "Rider overdue on COD remittance",
      body: `A rider is overdue by ${formatCurrency(amount)} and has been restricted.`,
      metadata: { riderId, orderId },
    });
  } catch (e) { console.error("[notify:remittance-overdue]", e); }
}

export async function notifyRemittanceDueSoon(riderId: string, amount: number, orderId: string | null): Promise<void> {
  try {
    const uid = await riderUserId(riderId);
    if (!uid || (await already("REMITTANCE_DUE_SOON", uid, orderId))) return;
    await sendNotification({
      userId: uid,
      orderId: orderId ?? undefined,
      type: "REMITTANCE_DUE_SOON",
      title: "COD remittance due soon",
      body: `${formatCurrency(amount)} is due soon. Submit it from Cash → MandiBazaar to avoid a restriction.`,
    });
  } catch (e) { console.error("[notify:remittance-due-soon]", e); }
}

export async function notifyRiderReinstated(riderId: string): Promise<void> {
  try {
    const uid = await riderUserId(riderId);
    if (!uid) return;
    await sendNotification({
      userId: uid,
      type: "RIDER_REINSTATED",
      title: "You're back on — deliveries resumed",
      body: "Your COD cash is settled. You can take new deliveries again.",
    });
  } catch (e) { console.error("[notify:rider-reinstated]", e); }
}
