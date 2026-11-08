/**
 * Super Admin / supervisor COD cash-collection & remittance control center.
 *
 * Read models: platform COD summary, rider-wise cash ledger, order-wise
 * reconciliation, and the pending-submission review queue.
 *
 * Write actions: verify/reject a digital remittance proof, confirm a physical cash
 * handover (supervisor-only, may confirm a partial amount), and manually clear or
 * place a COD restriction. Every write is audit-logged and recomputes the
 * obligation header; a screenshot alone never clears money — only a verified
 * submission does.
 */
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import {
  outstanding,
  recomputeRemittance,
  clearRiderCodRestrictionIfSettled,
  RemittanceError,
} from "@/lib/finance/remittance";
import { notifyRemittanceReviewed, notifyRiderReinstated } from "@/lib/notifications/remittance-events";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function codOverview() {
  const rows = await prisma.cashRemittance.findMany({
    select: { amount: true, amountDue: true, amountRemitted: true, status: true, riderId: true },
  });
  const [restrictedRiders, pendingSubs, rejectedSubs] = await Promise.all([
    prisma.rider.count({ where: { codRestrictedAt: { not: null } } }),
    prisma.remittanceSubmission.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.remittanceSubmission.count({ where: { status: "REJECTED" } }),
  ]);

  let collected = 0, expected = 0, remitted = 0, pending = 0, overdue = 0, partial = 0, underVerification = 0;
  for (const r of rows) {
    const due = toNumber(r.amountDue);
    const rem = toNumber(r.amountRemitted);
    const left = outstanding(due, rem);
    collected += toNumber(r.amount);
    expected += due;
    remitted += rem;
    if (r.status !== "RECEIVED") pending += left;
    if (r.status === "OVERDUE") overdue += left;
    if (r.status === "PARTIALLY_REMITTED") partial += rem;
    if (r.status === "UNDER_VERIFICATION") underVerification += 1;
  }
  return {
    totalCodOrders: rows.length,
    totalCollected: r2(collected),
    totalExpected: r2(expected),
    totalRemitted: r2(remitted),
    totalPending: r2(pending),
    totalOverdue: r2(overdue),
    totalPartiallyRemitted: r2(partial),
    ordersUnderVerification: underVerification,
    pendingSubmissions: pendingSubs,
    rejectedSubmissions: rejectedSubs,
    ridersWithOverdue: restrictedRiders,
  };
}

