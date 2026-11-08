import { PaymentMethod, Prisma, RefundStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { recordOrderRefundLedger } from "@/lib/finance/ledger";
import { adjustRemittanceForRefund } from "@/lib/finance/remittance";

const IN_FLIGHT: RefundStatus[] = ["PENDING", "APPROVED", "PROCESSING"];
const OPEN_OR_DONE: RefundStatus[] = [
  "PENDING",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
];

export type RefundableSummary = {
  orderId: string;
  orderNumber: string;
  successPaid: number;
  refundedOrReserved: number;
  refundable: number;
  payments: {
    id: string;
    method: PaymentMethod;
    amount: number;
    status: string;
    providerTxnId: string | null;
    latePayment: boolean;
  }[];
  openRefunds: number;
};

function metaObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function isLatePaymentMeta(raw: unknown): boolean {
  return Boolean(metaObject(raw).latePaymentOnTerminalOrder);
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Pure: money captured online minus refunds already open or done (never negative). */
export function refundableAmount(
  payments: { type?: string; status: string; amount: number }[],
  refunds: { status: string; amount: number }[]
) {
  const successPaid = payments
    .filter((p) => p.type !== "REFUND" && (p.status === "SUCCESS" || p.status === "REFUNDED"))
    .reduce((s, p) => s + p.amount, 0);
  const refundedOrReserved = refunds
    .filter((r) => (OPEN_OR_DONE as string[]).includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  return {
    successPaid: Math.round(successPaid * 100) / 100,
    refundedOrReserved: Math.round(refundedOrReserved * 100) / 100,
    refundable: Math.max(0, Math.round((successPaid - refundedOrReserved) * 100) / 100),
  };
}

/** SUCCESS online payments minus open/completed refunds. */
export async function getRefundableSummary(
  orderIdOrNumber: string,
  db: Db = prisma
): Promise<RefundableSummary | null> {
  const order = await db.order.findFirst({
    where: {
      OR: [{ id: orderIdOrNumber }, { orderNumber: orderIdOrNumber }],
    },
    include: {
      payments: true,
      refunds: {
        where: { status: { in: OPEN_OR_DONE } },
      },
    },
  });
  if (!order) return null;

  // REFUNDED = captured, then (fully) refunded — still counts as paid here, the
  // refund rows below subtract it, so a fully refunded payment cannot be refunded again
  // and a partly refunded one keeps the right remainder.
  const successPayments = order.payments
    .filter((p) => p.type !== "REFUND" && (p.status === "SUCCESS" || p.status === "REFUNDED"))
    // pick not-yet-refunded payments first when choosing which one to refund
    .sort((a, b) => (a.status === "SUCCESS" ? 0 : 1) - (b.status === "SUCCESS" ? 0 : 1));
  const { successPaid, refundedOrReserved, refundable } = refundableAmount(
    successPayments.map((p) => ({ type: p.type, status: p.status, amount: toNumber(p.amount) })),
    order.refunds.map((r) => ({ status: r.status, amount: toNumber(r.amount) }))
  );

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    successPaid,
    refundedOrReserved,
    refundable,
    openRefunds: order.refunds.filter((r) =>
      IN_FLIGHT.includes(r.status)
    ).length,
    payments: successPayments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: toNumber(p.amount),
      status: p.status,
      providerTxnId: p.providerTxnId,
      latePayment: isLatePaymentMeta(p.metadata),
    })),
  };
}

function pickPaymentForRefund(
  payments: {
    id: string;
    method: PaymentMethod;
    amount: number;
    providerTxnId: string | null;
    latePayment: boolean;
  }[],
  amount: number
) {
  const stripe = payments.find(
    (p) => p.method === "STRIPE" && p.providerTxnId && p.amount >= amount - 0.01
  );
  if (stripe) return stripe;
  const anyStripe = payments.find(
    (p) => p.method === "STRIPE" && p.providerTxnId
  );
  if (anyStripe) return anyStripe;
  return payments[0] || null;
}

export async function createRefundRecord(opts: {
  orderId: string;
  amount?: number;
  reason: string;
  notes?: string | null;
  requestedById?: string | null;
  /** Skip if an in-flight refund already exists (customer cancel). */
  allowParallel?: boolean;
  preferredPaymentId?: string | null;
  autoApprove?: boolean;
}): Promise<
  | { ok: true; refundId: string; amount: number; status: RefundStatus }
  | { ok: false; error: string }
