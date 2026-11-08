/**
 * COD cash-collection → remittance lifecycle.
 *
 * When a rider collects COD cash they RETAIN their agreed delivery fee and must
 * remit the remainder (the product money) to MandiBazaar within a deadline
 * (StoreSettings.remittanceDeadlineHours, default 48h). Remittance can be partial
 * (several verified submissions) and is only ever cleared by an authorized
 * Super Admin / supervisor verifying actual receipt — never by a screenshot alone.
 *
 * The rider is NEVER charged the store's 5% commission here; that is deducted from
 * the store's earnings elsewhere. The rider only owes the product cash they are
 * holding on the platform's behalf.
 *
 * Pure helpers (no DB) are unit-tested in tests/remittance.test.ts.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  notifyRemittanceSubmitted,
  notifyRemittanceOverdue,
  notifyRemittanceDueSoon,
} from "@/lib/notifications/remittance-events";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const DEFAULT_REMITTANCE_DEADLINE_HOURS = 48;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Amount the rider must remit = cash collected − delivery fee they retain (never < 0). */
export function remittanceDue(collected: number, retainedDeliveryFee: number): number {
  return r2(Math.max(0, (Number(collected) || 0) - Math.max(0, Number(retainedDeliveryFee) || 0)));
}

/** Outstanding = due − already verified-remitted (never < 0). */
export function outstanding(amountDue: number, amountRemitted: number): number {
  return r2(Math.max(0, (Number(amountDue) || 0) - (Number(amountRemitted) || 0)));
}

/** Backend deadline from the collection time. */
export function deadlineFrom(collectedAt: Date, hours = DEFAULT_REMITTANCE_DEADLINE_HOURS): Date {
  return new Date(collectedAt.getTime() + Math.max(1, hours) * 3_600_000);
}

export type Countdown = { msLeft: number; overdue: boolean; dueAt: Date | null };

/** Live countdown from the backend deadline (device clock is never trusted). */
export function remittanceCountdown(dueAt: Date | null, now: Date = new Date()): Countdown {
  if (!dueAt) return { msLeft: 0, overdue: false, dueAt: null };
  const msLeft = dueAt.getTime() - now.getTime();
  return { msLeft: Math.max(0, msLeft), overdue: msLeft <= 0, dueAt };
}

export type RemittanceStatusName =
  | "PENDING"
  | "SUBMITTED"
  | "UNDER_VERIFICATION"
  | "PARTIALLY_REMITTED"
  | "RECEIVED"
  | "REJECTED"
  | "OVERDUE"
  | "DISPUTED";

/**
 * Derive the obligation's header status from its amounts, deadline and whether a
 * submission is awaiting review. Terminal states (RECEIVED/DISPUTED) are preserved.
 */
export function deriveRemittanceStatus(opts: {
  current: RemittanceStatusName;
  amountDue: number;
  amountRemitted: number;
  dueAt: Date | null;
  hasPendingSubmission: boolean;
  now?: Date;
}): RemittanceStatusName {
  const { current, amountDue, amountRemitted, dueAt, hasPendingSubmission } = opts;
  const now = opts.now ?? new Date();
  if (current === "DISPUTED") return "DISPUTED";
  const left = outstanding(amountDue, amountRemitted);
  // Nothing owed — fully remitted, or the obligation was reduced to zero by an
  // authorized refund adjustment. Either way it is closed.
  if (left <= 0.001) return "RECEIVED";
  if (amountRemitted > 0.001) {
    // Some verified money in, balance remains.
    if (dueAt && now.getTime() > dueAt.getTime()) return "OVERDUE";
    return "PARTIALLY_REMITTED";
  }
  if (hasPendingSubmission) return "UNDER_VERIFICATION";
  if (dueAt && now.getTime() > dueAt.getTime()) return "OVERDUE";
  return "PENDING";
}