export async function riderCashLedger() {
  const riders = await prisma.rider.findMany({
    where: { remittances: { some: {} } },
    select: {
      id: true,
      name: true,
      phone: true,
      codRestrictedAt: true,
      codRestrictionReason: true,
      remittances: {
        select: { amount: true, amountDue: true, amountRemitted: true, status: true, dueAt: true, receivedAt: true },
      },
    },
  });
  return riders
    .map((rd) => {
      let collected = 0, due = 0, remitted = 0, outstandingTotal = 0, overdueTotal = 0;
      let lastRemittance: Date | null = null;
      let nextDeadline: Date | null = null;
      for (const r of rd.remittances) {
        const d = toNumber(r.amountDue);
        const rem = toNumber(r.amountRemitted);
        const left = outstanding(d, rem);
        collected += toNumber(r.amount);
        due += d;
        remitted += rem;
        if (r.status !== "RECEIVED") outstandingTotal += left;
        if (r.status === "OVERDUE") overdueTotal += left;
        if (r.receivedAt && (!lastRemittance || r.receivedAt > lastRemittance)) lastRemittance = r.receivedAt;
        if (r.status !== "RECEIVED" && r.dueAt && left > 0.01 && (!nextDeadline || r.dueAt < nextDeadline)) nextDeadline = r.dueAt;
      }
      return {
        riderId: rd.id,
        name: rd.name,
        phone: rd.phone,
        restricted: !!rd.codRestrictedAt,
        restrictionReason: rd.codRestrictionReason,
        collected: r2(collected),
        retained: r2(collected - due),
        due: r2(due),
        remitted: r2(remitted),
        outstanding: r2(outstandingTotal),
        overdue: r2(overdueTotal),
        lastRemittance,
        nextDeadline,
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);
}

export async function codReconciliation(opts: { status?: string; limit?: number } = {}) {
  const where =
    opts.status && ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED", "RECEIVED", "OVERDUE", "DISPUTED"].includes(opts.status)
      ? { status: opts.status as never }
      : {};
  const rows = await prisma.cashRemittance.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(opts.limit ?? 200, 1000),
    include: {
      rider: { select: { id: true, name: true } },
      order: {
        select: {
          orderNumber: true,
          subtotal: true,
          discount: true,
          deliveryFee: true,
          customer: { select: { fullName: true } },
          items: { select: { storeId: true, store: { select: { name: true } } } },
        },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        select: { id: true, method: true, amount: true, status: true, reference: true, proofUrl: true, rejectionReason: true, createdAt: true },
      },
    },
  });
  return rows.map((r) => {
    const due = toNumber(r.amountDue);
    const rem = toNumber(r.amountRemitted);
    const storeNames = Array.from(new Set((r.order?.items || []).map((i) => i.store?.name).filter(Boolean))) as string[];
    return {
      id: r.id,
      orderNumber: r.order?.orderNumber ?? r.orderId,
      customer: r.order?.customer?.fullName ?? null,
      stores: storeNames,
      rider: r.rider ? { id: r.rider.id, name: r.rider.name } : null,
      productSubtotal: toNumber(r.order?.subtotal ?? 0),
      discount: toNumber(r.order?.discount ?? 0),
      deliveryFee: toNumber(r.order?.deliveryFee ?? 0),
      collected: toNumber(r.amount),
      riderRetained: r2(toNumber(r.amount) - due),
      amountDue: due,
      amountRemitted: rem,
      outstanding: outstanding(due, rem),
      status: r.status,
      dueAt: r.dueAt,
      submissions: r.submissions.map((s) => ({ ...s, amount: toNumber(s.amount) })),
    };
  });
}

/** The review queue: submissions awaiting a supervisor decision. */
export async function pendingRemittanceSubmissions() {
  const subs = await prisma.remittanceSubmission.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      remittance: {
        select: {
          id: true, amountDue: true, amountRemitted: true, status: true, dueAt: true,
          order: { select: { orderNumber: true } },
          rider: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });
  return subs.map((s) => ({
    id: s.id,
    method: s.method,
    amount: toNumber(s.amount),
    proofUrl: s.proofUrl,
    reference: s.reference,
    createdAt: s.createdAt,
    remittanceId: s.remittanceId,
    orderNumber: s.remittance.order?.orderNumber ?? null,
    rider: s.remittance.rider ? { id: s.remittance.rider.id, name: s.remittance.rider.name, phone: s.remittance.rider.phone } : null,
    outstanding: outstanding(toNumber(s.remittance.amountDue), toNumber(s.remittance.amountRemitted)),
    dueAt: s.remittance.dueAt,
  }));
}

/**
 * Verify (approve) or reject a digital remittance submission. Approving records the
 * money as actually received; rejecting keeps the obligation owed and lets the rider
 * resubmit. A rejected proof NEVER reduces the balance.
 */
export async function reviewSubmission(
  adminId: string,
  submissionId: string,
  decision: "APPROVE" | "REJECT",
  opts: { rejectionReason?: string } = {}
) {
  return reviewOrConfirm(adminId, submissionId, decision, { reason: opts.rejectionReason });
}

/**
 * Supervisor confirms a physical cash handover. May confirm a partial amount (the
 * actual cash received), which can differ from what the rider claimed. Confirming
 * records the money; not confirming leaves it owed.
 */