> {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (opts.amount != null && (!Number.isFinite(opts.amount) || opts.amount < 0)) {
    return { ok: false, error: "Refund amount must be a positive number" };
  }
  const reason = (opts.reason || "").trim();
  if (reason.length < 3) return { ok: false, error: "Please give a reason for the refund" };

  // Lock the order so two refund requests at once cannot both pass the limit
  return prisma.$transaction(async (tx) => {
    const found = await tx.order.findFirst({
      where: { OR: [{ id: opts.orderId }, { orderNumber: opts.orderId }] },
      select: { id: true },
    });
    if (!found) return { ok: false as const, error: "Order not found" };
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
    const summary = await getRefundableSummary(found.id, tx);
    if (!summary) return { ok: false as const, error: "Order not found" };
    if (summary.refundable <= 0) {
      return { ok: false as const, error: "No refundable amount on this order" };
    }
    if (!opts.allowParallel && summary.openRefunds > 0) {
      return { ok: false as const, error: "A refund request is already in progress" };
    }

    const requested = opts.amount && opts.amount > 0 ? round(opts.amount) : summary.refundable;
    if (requested > summary.refundable + 0.001) {
      return {
        ok: false as const,
        error: `Refund cannot be more than Rs. ${summary.refundable.toLocaleString("en-PK")} (paid ${summary.successPaid.toLocaleString("en-PK")}, already refunded or in progress ${summary.refundedOrReserved.toLocaleString("en-PK")})`,
      };
    }
    const amount = requested;
    if (amount <= 0) return { ok: false as const, error: "No refundable amount" };

    const payment =
      (opts.preferredPaymentId
        ? summary.payments.find((p) => p.id === opts.preferredPaymentId)
        : null) || pickPaymentForRefund(summary.payments, amount);

    const status: RefundStatus = opts.autoApprove ? "APPROVED" : "PENDING";

    const refund = await tx.refund.create({
      data: {
        orderId: summary.orderId,
        paymentId: payment?.id,
        amount,
        reason: reason.slice(0, 500),
        status,
        requestedById: opts.requestedById || null,
        notes: opts.notes || null,
        ...(opts.autoApprove && opts.requestedById
          ? { approvedById: opts.requestedById }
          : {}),
      },
    });

    return {
      ok: true as const,
      refundId: refund.id,
      amount,
      status: refund.status,
    };
  });
}

/**
 * After cancel: if customer already paid online, open a refund automatically.
 * Stripe → try auto-complete; JazzCash → leave for admin manual reverse.
 */
export async function createRefundAfterCancel(opts: {
  orderId: string;
  requestedById: string;
  reason: string;
}): Promise<{ created: boolean; refundId?: string; message?: string }> {
  const summary = await getRefundableSummary(opts.orderId);
  if (!summary || summary.refundable <= 0) {
    return { created: false, message: "No online payment to refund" };
  }

  const created = await createRefundRecord({
    orderId: opts.orderId,
    amount: summary.refundable,
    reason: opts.reason.slice(0, 500),
    notes: "AUTO_CANCEL_REFUND",
    requestedById: opts.requestedById,
    allowParallel: false,
    autoApprove: true,
  });

  if (!created.ok) {
    return { created: false, message: created.error };
  }

  await writeAuditLog({
    userId: opts.requestedById,
    action: "REFUND_AUTO_ON_CANCEL",
    entity: "Refund",
    entityId: created.refundId,
    newValue: { amount: created.amount },
  });

  const payment = summary.payments.find((p) => p.method === "STRIPE");
  if (payment?.providerTxnId) {
    const processed = await advanceRefundStatus({
      refundId: created.refundId,
      status: "COMPLETED",
      actorId: opts.requestedById,
      notes: "Auto Stripe refund after cancel",
      skipTransitionCheck: false,
      fromCancelAuto: true,
    });
    if (!processed.ok) {
      // Leave APPROVED so admin can retry / complete
      await prisma.refund.update({
        where: { id: created.refundId },
        data: {
          notes: `AUTO_CANCEL_REFUND; Stripe auto-refund failed: ${processed.error}. Admin must complete.`,
        },
      });
      await notifyOrderEvent(
        opts.orderId,
        "REFUND_UPDATE",
        "Refund needs attention",
        "Your order was cancelled. Online payment refund is being processed by MandiBazaar."
      );
      return {
        created: true,
        refundId: created.refundId,
        message: "Refund opened — Stripe auto-refund needs admin retry",
      };
    }
    return {
      created: true,
      refundId: created.refundId,
      message: "Refund completed via Stripe",
    };
  }

  await notifyOrderEvent(
    opts.orderId,
    "REFUND_UPDATE",
    "Refund in progress",
    "Your order was cancelled. Online payment will be refunded after admin confirmation (JazzCash/manual)."
  );

  return {
    created: true,
    refundId: created.refundId,
    message: "Refund opened for manual JazzCash/admin processing",
  };
}