/** A rider is COD-restricted while any remittance is overdue and unsettled. */
export function isCodOverdue(dueAt: Date | null, amountDue: number, amountRemitted: number, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  return now.getTime() > dueAt.getTime() && outstanding(amountDue, amountRemitted) > 0.001;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function remittanceDeadlineHours(db: Db = prisma): Promise<number> {
  const s = await db.storeSettings.findFirst({ select: { remittanceDeadlineHours: true } });
  const h = s?.remittanceDeadlineHours ?? DEFAULT_REMITTANCE_DEADLINE_HOURS;
  return h > 0 ? h : DEFAULT_REMITTANCE_DEADLINE_HOURS;
}

/**
 * Recompute a remittance header after a submission changes. Idempotent: reads the
 * sum of APPROVED submissions as the source of truth for amountRemitted, then
 * derives status. Clears the rider's COD restriction once fully settled.
 * Call inside the transaction that approved/rejected the submission.
 */
export async function recomputeRemittance(db: Db, remittanceId: string): Promise<void> {
  const remit = await db.cashRemittance.findUnique({
    where: { id: remittanceId },
    select: { id: true, riderId: true, amountDue: true, dueAt: true, status: true },
  });
  if (!remit) return;

  const [approved, pending] = await Promise.all([
    db.remittanceSubmission.aggregate({
      where: { remittanceId, status: "APPROVED" },
      _sum: { amount: true },
    }),
    db.remittanceSubmission.count({ where: { remittanceId, status: "PENDING_REVIEW" } }),
  ]);
  const amountRemitted = r2(Number(approved._sum.amount ?? 0));
  const amountDue = Number(remit.amountDue);

  const status = deriveRemittanceStatus({
    current: remit.status as RemittanceStatusName,
    amountDue,
    amountRemitted,
    dueAt: remit.dueAt,
    hasPendingSubmission: pending > 0,
  });

  await db.cashRemittance.update({
    where: { id: remittanceId },
    data: {
      amountRemitted,
      status,
      ...(status === "RECEIVED" ? { receivedAt: new Date() } : {}),
    },
  });

  // Settling the obligation may lift a COD restriction.
  if (status === "RECEIVED" && remit.riderId) {
    await clearRiderCodRestrictionIfSettled(db, remit.riderId);
  }
}

/** Clear a rider's COD restriction only when they have no remaining unsettled overdue cash. */
export async function clearRiderCodRestrictionIfSettled(db: Db, riderId: string): Promise<boolean> {
  const rider = await db.rider.findUnique({ where: { id: riderId }, select: { codRestrictedAt: true } });
  if (!rider?.codRestrictedAt) return false;
  const stillOwing = await db.cashRemittance.findFirst({
    where: {
      riderId,
      status: { in: ["OVERDUE", "PARTIALLY_REMITTED", "SUBMITTED", "UNDER_VERIFICATION", "PENDING"] },
      dueAt: { lt: new Date() },
    },
    select: { id: true, amountDue: true, amountRemitted: true },
  });
  if (stillOwing && outstanding(Number(stillOwing.amountDue), Number(stillOwing.amountRemitted)) > 0.001) {
    return false;
  }
  await db.rider.update({ where: { id: riderId }, data: { codRestrictedAt: null, codRestrictionReason: null } });
  return true;
}

export class RemittanceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RemittanceError";
  }
}

export type RemittanceMethodName = "CASH_HANDOVER" | "BANK" | "JAZZCASH";

/**
 * A rider submits a remittance payment (digital proof or a cash-handover request).
 * Validated and idempotent: amount must be > 0 and ≤ outstanding; one pending
 * submission at a time; digital methods need proof; cash handover gets a generated
 * reference. The submission is PENDING_REVIEW — it NEVER clears the obligation until
 * an authorized Super Admin / supervisor verifies actual receipt.
 */