export async function confirmCashHandover(
  adminId: string,
  submissionId: string,
  decision: "APPROVE" | "REJECT",
  opts: { confirmedAmount?: number; rejectionReason?: string } = {}
) {
  return reviewOrConfirm(adminId, submissionId, decision, {
    reason: opts.rejectionReason,
    confirmedAmount: opts.confirmedAmount,
    requireHandover: true,
  });
}

async function reviewOrConfirm(
  adminId: string,
  submissionId: string,
  decision: "APPROVE" | "REJECT",
  opts: { reason?: string; confirmedAmount?: number; requireHandover?: boolean }
) {
  const result = await prisma.$transaction(async (tx) => {
    const sub = await tx.remittanceSubmission.findUnique({
      where: { id: submissionId },
      include: { remittance: { select: { id: true, riderId: true, orderId: true, amountDue: true, amountRemitted: true } } },
    });
    if (!sub) throw new RemittanceError("NOT_FOUND", "Submission not found.");
    if (sub.status !== "PENDING_REVIEW") throw new RemittanceError("DONE", "This submission was already reviewed.");
    if (opts.requireHandover && sub.method !== "CASH_HANDOVER") {
      throw new RemittanceError("WRONG_METHOD", "This is not a cash handover.");
    }
    if (!opts.requireHandover && sub.method === "CASH_HANDOVER") {
      throw new RemittanceError("WRONG_METHOD", "A cash handover must be confirmed by a supervisor, not approved as a digital proof.");
    }

    let amount = toNumber(sub.amount);
    if (decision === "REJECT") {
      await tx.remittanceSubmission.update({
        where: { id: submissionId },
        data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), rejectionReason: (opts.reason || "Not verified").slice(0, 300) },
      });
    } else {
      // Supervisor may confirm a different (partial) cash amount than claimed; never
      // more than what is still owed on the obligation.
      if (opts.requireHandover && typeof opts.confirmedAmount === "number" && opts.confirmedAmount > 0) {
        amount = r2(opts.confirmedAmount);
      }
      const left = outstanding(toNumber(sub.remittance.amountDue), toNumber(sub.remittance.amountRemitted));
      if (amount > left + 0.01) throw new RemittanceError("TOO_MUCH", `Only Rs ${left} is still owed.`);
      await tx.remittanceSubmission.update({
        where: { id: submissionId },
        data: { status: "APPROVED", amount, reviewedById: adminId, reviewedAt: new Date() },
      });
    }

    const wasRestricted = sub.remittance.riderId
      ? !!(await tx.rider.findUnique({ where: { id: sub.remittance.riderId }, select: { codRestrictedAt: true } }))?.codRestrictedAt
      : false;
    await recomputeRemittance(tx, sub.remittance.id);
    if (sub.remittance.riderId) await clearRiderCodRestrictionIfSettled(tx, sub.remittance.riderId);
    const nowRestricted = sub.remittance.riderId
      ? !!(await tx.rider.findUnique({ where: { id: sub.remittance.riderId }, select: { codRestrictedAt: true } }))?.codRestrictedAt
      : false;

    await writeAuditLog({
      userId: adminId,
      action: decision === "APPROVE" ? (opts.requireHandover ? "REMITTANCE_HANDOVER_CONFIRMED" : "REMITTANCE_PROOF_APPROVED") : "REMITTANCE_PROOF_REJECTED",
      entity: "RemittanceSubmission",
      entityId: submissionId,
      previousValue: { status: "PENDING_REVIEW" },
      newValue: { decision, reason: opts.reason ?? null, confirmedAmount: opts.confirmedAmount ?? null },
    });
    return {
      ok: true as const,
      riderId: sub.remittance.riderId,
      orderId: sub.remittance.orderId,
      amount,
      approved: decision === "APPROVE",
      reason: opts.reason ?? null,
      reinstated: wasRestricted && !nowRestricted,
    };
  });

  // Best-effort notifications, after commit.
  await notifyRemittanceReviewed({
    orderId: result.orderId,
    riderId: result.riderId,
    approved: result.approved,
    amount: result.amount,
    reason: result.reason,
  });
  if (result.reinstated && result.riderId) await notifyRiderReinstated(result.riderId);
  return { ok: true as const };
}