/** Late SUCCESS payment on cancelled/closed order → auto open refund. */
export async function ensureLatePaymentRefund(opts: {
  orderId: string;
  paymentId: string;
  amount: number;
}): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: opts.paymentId },
  });
  if (!payment || payment.status !== "SUCCESS") return;

  const existing = await prisma.refund.findFirst({
    where: {
      orderId: opts.orderId,
      paymentId: opts.paymentId,
      status: { in: OPEN_OR_DONE },
      reason: { contains: "Late payment" },
    },
  });
  if (existing) return;

  const summary = await getRefundableSummary(opts.orderId);
  if (!summary || summary.refundable <= 0) return;

  const amount = Math.min(opts.amount, summary.refundable);
  if (amount <= 0) return;

  await createRefundRecord({
    orderId: opts.orderId,
    amount,
    reason: "Late payment on closed order — refund required",
    notes: "LATE_PAYMENT_AUTO_REFUND",
    preferredPaymentId: opts.paymentId,
    allowParallel: true,
    autoApprove: true,
  });

  await notifyOrderEvent(
    opts.orderId,
    "REFUND_UPDATE",
    "Late payment — refund queued",
    "A payment arrived after the order closed. A refund has been queued for admin processing."
  );
}

async function applyOrderLedgerOnComplete(
  orderId: string,
  amount: number,
  refundId: string
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const feePaid = toNumber(order.deliveryFeePaid);
  const prodPaid = toNumber(order.productAmountPaid);
  let left = amount;
  const feeCut = Math.min(left, feePaid);
  const newFee = Math.max(0, feePaid - feeCut);
  left -= feeCut;
  const prodCut = Math.min(left, prodPaid);
  const newProd = Math.max(0, prodPaid - prodCut);

  // Order balance update + ledger reversal must be atomic, else a crash between
  // them leaves the order marked refunded with no REFUND ledger rows.
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        deliveryFeePaid: newFee,
        productAmountPaid: newProd,
        ...(feeCut > 0 && newFee === 0
          ? { deliveryFeePaymentStatus: "REFUNDED" }
          : {}),
        ...(prodCut > 0 && newProd === 0
          ? { productPaymentStatus: "REFUNDED" }
          : prodCut > 0
            ? { productPaymentStatus: "PARTIALLY_PAID" }
            : {}),
      },
    });

    // Append-only ledger: reverse earnings/commission/rider-fee for the refund.
    await recordOrderRefundLedger(tx, {
      orderId,
      feeRefund: feeCut,
      productRefund: prodCut,
      refId: refundId,
    });

    // COD: reduce the rider's remittance obligation by the refunded product amount
    // via an authorized, recorded adjustment (spec §6F) — never silently.
    await adjustRemittanceForRefund(tx, { orderId, refundedProductAmount: prodCut, refundId });
  });
}

async function markPaymentRefundProgress(
  paymentId: string | null | undefined,
  refundAmount: number
): Promise<void> {
  if (!paymentId) return;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;

  const meta = metaObject(payment.metadata);
  const prev = Number(meta.refundedAmount || 0) || 0;
  const next = Math.round((prev + refundAmount) * 100) / 100;
  const fully = next >= toNumber(payment.amount) - 0.001;

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: fully ? "REFUNDED" : payment.status,
      metadata: {
        ...meta,
        refundedAmount: next,
        lastRefundAt: new Date().toISOString(),
      },
    },
  });
}

const NEXT: Record<RefundStatus, RefundStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["PROCESSING", "COMPLETED", "REJECTED"],
  PROCESSING: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};