export async function createRemittanceSubmission(opts: {
  riderId: string;
  remittanceId: string;
  method: RemittanceMethodName;
  amount: number;
  proofUrl?: string | null;
  reference?: string | null;
}): Promise<{ id: string; reference: string | null; status: string }> {
  const amount = r2(Number(opts.amount) || 0);
  if (amount <= 0) throw new RemittanceError("BAD_AMOUNT", "Enter a valid amount.");

  const remit = await prisma.cashRemittance.findUnique({
    where: { id: opts.remittanceId },
    select: { id: true, riderId: true, orderId: true, amountDue: true, amountRemitted: true, status: true },
  });
  if (!remit || remit.riderId !== opts.riderId) {
    throw new RemittanceError("NOT_FOUND", "That remittance isn't available.");
  }
  if (remit.status === "RECEIVED") throw new RemittanceError("DONE", "This remittance is already settled.");
  if (remit.status === "DISPUTED") throw new RemittanceError("DISPUTED", "This remittance is disputed — contact support.");

  const left = outstanding(Number(remit.amountDue), Number(remit.amountRemitted));
  if (amount > left + 0.01) {
    throw new RemittanceError("TOO_MUCH", `You only owe Rs ${left.toLocaleString("en-PK")} on this order.`);
  }

  const digital = opts.method === "BANK" || opts.method === "JAZZCASH";
  if (digital && !opts.proofUrl) {
    throw new RemittanceError("PROOF_REQUIRED", "Please attach a payment screenshot.");
  }

  // One pending submission at a time (prevents duplicate / double-click submissions).
  const pending = await prisma.remittanceSubmission.count({
    where: { remittanceId: remit.id, status: "PENDING_REVIEW" },
  });
  if (pending > 0) {
    throw new RemittanceError("ALREADY_PENDING", "A submission is already awaiting verification.");
  }

  const reference =
    opts.method === "CASH_HANDOVER"
      ? `HND-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      : opts.reference?.trim()?.slice(0, 80) || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sub = await tx.remittanceSubmission.create({
        data: {
          remittanceId: remit.id,
          riderId: opts.riderId,
          method: opts.method,
          amount,
          proofUrl: opts.proofUrl ?? null,
          reference,
          status: "PENDING_REVIEW",
        },
      });
      await tx.cashRemittance.update({
        where: { id: remit.id },
        data: { submittedAt: new Date() },
      });
      await recomputeRemittance(tx, remit.id);
      return { id: sub.id, reference, status: "PENDING_REVIEW" };
    });
    // Best-effort, after commit — never blocks the money path.
    await notifyRemittanceSubmitted({ orderId: remit.orderId, riderId: opts.riderId, method: opts.method, amount });
    return result;
  } catch (e) {
    // Unique reference collision = duplicate transaction id.
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      throw new RemittanceError("DUP_REFERENCE", "That transaction reference was already used.");
    }
    throw e;
  }
}

/** The rider's COD obligations with live (backend) countdown + submission history. */
export async function riderRemittanceList(riderId: string) {
  const rows = await prisma.cashRemittance.findMany({
    where: { riderId },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      order: { select: { orderNumber: true, customer: { select: { fullName: true } } } },
      submissions: {
        orderBy: { createdAt: "desc" },
        select: { id: true, method: true, amount: true, status: true, reference: true, rejectionReason: true, createdAt: true, reviewedAt: true },
      },
    },
  });

  const now = new Date();
  const items = rows.map((r) => {
    const amountDue = Number(r.amountDue);
    const amountRemitted = Number(r.amountRemitted);
    const left = outstanding(amountDue, amountRemitted);
    const cd = remittanceCountdown(r.dueAt, now);
    return {
      id: r.id,
      orderNumber: r.order?.orderNumber ?? r.orderId,
      customer: r.order?.customer?.fullName ?? null,
      collected: Number(r.amount),
      amountDue,
      amountRemitted,
      outstanding: left,
      status: r.status,
      collectedAt: r.collectedAt,
      dueAt: r.dueAt,
      msLeft: cd.msLeft,
      overdue: cd.overdue && left > 0.01,
      // Digital receipt once fully settled (derived — stable per obligation).
      receiptNo: r.status === "RECEIVED" ? `RCPT-${r.id.slice(-8).toUpperCase()}` : null,
      receivedAt: r.receivedAt,
      submissions: r.submissions.map((s) => ({
        id: s.id,
        method: s.method,
        amount: Number(s.amount),
        status: s.status,
        reference: s.reference,
        rejectionReason: s.rejectionReason,
        createdAt: s.createdAt,
        reviewedAt: s.reviewedAt,
      })),
    };
  });

  const totals = items.reduce(
    (a, i) => {
      if (i.status !== "RECEIVED") a.outstandingTotal += i.outstanding;
      if (i.overdue) a.overdueTotal += i.outstanding;
      return a;
    },
    { outstandingTotal: 0, overdueTotal: 0 }
  );
  return { items, outstandingTotal: r2(totals.outstandingTotal), overdueTotal: r2(totals.overdueTotal) };
}

/**
 * The rider's COD cash position for their dashboard. Keeps the distinct concepts
 * separate (spec §9): cash collected vs retained delivery fee vs money owed to the
 * platform vs overdue — these must never be mixed, and none of them is the rider's
 * delivery earnings/payout.
 */
export async function riderCashSummary(riderId: string) {
  const [rows, rider] = await Promise.all([
    prisma.cashRemittance.findMany({
      where: { riderId },
      select: { amount: true, amountDue: true, amountRemitted: true, status: true },
    }),
    prisma.rider.findUnique({ where: { id: riderId }, select: { codRestrictedAt: true } }),
  ]);
  let cashCollected = 0, owed = 0, overdue = 0, retained = 0;
  for (const r of rows) {
    const collected = Number(r.amount);
    const due = Number(r.amountDue);
    const left = outstanding(due, Number(r.amountRemitted));
    cashCollected += collected;
    retained += Math.max(0, collected - due);
    if (r.status !== "RECEIVED") owed += left;
    if (r.status === "OVERDUE") overdue += left;
  }
  return {
    cashCollected: r2(cashCollected),
    cashRetained: r2(retained),
    owedToPlatform: r2(owed),
    overdue: r2(overdue),
    restricted: !!rider?.codRestrictedAt,
  };
}

/**
 * Refund/return of a COD order: reduce the rider's remittance obligation by the
 * refunded PRODUCT amount via an authorized, recorded adjustment — never silently
 * erase it (spec §6F). The reduction is capped so it can never drop below what the
 * rider already verified-remitted (that cash is with the platform and is handled by
 * the refund ledger instead). Call inside the refund transaction.
 */
export async function adjustRemittanceForRefund(
  db: Db,
  opts: { orderId: string; refundedProductAmount: number; refundId?: string | null }
): Promise<void> {
  const refunded = r2(Math.max(0, Number(opts.refundedProductAmount) || 0));
  if (refunded <= 0) return;
  const remit = await db.cashRemittance.findUnique({
    where: { orderId: opts.orderId },
    select: { id: true, riderId: true, amountDue: true, amountRemitted: true, status: true, notes: true },
  });
  if (!remit) return;
  // Already fully received → the platform holds the cash; the refund ledger reverses
  // store earnings, the rider owes nothing more. Leave the obligation intact.
  if (remit.status === "RECEIVED") return;

  const amountDue = Number(remit.amountDue);
  const amountRemitted = Number(remit.amountRemitted);
  const newDue = Math.max(amountRemitted, r2(amountDue - refunded));
  if (newDue >= amountDue) return;

  const note = `Reduced by refund ${opts.refundId ?? ""} (−Rs ${r2(amountDue - newDue).toLocaleString("en-PK")})`.trim();
  await db.cashRemittance.update({
    where: { id: remit.id },
    data: { amountDue: newDue, notes: [remit.notes, note].filter(Boolean).join(" · ").slice(0, 500) },
  });
  await recomputeRemittance(db, remit.id);
  if (remit.riderId) await clearRiderCodRestrictionIfSettled(db, remit.riderId);
}

export type OverdueSweepResult = { markedOverdue: number; ridersRestricted: number };

/**
 * Backend sweep (scheduled job): mark past-deadline unsettled remittances OVERDUE
 * and restrict their riders from new assignments. Idempotent and safe to re-run.
 * Never depends on a browser being open.
 */
export async function sweepOverdueRemittances(now: Date = new Date()): Promise<OverdueSweepResult> {
  const due = await prisma.cashRemittance.findMany({
    where: {
      dueAt: { lt: now },
      status: { in: ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED"] },
    },
    select: { id: true, riderId: true, orderId: true, amountDue: true, amountRemitted: true },
  });

  let markedOverdue = 0;
  const ridersToRestrict = new Set<string>();
  const overdueInfo: { riderId: string; amount: number; orderId: string | null }[] = [];
  for (const r of due) {
    const left = outstanding(Number(r.amountDue), Number(r.amountRemitted));
    if (left <= 0.001) continue;
    await prisma.cashRemittance.update({ where: { id: r.id }, data: { status: "OVERDUE" } });
    markedOverdue++;
    if (r.riderId) {
      ridersToRestrict.add(r.riderId);
      overdueInfo.push({ riderId: r.riderId, amount: left, orderId: r.orderId });
    }
  }

  let ridersRestricted = 0;
  for (const riderId of Array.from(ridersToRestrict)) {
    const res = await prisma.rider.updateMany({
      where: { id: riderId, codRestrictedAt: null },
      data: {
        codRestrictedAt: now,
        codRestrictionReason: "Overdue COD remittance — settle to resume taking deliveries.",
      },
    });
    ridersRestricted += res.count;
  }

  // Notifications (best-effort, after state is committed; deduped per order).
  for (const o of overdueInfo) await notifyRemittanceOverdue(o.riderId, o.amount, o.orderId);

  // "Due soon" reminders for obligations inside the final window (default 6h),
  // not yet overdue — deduped so re-runs don't spam.
  const soonCutoff = new Date(now.getTime() + 6 * 3_600_000);
  const dueSoon = await prisma.cashRemittance.findMany({
    where: {
      dueAt: { gte: now, lt: soonCutoff },
      status: { in: ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED"] },
    },
    select: { riderId: true, orderId: true, amountDue: true, amountRemitted: true },
  });
  for (const r of dueSoon) {
    const left = outstanding(Number(r.amountDue), Number(r.amountRemitted));
    if (left > 0.01 && r.riderId) await notifyRemittanceDueSoon(r.riderId, left, r.orderId);
  }
  return { markedOverdue, ridersRestricted };
}
