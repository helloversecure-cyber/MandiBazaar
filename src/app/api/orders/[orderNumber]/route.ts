import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toNumber } from "@/lib/utils";
import { adminNextStatuses, canAssignRider } from "@/lib/orders/state-machine";
import { buildOrderJourney } from "@/lib/orders/status-events";
import { pendingPaymentTtlMinutes } from "@/lib/orders/expire-pending";
import { customerDisplayPhone, orderWaitingFlag } from "@/lib/orders/attention";
import { manualPaymentDue } from "@/lib/orders/apply-manual-online-payment";
import { normalizePkPhone } from "@/lib/validators/pk";
import { customerDeliveryCodeView, orderRequiresDeliveryCode } from "@/lib/orders/delivery-code";
import { storeReviewForOrder } from "@/lib/stores/reviews";
import {
  cashDueBreakdown,
  deliveryFeePaymentLabel,
  feeIsCashOnDelivery,
  fullCodPaymentLabel,
} from "@/lib/orders/full-cod";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "DELIVERY_MANAGER"];

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  try {
    // Free stock if this unpaid order (or others) already passed TTL.
    // Awaited (cooldown + small batch) so serverless does not cut it off.
    try {
      const { sweepExpiredPendingPayments } = await import("@/lib/orders/expire-pending");
      await sweepExpiredPendingPayments({ limit: 10 });
    } catch {
      /* never block the page */
    }

    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const isAdmin = ADMIN_ROLES.includes(session.user.role);

    const order = await prisma.order.findFirst({
      where: {
        orderNumber: params.orderNumber,
        ...(isAdmin ? {} : { customerId: session.user.id }),
      },
      include: {
        items: true,
        payments: { include: { transactions: true } },
        refunds: { orderBy: { createdAt: "desc" } },
        // Public rider fields only — never CNIC, account numbers or ID document URLs
        rider: { select: { id: true, name: true, phone: true, vehicleType: true, photoUrl: true } },
        cashCollection: true,
        delivery: true,
        customer: { select: { fullName: true, phone: true, email: true } },
        // W12: list orders show rider bidding after packing on the customer's order page.
        itemList: { select: { id: true } },
      },
    });

    if (!order) return apiError("Order not found", 404);

    const { getRefundableSummary } = await import("@/lib/orders/refunds");
    const summary = await getRefundableSummary(order.id);

    // Customer-friendly delivery journey (Placed → … → Delivered).
    const journeyEvents = await prisma.orderStatusEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
      select: { status: true, createdAt: true },
    });
    const statusTimeline = buildOrderJourney(order, journeyEvents);

    const base = {
      ...order,
      statusTimeline,
      subtotal: toNumber(order.subtotal),
      discount: toNumber(order.discount),
      deliveryFee: toNumber(order.deliveryFee),
      grandTotal: toNumber(order.grandTotal),
      deliveryFeePaid: toNumber(order.deliveryFeePaid),
      productAmountPaid: toNumber(order.productAmountPaid),
      remainingAmount: toNumber(order.remainingAmount),
      couponDiscount: toNumber(order.couponDiscount),
      refundableAmount: summary?.refundable ?? 0,
      /** Full cash on delivery: products + delivery fee in cash to the rider */
      fullCod: feeIsCashOnDelivery(order) && toNumber(order.deliveryFee) > 0,
      paymentLabel: fullCodPaymentLabel({
        deliveryFee: toNumber(order.deliveryFee),
        deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      }),
      deliveryFeePaymentLabel: deliveryFeePaymentLabel({
        deliveryFee: toNumber(order.deliveryFee),
        deliveryFeePaid: toNumber(order.deliveryFeePaid),
        deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      }),
      /** Cash the rider still collects: { products, delivery, total } */
      cashDue: cashDueBreakdown({
        subtotal: toNumber(order.subtotal),
        discount: toNumber(order.discount),
        deliveryFee: toNumber(order.deliveryFee),
        deliveryFeePaid: toNumber(order.deliveryFeePaid),
        productAmountPaid: toNumber(order.productAmountPaid),
        deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      }),
      refunds: order.refunds.map((r) => ({
        ...r,
        amount: toNumber(r.amount),
      })),
      items: order.items.map((i) => ({
        ...i,
        unitPrice: toNumber(i.unitPrice),
        finalPrice: toNumber(i.finalPrice),
        discount: toNumber(i.discount),
      })),
      payments: order.payments.map((p) => ({
        ...p,
        amount: toNumber(p.amount),
        transactions: p.transactions.map((t) => ({ ...t, amount: toNumber(t.amount) })),
      })),
      cashCollection: order.cashCollection
        ? { ...order.cashCollection, amountCollected: toNumber(order.cashCollection.amountCollected) }
        : null,
    };

    if (!isAdmin) {
      // Expose the customer's OWN receipt status (safe fields only — no uploader/
      // reviewer identity) so the confirmation/order pages can show "receipt
      // received — verifying" instead of telling a customer who already paid via
      // JazzCash QR that they're unpaid and nudging a second payment.
      const myProofs = await prisma.paymentProof.findMany({
        // Customer-uploaded receipts only (riderId null) — never surface a
        // rider-uploaded proof's status/notes on the customer's own pages.
        where: { orderId: order.id, riderId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, reviewNotes: true, createdAt: true, reviewedAt: true },
      });
      // NEW-05: a cancelled/failed order has nothing left to pay or collect — don't
      // show "Remaining Rs X" / "To collect Rs X" on it.
      const settled = ["CANCELLED", "FAILED"].includes(order.orderStatus);
      const customerBase = settled
        ? { ...base, remainingAmount: 0, cashDue: { products: 0, delivery: 0, total: 0 } }
        : base;
      // W9: the customer's own delivery code (riders never get this) and their store rating.
      const [deliveryCode, storeReview] = await Promise.all([
        customerDeliveryCodeView(order.id),
        storeReviewForOrder(session.user.id, order.id),
      ]);
      return apiSuccess({ ...customerBase, paymentProofs: myProofs, deliveryCode, storeReview });
    }

    // ---- Admin-only detail (QA P2: full order page) ----
    const [fulfillments, proofs, remittance, history] = await Promise.all([
      prisma.storeFulfillment.findMany({
        where: { orderId: order.id },
        include: { store: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.paymentProof.findMany({
        where: { orderId: order.id },
        include: {
          uploadedBy: { select: { fullName: true, role: { select: { name: true } } } },
          reviewedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.cashRemittance.findUnique({
        where: { orderId: order.id },
        include: { rider: { select: { name: true, phone: true } } },
      }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entity: "Order", entityId: order.id },
            ...(order.refunds.length
              ? [{ entity: "Refund", entityId: { in: order.refunds.map((r) => r.id) } }]
              : []),
          ],
        },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    ]);
    const proofIds = proofs.map((p) => p.id);
    const proofHistory = proofIds.length
      ? await prisma.auditLog.findMany({
          where: { entity: "PaymentProof", entityId: { in: proofIds } },
          include: { user: { select: { fullName: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // M-8: store fulfillment steps (preparing / packed / ready) are logged against
    // the StoreFulfillment, so pull them in too — otherwise the admin order history
    // only shows "Order placed" and the rider assignment.
    const fulfillmentIds = fulfillments.map((f) => f.id);
    const fulfillmentHistory = fulfillmentIds.length
      ? await prisma.auditLog.findMany({
          where: { entity: "StoreFulfillment", entityId: { in: fulfillmentIds } },
          include: { user: { select: { fullName: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const timeline = [
      {
        at: order.createdAt,
        action: "ORDER_PLACED",
        by: order.customer?.fullName || "Customer",
        detail: null as unknown,
      },
      ...[...history, ...proofHistory, ...fulfillmentHistory].map((h) => ({
        at: h.createdAt,
        action: h.action,
        by: h.user?.fullName || (h.userId ? "Staff" : "System"),
        detail: { from: h.previousValue, to: h.newValue },
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const snap = (order.deliveryAddressSnapshot || {}) as { phone?: string };
    const display = customerDisplayPhone(order.customer?.phone, snap.phone, (v) => normalizePkPhone(v) != null);
    const productDue = Math.max(0, base.subtotal - base.discount);
    const successOnline = base.payments
      .filter((p) => p.type !== "REFUND" && (p.status === "SUCCESS" || p.status === "REFUNDED"))
      .reduce((s, p) => s + p.amount, 0);
    const cash = base.cashCollection?.amountCollected ?? 0;
    const refundedDone = base.refunds
      .filter((r) => r.status === "COMPLETED")
      .reduce((s, r) => s + r.amount, 0);

    const due = manualPaymentDue(order);
    // Store side status mismatch (QA P2 data check)
    const fulfillmentMismatch = fulfillments.some(
      (f) =>
        (f.status === "PENDING_PAYMENT" && order.orderStatus !== "PENDING_PAYMENT") ||
        (order.orderStatus === "CANCELLED" && f.status !== "CANCELLED")
    );

    return apiSuccess({
      ...base,
      admin: {
        allowedNextStatuses: adminNextStatuses({
          orderStatus: order.orderStatus,
          riderId: order.riderId,
          remainingAmount: base.remainingAmount,
          cashCollected: !!order.cashCollection,
        }),
        canAssignRider: canAssignRider(order.orderStatus),
        /** W9: item-list order protected by the customer's code (admin can reset it). */
        deliveryCodeRequired: await orderRequiresDeliveryCode(prisma, order.id),
        deliveryCodeAttempts: order.deliveryCodeAttempts,
        deliveryCodeLockedUntil: order.deliveryCodeLockedUntil,
        customerPhone: display.phone,
        customerPhoneSource: display.source,
        accountPhoneInvalid: display.accountPhoneInvalid,
        waitingFlag: orderWaitingFlag(order, Date.now(), pendingPaymentTtlMinutes()),
        fulfillmentMismatch,
        fulfillments: fulfillments.map((f) => ({
          id: f.id,
          storeId: f.storeId,
          storeName: f.store?.name,
          storePhone: f.store?.phone,
          status: f.status,
          subtotal: toNumber(f.subtotal),
          itemCount: f.itemCount,
          readyAt: f.readyAt,
          pickedUpAt: f.pickedUpAt,
          pickupAddress: f.pickupAddress,
        })),
        paymentProofs: proofs.map((p) => ({
          id: p.id,
          imageUrl: p.imageUrl,
          status: p.status,
          notes: p.notes,
          reviewNotes: p.reviewNotes,
          createdAt: p.createdAt,
          reviewedAt: p.reviewedAt,
          uploadedBy: p.uploadedBy?.fullName || null,
          uploadedByRole: p.uploadedBy?.role?.name || null,
          reviewedBy: p.reviewedBy?.fullName || null,
        })),
        remittance: remittance
          ? {
              id: remittance.id,
              amount: toNumber(remittance.amount),
              status: remittance.status,
              rider: remittance.rider,
              riderId: remittance.riderId,
            }
          : null,
        money: {
          productDue,
          deliveryFee: base.deliveryFee,
          billed: productDue + base.deliveryFee,
          onlineCaptured: Math.round(successOnline * 100) / 100,
          cashCollected: cash,
          refunded: Math.round(refundedDone * 100) / 100,
          amountDueNow: due?.amount ?? 0,
          overRecorded:
            Math.round(
              Math.max(
                0,
                base.deliveryFeePaid + base.productAmountPaid - (productDue + base.deliveryFee),
                successOnline + cash - (productDue + base.deliveryFee)
              ) * 100
            ) / 100,
        },
        timeline,
      },
    });
  } catch (e) {
    console.error("[GET /api/orders/[orderNumber]]", e);
    return apiError("Failed to load order", 500);
  }
}