export async function advanceRefundStatus(opts: {
  refundId: string;
  status: RefundStatus;
  actorId: string;
  notes?: string | null;
  externalReference?: string | null;
  skipTransitionCheck?: boolean;
  fromCancelAuto?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const refund = await prisma.refund.findUnique({
    where: { id: opts.refundId },
    include: { order: true, payment: true },
  });
  if (!refund) return { ok: false, error: "Refund not found" };

  if (!opts.skipTransitionCheck) {
    const allowed = NEXT[refund.status] || [];
    // Auto-cancel path: APPROVED → COMPLETED (skip PROCESSING for Stripe)
    if (opts.fromCancelAuto) {
      if (refund.status !== "APPROVED" && refund.status !== "PROCESSING") {
        return {
          ok: false,
          error: `Cannot auto-complete from ${refund.status}`,
        };
      }
    } else if (!allowed.includes(opts.status)) {
      return {
        ok: false,
        error: `Cannot move refund from ${refund.status} to ${opts.status}`,
      };
    }
  }

  const payment =
    refund.payment ||
    (await prisma.payment.findFirst({
      where: { orderId: refund.orderId, status: { in: ["SUCCESS", "REFUNDED"] } },
      orderBy: { paidAt: "desc" },
    }));

  const amount = toNumber(refund.amount);
  const method = payment?.method;

  // JazzCash / manual: require external reference before COMPLETED
  if (
    opts.status === "COMPLETED" &&
    method &&
    method !== "STRIPE" &&
    !opts.fromCancelAuto
  ) {
    const ref = (opts.externalReference || "").trim();
    const notesHasRef =
      Boolean(ref) ||
      /EXTERNAL_REF\s*[:=]\s*\S+/i.test(
        `${opts.notes || ""} ${refund.notes || ""}`
      );
    if (!notesHasRef) {
      return {
        ok: false,
        error:
          "Add JazzCash/bank refund reference (externalReference) before marking COMPLETED",
      };
    }
  }

  if (opts.status === "COMPLETED" && method === "STRIPE") {
    const pi = payment?.providerTxnId;
    if (!pi) {
      return { ok: false, error: "Stripe payment intent missing for refund" };
    }
    try {
      const { refundStripePayment, isStripeConfigured } = await import(
        "@/lib/payments/stripe"
      );
      if (!isStripeConfigured()) {
        return { ok: false, error: "Stripe is not configured" };
      }
      await refundStripePayment({
        paymentIntentId: pi,
        amountPkr: amount,
        reason: refund.reason,
        idempotencyKey: `refund_${refund.id}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stripe refund failed";
      // Already refunded on Stripe → treat as success
      if (!/already been refunded|charge_already_refunded/i.test(msg)) {
        return { ok: false, error: `Stripe refund failed: ${msg}` };
      }
    }
  }

  const noteParts = [
    opts.notes?.trim() || refund.notes || "",
    opts.externalReference
      ? `EXTERNAL_REF=${opts.externalReference.trim()}`
      : "",
  ].filter(Boolean);

  // Atomic claim: only advance if the refund is still in the status we validated.
  // This serialises two concurrent completions (double-click / two admins) so the
  // non-idempotent ledger/remittance steps below run exactly once.
  const claimed = await prisma.refund.updateMany({
    where: { id: refund.id, status: refund.status },
    data: {
      status: opts.status,
      notes: noteParts.join(" | ") || null,
      ...(opts.status === "APPROVED" || opts.status === "REJECTED"
        ? { approvedById: opts.actorId }
        : {}),
      ...(opts.status === "COMPLETED" ? { processedAt: new Date() } : {}),
    },
  });
  if (claimed.count !== 1) {
    return { ok: false, error: "This refund was just updated — reload and try again" };
  }

  if (opts.status === "COMPLETED") {
    await applyOrderLedgerOnComplete(refund.orderId, amount, refund.id);
    await markPaymentRefundProgress(payment?.id || refund.paymentId, amount);
  }

  await writeAuditLog({
    userId: opts.actorId,
    action: "REFUND_STATUS_UPDATED",
    entity: "Refund",
    entityId: refund.id,
    previousValue: { status: refund.status },
    newValue: { status: opts.status },
  });

  await notifyOrderEvent(
    refund.orderId,
    "REFUND_UPDATE",
    "Refund update",
    `Refund for order ${refund.order.orderNumber} is now ${opts.status.toLowerCase()}.`
  );

  return { ok: true };
}

export async function flagLatePaymentMetadata(
  paymentId: string,
  orderStatus: string
): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;
  const meta = metaObject(payment.metadata);
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...meta,
        latePaymentOnTerminalOrder: true,
        orderStatusAtCallback: orderStatus,
      } as Prisma.InputJsonValue,
    },
  });
}