/**
 * Authoritative one-shot "mark fully received" for the whole obligation (the legacy
 * admin action routes here). Records an APPROVED submission for the remaining
 * outstanding balance — never double-counting money already verified — then
 * recomputes the header (→ RECEIVED) and clears any COD restriction. Audited.
 */
export async function markRemittanceReceived(
  adminId: string,
  remittanceId: string,
  opts: { method?: "CASH_HANDOVER" | "BANK" | "JAZZCASH"; notes?: string } = {}
) {
  const res = await prisma.$transaction(async (tx) => {
    const remit = await tx.cashRemittance.findUnique({
      where: { id: remittanceId },
      select: { id: true, riderId: true, amountDue: true, amountRemitted: true, status: true },
    });
    if (!remit) throw new RemittanceError("NOT_FOUND", "Remittance not found.");
    if (remit.status === "RECEIVED") throw new RemittanceError("DONE", "Already marked as received.");
    if (remit.status === "DISPUTED") throw new RemittanceError("DISPUTED", "Resolve the dispute before receiving.");
    const wasRestricted = remit.riderId
      ? !!(await tx.rider.findUnique({ where: { id: remit.riderId }, select: { codRestrictedAt: true } }))?.codRestrictedAt
      : false;

    const left = outstanding(Number(remit.amountDue), Number(remit.amountRemitted));
    if (left > 0.01) {
      // Settle the remaining balance as a verified receipt (no double-count: only the
      // unremitted part is recorded).
      await tx.remittanceSubmission.create({
        data: {
          remittanceId: remit.id,
          riderId: remit.riderId,
          method: opts.method ?? "CASH_HANDOVER",
          amount: left,
          reference: `ADMIN-RECV-${Date.now().toString(36).toUpperCase()}`,
          status: "APPROVED",
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
    }
    await tx.cashRemittance.update({
      where: { id: remit.id },
      data: { receivedById: adminId, notes: opts.notes?.slice(0, 500) ?? undefined },
    });
    await recomputeRemittance(tx, remit.id);
    if (remit.riderId) await clearRiderCodRestrictionIfSettled(tx, remit.riderId);

    await writeAuditLog({
      userId: adminId,
      action: "REMITTANCE_RECEIVED",
      entity: "CashRemittance",
      entityId: remit.id,
      previousValue: { status: remit.status, amountRemitted: Number(remit.amountRemitted) },
      newValue: { status: "RECEIVED", settledRemaining: left },
    });
    return { ok: true, settledRemaining: r2(left), riderId: remit.riderId, wasRestricted };
  });
  if (res.wasRestricted && res.riderId) await notifyRiderReinstated(res.riderId);
  return { ok: res.ok, settledRemaining: res.settledRemaining };
}

/** Manual supervisor override: lift a COD restriction (e.g. settled offline / dispute resolved). */
export async function clearRiderRestriction(adminId: string, riderId: string, reason: string) {
  const rider = await prisma.rider.findUnique({ where: { id: riderId }, select: { codRestrictedAt: true } });
  if (!rider?.codRestrictedAt) throw new RemittanceError("NOT_RESTRICTED", "This rider isn't restricted.");
  await prisma.rider.update({ where: { id: riderId }, data: { codRestrictedAt: null, codRestrictionReason: null } });
  await writeAuditLog({
    userId: adminId,
    action: "RIDER_COD_RESTRICTION_CLEARED",
    entity: "Rider",
    entityId: riderId,
    newValue: { reason: reason.slice(0, 300) },
  });
  await notifyRiderReinstated(riderId);
  return { ok: true };
}
