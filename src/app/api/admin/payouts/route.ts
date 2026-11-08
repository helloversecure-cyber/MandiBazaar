import { NextRequest } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import {
  generateWeeklyPayouts,
  markPayoutPaid,
  payAllPendingPayouts,
  previewSettlement,
  settleAllStores,
} from "@/lib/orders/payouts";
import { writeAuditLog } from "@/lib/audit";
import {
  apiError,
  apiFieldErrors,
  apiSuccess,
  paginationMeta,
  parsePagination,
  toNumber,
  toUserMessage,
} from "@/lib/utils";
import { PaymentProofStatus, PayoutStatus, RemittanceStatus } from "@prisma/client";
import { manualPaymentDue } from "@/lib/orders/apply-manual-online-payment";
import { markRemittanceReceived } from "@/lib/finance/admin-remittance";
import { isUsableImageUrl, proofDecisionFor } from "@/lib/orders/proof-review";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(PERMISSIONS.PAYOUTS_READ);
    const sp = req.nextUrl.searchParams;
    const resource = sp.get("resource") || "payouts";
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 100 });
    const q = (sp.get("q") || "").trim().slice(0, 40);
    const orderSearch = q
      ? { order: { orderNumber: { contains: q, mode: "insensitive" as const } } }
      : {};

    if (resource === "remittances") {
      const status = sp.get("status");
      const where = {
        ...orderSearch,
        ...(status && ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED", "RECEIVED", "REJECTED", "OVERDUE", "DISPUTED"].includes(status)
          ? { status: status as RemittanceStatus }
          : {}),
      };
      const [total, items] = await Promise.all([
        prisma.cashRemittance.count({ where }),
        prisma.cashRemittance.findMany({
          where,
          include: {
            order: {
              select: {
                orderNumber: true,
                remainingAmount: true,
                riderId: true,
                paymentMethod: true,
                productPaymentStatus: true,
                deliveryFeePaymentStatus: true,
                deliveryFeePaid: true,
                cashCollection: { select: { amountCollected: true } },
              },
            },
            rider: { select: { id: true, name: true, phone: true } },
            receivedBy: { select: { fullName: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
      ]);
      return apiSuccess({
        pagination: paginationMeta(page, limit, total),
        items: items.map((r) => {
          const cash = r.order?.cashCollection ? toNumber(r.order.cashCollection.amountCollected) : 0;
          // QA P7: a remittance must belong to a rider and to cash actually collected
          const problem = !r.riderId
            ? "No rider on this remittance"
            : !r.order?.cashCollection
              ? "No cash collection recorded for this order"
              : Math.abs(cash - toNumber(r.amount)) > 0.01
                ? `Amount differs from cash collected (${cash})`
                : null;
          // Full cash on delivery: the remittance includes the delivery fee collected in cash
          const deliveryFeeInCash =
            r.order?.deliveryFeePaymentStatus === "CASH_ON_DELIVERY" ? toNumber(r.order.deliveryFeePaid) : 0;
          const amountDue = toNumber(r.amountDue);
          const amountRemitted = toNumber(r.amountRemitted);
          return {
            ...r,
            amount: toNumber(r.amount),
            amountDue,
            amountRemitted,
            outstanding: Math.max(0, Math.round((amountDue - amountRemitted) * 100) / 100),
            dueAt: r.dueAt,
            deliveryFeeInCash,
            order: r.order
              ? {
                  ...r.order,
                  remainingAmount: toNumber(r.order.remainingAmount),
                  deliveryFeePaid: toNumber(r.order.deliveryFeePaid),
                  cashCollection: undefined,
                }
              : r.order,
            problem,
          };
        }),
      });
    }

    if (resource === "payment-proofs") {
      const status = sp.get("status");
      const where = {
        ...orderSearch,
        ...(status && ["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(status)
          ? { status: status as PaymentProofStatus }
          : {}),
      };
      const [total, items] = await Promise.all([
        prisma.paymentProof.count({ where }),
        prisma.paymentProof.findMany({
          where,
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                orderStatus: true,
                paymentMethod: true,
                productPaymentStatus: true,
                deliveryFeePaymentStatus: true,
                productAmountPaid: true,
                deliveryFeePaid: true,
                deliveryFee: true,
                subtotal: true,
                discount: true,
                remainingAmount: true,
                grandTotal: true,
                customer: { select: { fullName: true, phone: true } },
              },
            },
            uploadedBy: {
              select: { fullName: true, phone: true, role: { select: { name: true } } },
            },
            reviewedBy: { select: { fullName: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
      ]);
      return apiSuccess({
        pagination: paginationMeta(page, limit, total),
        items: items.map((p) => {
          const o = p.order;
          const due = o ? manualPaymentDue(o) : null;
          const decision = o ? proofDecisionFor(p, o) : { canApprove: false, canRefund: false, blockedReason: "Order missing" };
          return {
            ...p,
            imageMissing: !isUsableImageUrl(p.imageUrl),
            amountDue: due?.amount ?? 0,
            amountDueFor: due?.type ?? null,
            ...decision,
            order: o
              ? {
                  ...o,
                  productAmountPaid: toNumber(o.productAmountPaid),
                  deliveryFeePaid: toNumber(o.deliveryFeePaid),
                  deliveryFee: toNumber(o.deliveryFee),
                  subtotal: toNumber(o.subtotal),
                  discount: toNumber(o.discount),
                  remainingAmount: toNumber(o.remainingAmount),
                  grandTotal: toNumber(o.grandTotal),
                }
              : null,
          };
        }),
      });
    }

    if (resource === "settlement-preview") {
      return apiSuccess(await previewSettlement());
    }

    if (resource === "summary") {
      const settings = await prisma.storeSettings.findFirst();
      const pending = await prisma.payout.findMany({
        where: { status: "PENDING" },
        include: {
          store: {
            select: {
              name: true,
              jazzCashNumber: true,
              bankAccountNumber: true,
              bankIban: true,
              bankName: true,
            },
          },
        },
      });
      const totalGross = pending.reduce((s, p) => s + toNumber(p.grossSales), 0);
      const totalCommission = pending.reduce(
        (s, p) => s + toNumber(p.commissionAmount),
        0
      );
      const totalNet = pending.reduce((s, p) => s + toNumber(p.netAmount), 0);
      return apiSuccess({
        defaultCommissionPct: toNumber(settings?.platformCommissionPct ?? 5),
        pendingCount: pending.length,
        totalGross,
        totalCommission,
        totalNet,
        pending: pending.map((p) => ({
          id: p.id,
          storeName: p.store.name,
          grossSales: toNumber(p.grossSales),
          commissionRate: toNumber(p.commissionRate),
          commissionAmount: toNumber(p.commissionAmount),
          netAmount: toNumber(p.netAmount),
          hasJazzCash: !!p.store.jazzCashNumber,
          hasBank: !!(
            p.store.bankIban ||
            p.store.bankAccountNumber ||
            p.store.bankName
          ),
        })),
      });
    }

    const status = sp.get("status");
    const where = {
      ...(q ? { store: { name: { contains: q, mode: "insensitive" as const } } } : {}),
      ...(status && ["PENDING", "PROCESSING", "PAID", "CANCELLED"].includes(status)
        ? { status: status as PayoutStatus }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.payout.count({ where }),
      prisma.payout.findMany({
        where,
        include: {
          store: {
            select: {
              id: true,
              name: true,
              slug: true,
              jazzCashNumber: true,
              bankName: true,
              bankAccountNumber: true,
              bankIban: true,
            },
          },
          markedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);
    return apiSuccess({
      pagination: paginationMeta(page, limit, total),
      items: items.map((p) => ({
        ...p,
        grossSales: toNumber(p.grossSales),
        commissionRate: toNumber(p.commissionRate),
        commissionAmount: toNumber(p.commissionAmount),
        netAmount: toNumber(p.netAmount),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin-payouts:GET]", e);
    return apiError(toUserMessage(e), 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSuperAdmin();
    const body = await req.json();
    const { action } = body;

    if (action === "GENERATE_WEEKLY") {
      const result = await generateWeeklyPayouts({ markedById: session.user.id });
      await writeAuditLog({
        userId: session.user.id,
        action: "PAYOUTS_GENERATED",
        entity: "Payout",
        newValue: { count: result.payouts.length },
      });
      return apiSuccess({
        message: `Generated ${result.payouts.length} payout(s)`,
        ...result,
        payouts: result.payouts.map((p) => ({
          ...p,
          grossSales: toNumber(p.grossSales),
          netAmount: toNumber(p.netAmount),
        })),
      });
    }

    if (
      (action === "SETTLE_ALL_STORES" || action === "PAY_ALL_PENDING") &&
      body.confirm !== true
    ) {
      return apiError("Review the payout summary and confirm first", 400);
    }

    if (action === "SETTLE_ALL_STORES") {
      const result = await settleAllStores({ markedById: session.user.id });
      await writeAuditLog({
        userId: session.user.id,
        action: "STORES_SETTLED_BATCH",
        entity: "Payout",
        newValue: {
          batchReference: result.batchReference,
          paidCount: result.paidCount,
          skippedCount: result.skippedCount,
          totalNetPaid: result.totalNetPaid,
          totalCommissionKept: result.totalCommissionKept,
        },
      });
      return apiSuccess({
        message: `Settled ${result.paidCount} store(s). Commission kept ${result.totalCommissionKept}. ${result.skippedCount} skipped.`,
        ...result,
      });
    }

    if (action === "PAY_ALL_PENDING") {
      const result = await payAllPendingPayouts({
        markedById: session.user.id,
        notes: body.notes,
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "PAYOUTS_BATCH_PAID",
        entity: "Payout",
        newValue: {
          batchReference: result.batchReference,
          paidCount: result.paidCount,
          totalNetPaid: result.totalNetPaid,
        },
      });
      return apiSuccess({
        message: `Paid ${result.paidCount} store(s). Skipped ${result.skippedCount}.`,
        ...result,
      });
    }

    if (action === "MARK_PAID") {
      const payout = await markPayoutPaid({
        payoutId: body.payoutId,
        markedById: session.user.id,
        payoutMethod: body.payoutMethod || "BANK",
        payoutReference: body.payoutReference,
        notes: body.notes,
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "STORE_PAYOUT_MARKED_PAID",
        entity: "Payout",
        entityId: payout.id,
        newValue: {
          status: "PAID",
          netAmount: Number(payout.netAmount),
          payoutMethod: payout.payoutMethod,
          payoutReference: payout.payoutReference,
        },
      });
      return apiSuccess(payout);
    }

    if (action === "RECEIVE_REMITTANCE") {
      if (!body.remittanceId) return apiError("Remittance not found", 404);
      // Route through the authoritative remittance service so partial tracking,
      // the submission ledger and COD restriction-clear always run (one path).
      const result = await markRemittanceReceived(session.user.id, body.remittanceId, {
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return apiSuccess(result);
    }

    if (action === "DISPUTE_REMITTANCE") {
      const existing = await prisma.cashRemittance.findUnique({
        where: { id: body.remittanceId },
      });
      if (!existing) return apiError("Remittance not found", 404);
      if (existing.status === "RECEIVED") {
        return apiError("Cannot dispute a received remittance", 400);
      }
      const remittance = await prisma.cashRemittance.update({
        where: { id: body.remittanceId },
        data: {
          status: "DISPUTED",
          notes:
            body.notes ||
            existing.notes ||
            "Amount/status disputed by Super Admin",
        },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "REMITTANCE_DISPUTED",
        entity: "CashRemittance",
        entityId: remittance.id,
        previousValue: { status: existing.status },
        newValue: { notes: body.notes },
      });
      return apiSuccess(remittance);
    }

    if (action === "RESOLVE_REMITTANCE") {
      const existing = await prisma.cashRemittance.findUnique({
        where: { id: body.remittanceId },
      });
      if (!existing) return apiError("Remittance not found", 404);
      if (existing.status !== "DISPUTED") {
        return apiError("Only disputed remittances can be resolved", 400);
      }
      const next = String(body.resolveTo || "PENDING").toUpperCase();
      if (!["PENDING", "SUBMITTED", "RECEIVED"].includes(next)) {
        return apiError("resolveTo must be PENDING, SUBMITTED, or RECEIVED", 400);
      }
      const remittance = await prisma.cashRemittance.update({
        where: { id: body.remittanceId },
        data: {
          status: next as "PENDING" | "SUBMITTED" | "RECEIVED",
          notes: body.notes || existing.notes || "Dispute resolved",
          ...(next === "RECEIVED"
            ? { receivedById: session.user.id, receivedAt: new Date() }
            : {}),
        },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "REMITTANCE_DISPUTE_RESOLVED",
        entity: "CashRemittance",
        entityId: remittance.id,
        previousValue: { status: existing.status },
        newValue: { status: next },
      });
      return apiSuccess(remittance);
    }

    if (action === "REVIEW_PAYMENT_PROOF") {
      const proof = await prisma.paymentProof.findUnique({
        where: { id: String(body.proofId || "") },
        include: { order: true },
      });
      if (!proof) return apiError("Payment proof not found", 404);
      if (proof.status !== "PENDING_REVIEW") {
        return apiError("This proof was already reviewed", 400);
      }
      const decision = String(body.decision || "").toUpperCase();
      if (!["APPROVED", "REJECTED", "REFUND"].includes(decision)) {
        return apiError("decision must be APPROVED, REJECTED or REFUND", 400);
      }
      const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
      const order = proof.order;
      const rules = proofDecisionFor(proof, order);

      if (decision === "REJECTED" && notes.length < 3) {
        return apiFieldErrors({ notes: "Give a reason for declining (the customer sees it)" });
      }
      if (decision === "APPROVED" && !rules.canApprove) {
        return apiError(rules.blockedReason || "This receipt cannot be approved", 400);
      }
      let refundAmount = 0;
      if (decision === "REFUND") {
        if (!rules.canRefund) {
          return apiError("Refund from a receipt is only for cancelled orders with a receipt image", 400);
        }
        refundAmount = Number(body.amount);
        const max = toNumber(order.grandTotal);
        if (!Number.isFinite(refundAmount) || refundAmount < 1 || refundAmount > max) {
          return apiFieldErrors({
            amount: `Enter the amount shown on the receipt (Rs. 1 – ${max})`,
          });
        }
      }

      // Claim the proof atomically: two admins (or a double click) cannot both review it
      const claimed = await prisma.paymentProof.updateMany({
        where: { id: proof.id, status: "PENDING_REVIEW" },
        data: {
          status: decision === "REJECTED" ? "REJECTED" : "APPROVED",
          reviewedById: session.user.id,
          reviewedAt: new Date(),
          reviewNotes:
            decision === "REFUND"
              ? `Money received on a closed order — refund of Rs. ${refundAmount} queued${notes ? `: ${notes}` : ""}`
              : notes || null,
        },
      });
      if (claimed.count !== 1) return apiError("This proof was already reviewed", 409);

      if (decision === "APPROVED" && !proof.riderId) {
        const { applyApprovedPaymentProof } = await import(
          "@/lib/orders/apply-manual-online-payment"
        );
        let applied: { updated: boolean; reason?: string };
        try {
          applied = await applyApprovedPaymentProof(proof.orderId, { proofId: proof.id });
        } catch (e) {
          applied = { updated: false, reason: e instanceof Error ? e.message : "ERROR" };
        }
        if (!applied.updated) {
          // Nothing was recorded (order changed meanwhile) — put the proof back for review
          await prisma.paymentProof.update({
            where: { id: proof.id },
            data: { status: "PENDING_REVIEW", reviewedById: null, reviewedAt: null, reviewNotes: null },
          });
          return apiError(
            applied.reason === "NOT_PENDING_PAYMENT"
              ? "The order is no longer waiting for payment — reload the page"
              : applied.reason === "NOTHING_DUE"
                ? "Nothing is due on this order"
                : "Could not record the payment — try again",
            409
          );
        }
      }

      if (decision === "REFUND") {
        const payment = await prisma.payment.upsert({
          where: { reference: `till_qr_proof_${proof.id}` },
          create: {
            orderId: order.id,
            type: "FULL_PAYMENT",
            method: "JAZZCASH",
            amount: refundAmount,
            status: "SUCCESS",
            paidAt: new Date(),
            reference: `till_qr_proof_${proof.id}`,
            metadata: {
              provider: "jazzcash_till_qr",
              approvedVia: "payment_proof",
              proofId: proof.id,
              latePaymentOnTerminalOrder: true,
              orderStatusAtCallback: order.orderStatus,
            },
          },
          update: {},
        });
        const { ensureLatePaymentRefund } = await import("@/lib/orders/refunds");
        await ensureLatePaymentRefund({
          orderId: order.id,
          paymentId: payment.id,
          amount: refundAmount,
        });
      }

      await writeAuditLog({
        userId: session.user.id,
        action: `PAYMENT_PROOF_${decision === "REFUND" ? "REFUND_QUEUED" : decision}`,
        entity: "PaymentProof",
        entityId: proof.id,
        newValue: { decision, notes, orderId: order.id, ...(refundAmount ? { amount: refundAmount } : {}) },
      });

      const { notifyOrderEvent } = await import("@/lib/notifications/service");
      if (decision === "APPROVED") {
        await notifyOrderEvent(
          proof.orderId,
          "PAYMENT_PROOF_APPROVED",
          "Payment received",
          `Your payment receipt for order ${order.orderNumber} was approved. Payment confirmed.`
        );
      } else if (decision === "REJECTED") {
        await notifyOrderEvent(
          proof.orderId,
          "PAYMENT_PROOF_REJECTED",
          "Payment receipt declined",
          `Your payment receipt for order ${order.orderNumber} was declined: ${notes} Please upload a clear JazzCash receipt again from My orders.`
        );
      }

      const updated = await prisma.paymentProof.findUnique({ where: { id: proof.id } });
      return apiSuccess(updated);
    }

    return apiError("Unknown action");

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin-payouts:POST]", e);
    return apiError(toUserMessage(e), 400);
  }
}
