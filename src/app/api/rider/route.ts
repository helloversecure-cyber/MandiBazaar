import { NextRequest } from "next/server";
import { requireRider } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { assertTransition } from "@/lib/orders/state-machine";
import { recordStatusEvent } from "@/lib/orders/status-events";
import { sendDeliveryConfirmationRequest } from "@/lib/orders/delivery-confirm";
import { finalizeSale, releaseReservedStock } from "@/lib/inventory/stock";
import { writeAuditLog } from "@/lib/audit";
import { notifyOrderEvent } from "@/lib/notifications/service";
import {
  apiError,
  toUserMessage,
  apiFieldErrors,
  apiSuccess,
  paginationMeta,
  parsePagination,
  toNumber,
} from "@/lib/utils";
import { OrderStatus, Prisma } from "@prisma/client";
import { maskTail } from "@/lib/portal/format";
import { riderProfileUpdateSchema } from "@/lib/portal/rider-profile";
import { zodFieldErrors } from "@/lib/validators/pk";
import { lockAndAddPayment } from "@/lib/orders/payment-ledger";
import { cashDueBreakdown, collectCashLabel } from "@/lib/orders/full-cod";
import { riderCashSummary } from "@/lib/finance/remittance";
import { isUsableImageUrl } from "@/lib/orders/proof-review";
import { recordRiderFeeForOrder } from "@/lib/riders/pay";

function serializeOrder(o: {
  subtotal: unknown;
  discount: unknown;
  deliveryFee: unknown;
  grandTotal: unknown;
  deliveryFeePaid: unknown;
  productAmountPaid: unknown;
  remainingAmount: unknown;
  [key: string]: unknown;
}) {
  const subtotal = toNumber(o.subtotal);
  const discount = toNumber(o.discount);
  const deliveryFee = toNumber(o.deliveryFee);
  const deliveryFeePaid = toNumber(o.deliveryFeePaid);
  const productAmountPaid = toNumber(o.productAmountPaid);
  return {
    ...o,
    subtotal,
    discount,
    deliveryFee,
    grandTotal: toNumber(o.grandTotal),
    deliveryFeePaid,
    productAmountPaid,
    remainingAmount: toNumber(o.remainingAmount),
    /** Cash to collect: products + delivery fee when the fee is cash (full COD) */
    cashDue: cashDueBreakdown({
      subtotal,
      discount,
      deliveryFee,
      deliveryFeePaid,
      productAmountPaid,
      deliveryFeePaymentStatus:
        typeof o.deliveryFeePaymentStatus === "string" ? o.deliveryFeePaymentStatus : null,
    }),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { session, rider } = await requireRider({ allowPending: true });
    const resource = req.nextUrl.searchParams.get("resource") || "dashboard";

    if (resource === "profile") {
      // O6: own details; payout numbers masked (****4567), ID documents not sent.
      return apiSuccess({
        rider: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          status: rider.status,
          isActive: rider.isActive,
          approvalStatus: rider.approvalStatus,
          reviewNotes: rider.reviewNotes,
          city: rider.city,
          vehicleType: rider.vehicleType,
          photoUrl: rider.photoUrl,
          cnicMasked: rider.cnicNumber
            ?`*****-*******-${String(rider.cnicNumber).replace(/\D/g, "").slice(-1)}`
            : null,
          documents: {
            cnicFront: Boolean(rider.cnicUrl),
            cnicBack: Boolean(rider.cnicBackUrl),
            license: Boolean(rider.licenseUrl),
            bike: Boolean(rider.bikeUrl),
            bikeCard: Boolean(rider.bikeCardUrl),
          },
          accountNumberMasked: maskTail(rider.accountNumber),
          accountTitle: rider.accountTitle,
          bankName: rider.bankName,
          jazzCashNumberMasked: maskTail(rider.jazzCashNumber),
          createdAt: rider.createdAt,
          approvedAt: rider.approvedAt,
        },
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        },
      });
    }

    // Pending / rejected riders only get profile + empty dashboard (RID-06)
    if (rider.approvalStatus !== "APPROVED" || !rider.isActive) {
      if (resource === "deliveries" || resource === "remittances") {
        return apiSuccess({
          items: [],
          pendingTotal: 0,
          pendingApproval: true,
          approvalStatus: rider.approvalStatus,
          reviewNotes: rider.reviewNotes,
        });
      }
      return apiSuccess({
        rider: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          status: rider.status,
          approvalStatus: rider.approvalStatus,
          reviewNotes: rider.reviewNotes,
          photoUrl: rider.photoUrl,
        },
        stats: {
          activeDeliveries: 0,
          deliveredToday: 0,
          pendingRemittanceCount: 0,
          pendingRemittanceAmount: 0,
        },
        recent: [],
        pendingApproval: true,
      });
    }

    if (resource === "deliveries") {
      const sp = req.nextUrl.searchParams;
      const status = sp.get("status");
      const q = (sp.get("q") || "").trim().slice(0, 30);
      const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
      const where: Prisma.OrderWhereInput = {
        riderId: rider.id,
        orderStatus: {
          in: [
            "ASSIGNED_TO_RIDER",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
            "FAILED",
            "RETURNED",
          ],
        },
      };
      const allowed = ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "RETURNED"];
      if (status && allowed.includes(status)) where.orderStatus = status as OrderStatus;
      if (q) where.orderNumber = { contains: q, mode: "insensitive" };

      const total = await prisma.order.count({ where });
      const items = await prisma.order.findMany({
        where,
        include: {
          items: true,
          fulfillments: { include: { store: { select: { name: true, phone: true } } } },
          customer: { select: { fullName: true, phone: true } },
          delivery: true,
          cashCollection: true,
          cashRemittance: true,
          paymentProofs: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take,
      });

      return apiSuccess({
        items: items.map(serializeOrder),
        pagination: paginationMeta(page, limit, total),
      });
    }

    if (resource === "remittances") {
      const items = await prisma.cashRemittance.findMany({
        where: { riderId: rider.id },
        include: {
          order: {
            select: {
              orderNumber: true,
              orderStatus: true,
              remainingAmount: true,
              productAmountPaid: true,
              customer: { select: { fullName: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return apiSuccess({
        items: items.map((r) => ({
          ...r,
          amount: toNumber(r.amount),
          order: r.order
            ? {
                ...r.order,
                remainingAmount: toNumber(r.order.remainingAmount),
                productAmountPaid: toNumber(r.order.productAmountPaid),
              }
            : null,
        })),
        pendingTotal: items
          .filter((r) => r.status === "PENDING" || r.status === "SUBMITTED")
          .reduce((sum, r) => sum + toNumber(r.amount), 0),
      });
    }

    // dashboard
    const [active, deliveredToday, pendingRemit, cash] = await Promise.all([
      prisma.order.count({
        where: {
          riderId: rider.id,
          orderStatus: { in: ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"] },
        },
      }),
      prisma.order.count({
        where: {
          riderId: rider.id,
          orderStatus: "DELIVERED",
          deliveredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      // Count of obligations still owed (any non-RECEIVED status).
      prisma.cashRemittance.count({
        where: {
          riderId: rider.id,
          status: { in: ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED", "OVERDUE"] },
        },
      }),
      riderCashSummary(rider.id),
    ]);

    const recent = await prisma.order.findMany({
      where: {
        riderId: rider.id,
        orderStatus: { in: ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"] },
      },
      include: {
        customer: { select: { fullName: true, phone: true } },
        cashRemittance: true,
        cashCollection: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    return apiSuccess({
      rider: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        status: rider.status,
      },
      stats: {
        activeDeliveries: active,
        deliveredToday,
        pendingRemittanceCount: pendingRemit,
        // Real money owed to MandiBazaar (outstanding, not total collected).
        pendingRemittanceAmount: cash.owedToPlatform,
        cashCollected: cash.cashCollected,
        cashRetained: cash.cashRetained,
        owedToPlatform: cash.owedToPlatform,
        overdueAmount: cash.overdue,
        codRestricted: cash.restricted,
      },
      recent: recent.map(serializeOrder),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    if (msg === "RIDER_PENDING_APPROVAL") {
      return apiError("Waiting for MandiBazaar approval before you can deliver", 403);
    }
    console.error("[rider:GET]", e);
    return apiError(toUserMessage(e), 500);
  }
}

export async function PATCH(req: Request) {
  try {
    // Profile edits are allowed while waiting for approval; every delivery
    // action below requires an APPROVED + active rider (RID-06).
    const { session, rider } = await requireRider({ allowPending: true });
    const body = await req.json();

    if (body?.action === "UPDATE_PROFILE") {
      return await updateRiderProfile(session.user.id, rider, body);
    }
    if (rider.approvalStatus !== "APPROVED" || !rider.isActive) {
      throw new Error("RIDER_PENDING_APPROVAL");
    }
    const { action, orderId, notes, amountCollected, failureReason } = body as {
      action: string;
      orderId?: string;
      notes?: string;
      amountCollected?: number;
      failureReason?: string;
    };

    if (action === "SET_STATUS") {
      const status = String(body.status || "").toUpperCase();
      if (!["AVAILABLE", "BUSY", "OFFLINE"].includes(status)) {
        return apiError("Invalid rider status", 400);
      }
      const updated = await prisma.rider.update({
        where: { id: rider.id },
        data: { status },
      });
      return apiSuccess(updated);
    }

    if (!orderId) return apiError("orderId required", 400);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        delivery: true,
        cashCollection: true,
        cashRemittance: true,
        paymentProofs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    if (!order) return apiError("Order not found", 404);
    if (order.riderId !== rider.id) {
      return apiError("This delivery is not assigned to you", 403);
    }

    const remaining = toNumber(order.remainingAmount);
    const needsCash =
      remaining > 0 &&
      (order.productPaymentStatus === "CASH_ON_DELIVERY" ||
        order.deliveryFeePaymentStatus === "CASH_ON_DELIVERY" ||
        order.productPaymentStatus === "PENDING" ||
        order.paymentMethod === "CASH_ON_DELIVERY" ||
        order.paymentMethod === "MIXED");
    /** Online product payment — rider must upload customer's payment screenshot */
    const needsOnlineProof =
      !needsCash &&
      remaining <= 0 &&
      // Paid in cash to the rider (COLLECT_CASH before delivery) — no screenshot needed
      !order.cashCollection &&
      (order.productPaymentStatus === "PAID" ||
        order.paymentMethod === "JAZZCASH");
    const hasApprovedProof = order.paymentProofs.some(
      (p) => p.status === "APPROVED"
    );

    // --- Upload online payment screenshot from customer ---
    if (action === "UPLOAD_PAYMENT_PROOF") {
      if (!needsOnlineProof && remaining > 0) {
        return apiError(
          "This order has COD remaining — collect cash instead of payment screenshot",
          400
        );
      }
      if (!["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY", "DELIVERED"].includes(order.orderStatus)) {
        return apiError("Upload proof only for active or delivered assignments", 400);
      }
      // QA S16: only an uploaded file or an https link; notes ≤ 500 characters
      const imageUrl = String(body.imageUrl || "").trim();
      if (!isUsableImageUrl(imageUrl)) {
        return apiFieldErrors({ imageUrl: "Upload a clear photo of the payment screenshot" });
      }
      const proofNotes = typeof notes === "string" ? notes.trim().slice(0, 500) : "";
      const waiting = await prisma.paymentProof.findFirst({
        where: { orderId, status: "PENDING_REVIEW" },
        select: { id: true, imageUrl: true },
      });
      if (waiting) {
        return apiError(
          waiting.imageUrl === imageUrl
            ? "This screenshot was already uploaded and is waiting for MandiBazaar review"
            : "A payment screenshot for this order is already waiting for MandiBazaar review",
          409
        );
      }

      const proof = await prisma.paymentProof.create({
        data: {
          orderId,
          riderId: rider.id,
          imageUrl,
          notes: proofNotes || "Customer online payment screenshot",
          status: "PENDING_REVIEW",
          uploadedById: session.user.id,
        },
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_PAYMENT_PROOF_UPLOADED",
        entity: "PaymentProof",
        entityId: proof.id,
        newValue: { orderId, imageUrl },
      });

      return apiSuccess({
        message: "Payment screenshot uploaded — MandiBazaar will review",
        proof,
      });
    }

    // --- Pick up from stores → Out for delivery ---
    if (action === "START_DELIVERY") {
      assertTransition(order.orderStatus, OrderStatus.OUT_FOR_DELIVERY);
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: "OUT_FOR_DELIVERY" },
        });
        await recordStatusEvent(tx, {
          orderId,
          status: "OUT_FOR_DELIVERY",
          actorId: session.user.id,
          actorRole: "RIDER",
        });
        await tx.delivery.upsert({
          where: { orderId },
          create: {
            orderId,
            riderId: rider.id,
            assignedAt: new Date(),
            pickedUpAt: new Date(),
          },
          update: { pickedUpAt: new Date(), riderId: rider.id },
        });
        await tx.storeFulfillment.updateMany({
          where: { orderId },
          data: { status: "OUT_FOR_DELIVERY", pickedUpAt: new Date() },
        });
        await tx.rider.update({
          where: { id: rider.id },
          data: { status: "BUSY" },
        });
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_START_DELIVERY",
        entity: "Order",
        entityId: orderId,
      });
      await notifyOrderEvent(
        orderId,
        "ORDER_STATUS",
        "Out for delivery",
        `Your order ${order.orderNumber} is out for delivery.`
      );
      return apiSuccess({ message: "Delivery started — out for delivery" });
    }

    // --- Mark delivered (+ optional COD collect) ---
    if (action === "MARK_DELIVERED") {
      assertTransition(order.orderStatus, OrderStatus.DELIVERED);

      if (needsOnlineProof && !hasApprovedProof) {
        const pending = order.paymentProofs.some(
          (p) => p.status === "PENDING_REVIEW"
        );
        return apiError(
          pending
            ? "Wait for MandiBazaar to approve the payment screenshot before marking delivered"
            : "Online payment order: upload customer's payment screenshot and wait for MandiBazaar approval before marking delivered",
          400
        );
      }

      if (needsCash && !order.cashCollection) {
        const amount =
          typeof amountCollected === "number" && amountCollected > 0
            ? amountCollected
            : remaining;
        if (amount <= 0) {
          return apiError("COD amount to collect is invalid", 400);
        }
        if (Math.abs(amount - remaining) > 0.01 && amount < remaining) {
          return apiError(
            `Collect full COD amount of Rs. ${remaining.toFixed(0)} (or exact remaining)`,
            400
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        // Lock the order row and re-check inside the transaction so a double
        // tap can't deliver (and finalize stock / collect cash) twice.
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        const fresh = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { orderStatus: true },
        });
        assertTransition(fresh.orderStatus, OrderStatus.DELIVERED);
        await tx.order.update({
          where: { id: orderId },
          data: {
            orderStatus: "DELIVERED",
            deliveredAt: new Date(),
          },
        });
        await recordStatusEvent(tx, {
          orderId,
          status: "DELIVERED",
          actorId: session.user.id,
          actorRole: "RIDER",
          note: "Marked delivered by rider",
        });
        await tx.delivery.upsert({
          where: { orderId },
          create: {
            orderId,
            riderId: rider.id,
            assignedAt: new Date(),
            deliveredAt: new Date(),
          },
          update: { deliveredAt: new Date() },
        });
        // H: fix the rider's pay for this delivery (idempotent)
        await recordRiderFeeForOrder(tx, orderId);
        await tx.storeFulfillment.updateMany({
          where: { orderId },
          data: { status: "DELIVERED" },
        });

        for (const item of order.items) {
          if (item.productId) {
            await finalizeSale(tx, {
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              orderId: order.id,
              createdById: session.user.id,
            });
          }
        }

        if (needsCash && !order.cashCollection) {
          await recordCodCash(tx, {
            orderId,
            riderId: rider.id,
            userId: session.user.id,
            requested: typeof amountCollected === "number" ? amountCollected : undefined,
            notes: notes || "Collected by rider on delivery",
            requireFull: true,
          });
        }
      });

      // If rider has no more active jobs, set AVAILABLE
      const stillActive = await prisma.order.count({
        where: {
          riderId: rider.id,
          orderStatus: { in: ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"] },
        },
      });
      if (stillActive === 0) {
        await prisma.rider.update({
          where: { id: rider.id },
          data: { status: "AVAILABLE" },
        });
      }

      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_MARK_DELIVERED",
        entity: "Order",
        entityId: orderId,
      });
      await notifyOrderEvent(
        orderId,
        "ORDER_STATUS",
        "Delivered",
        `Your order ${order.orderNumber} has been delivered.`
      );
      // Ask the customer to confirm receipt (single-use secure link).
      await sendDeliveryConfirmationRequest(orderId);
      const due = cashDueBreakdown({
        subtotal: toNumber(order.subtotal),
        discount: toNumber(order.discount),
        deliveryFee: toNumber(order.deliveryFee),
        deliveryFeePaid: toNumber(order.deliveryFeePaid),
        productAmountPaid: toNumber(order.productAmountPaid),
        deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      });
      return apiSuccess({
        message: needsCash
          ? `Delivered — ${collectCashLabel(due, "Collected")}. Submit the cash to MandiBazaar.`
          : needsOnlineProof
            ? "Delivered — payment screenshot was approved"
            : "Marked as delivered",
      });
    }

    // --- Collect COD separately (after delivery if missed) ---
    if (action === "COLLECT_CASH") {
      if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(order.orderStatus)) {
        return apiError("Collect cash only when out for delivery or delivered", 400);
      }
      if (order.cashCollection) {
        return apiError("Cash already collected for this order", 400);
      }
      const remaining = toNumber(order.remainingAmount);
      if (remaining <= 0) {
        return apiError("No COD remaining on this order", 400);
      }
      const amount =
        typeof amountCollected === "number" && amountCollected > 0
          ? amountCollected
          : remaining;
      if (amount > remaining + 0.01) {
        return apiError(`Cannot collect more than Rs. ${remaining.toFixed(0)}`, 400);
      }

      const collected = await prisma.$transaction((tx) =>
        recordCodCash(tx, {
          orderId,
          riderId: rider.id,
          userId: session.user.id,
          requested: amount,
          notes: notes || "Collected by rider",
          requireFull: false,
        })
      );

      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_CASH_COLLECTED",
        entity: "Order",
        entityId: orderId,
        newValue: { amount: collected },
      });
      return apiSuccess({
        message: `Rs ${collected.toLocaleString("en-PK")} cash collected — now submit remittance to MandiBazaar`,
      });
    }

    // --- Rider submits cash to MandiBazaar ---
    if (action === "SUBMIT_REMITTANCE") {
      if (!order.cashRemittance) {
        return apiError("No remittance record — collect COD first", 400);
      }
      if (order.cashRemittance.riderId !== rider.id) {
        return apiError("Remittance does not belong to you", 403);
      }
      if (order.cashRemittance.status === "RECEIVED") {
        return apiError("MandiBazaar already received this remittance", 400);
      }
      if (order.cashRemittance.status === "SUBMITTED") {
        return apiError("Already submitted — waiting for MandiBazaar confirmation", 400);
      }
      if (order.cashRemittance.status === "DISPUTED") {
        return apiError("Remittance is disputed — contact MandiBazaar", 400);
      }

      const updated = await prisma.cashRemittance.update({
        where: { orderId },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          notes:
            notes ||
            order.cashRemittance.notes ||
            "Rider submitted cash to MandiBazaar",
        },
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_REMITTANCE_SUBMITTED",
        entity: "CashRemittance",
        entityId: updated.id,
        newValue: { amount: toNumber(updated.amount) },
      });

      return apiSuccess({
        message: "Cash marked as submitted to MandiBazaar — awaiting confirmation",
        remittance: { ...updated, amount: toNumber(updated.amount) },
      });
    }

    // --- Delivery failed ---
    if (action === "MARK_FAILED") {
      assertTransition(order.orderStatus, OrderStatus.FAILED);
      if (!failureReason?.trim()) {
        return apiError("Please provide a failure reason", 400);
      }
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            orderStatus: "FAILED",
            cancelReason: failureReason.trim(),
          },
        });
        await tx.storeFulfillment.updateMany({
          where: { orderId },
          data: { status: "FAILED" },
        });
        await tx.delivery.upsert({
          where: { orderId },
          create: {
            orderId,
            riderId: rider.id,
            failedAt: new Date(),
            failureReason: failureReason.trim(),
          },
          update: {
            failedAt: new Date(),
            failureReason: failureReason.trim(),
          },
        });
        for (const item of order.items) {
          if (item.productId) {
            await releaseReservedStock(tx, {
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              orderId,
              createdById: session.user.id,
            });
          }
        }
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "RIDER_DELIVERY_FAILED",
        entity: "Order",
        entityId: orderId,
        newValue: { failureReason },
      });
      await notifyOrderEvent(
        orderId,
        "ORDER_STATUS",
        "Delivery failed",
        `Delivery attempt for ${order.orderNumber} failed. Support will contact you.`
      );
      return apiSuccess({ message: "Marked as failed" });
    }

    return apiError("Unknown action", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "CASH_ALREADY_COLLECTED") {
      return apiError("Cash was already collected for this order", 409);
    }
    if (msg === "NO_COD_REMAINING") return apiError("No cash is due on this order", 400);
    if (msg.startsWith("COD_NOT_FULL:")) {
      return apiError(
        `Collect the full cash amount of Rs. ${msg.split(":")[1]} before marking delivered`,
        400
      );
    }
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    if (msg === "RIDER_PENDING_APPROVAL") {
      return apiError("Waiting for MandiBazaar approval before you can deliver", 403);
    }
    console.error("[rider:PATCH]", e);
    return apiError(toUserMessage(e), 400);
  }
}

/** O6: rider may change vehicle type and payout details (name / CNIC / phone are fixed). */
async function updateRiderProfile(
  userId: string,
  rider: {
    id: string;
    vehicleType: string;
    accountNumber: string | null;
    accountTitle: string | null;
    bankName: string | null;
    jazzCashNumber: string | null;
  },
  body: Record<string, unknown>
) {
  const parsed = riderProfileUpdateSchema.safeParse(body);
  if (!parsed.success) return apiFieldErrors(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const data: Prisma.RiderUpdateInput = {};
  if (d.vehicleType !== undefined && d.vehicleType !== rider.vehicleType) data.vehicleType = d.vehicleType;
  if (d.accountNumber !== undefined) data.accountNumber = d.accountNumber;
  if (d.accountTitle !== undefined) data.accountTitle = d.accountTitle;
  if (d.bankName !== undefined) data.bankName = d.bankName;
  if (d.jazzCashNumber !== undefined) data.jazzCashNumber = d.jazzCashNumber;
  if (d.removeJazzCash) data.jazzCashNumber = null;
  if (d.removeBank) {
    data.accountNumber = null;
    data.bankName = null;
  }

  const nextAccount = data.accountNumber !== undefined ? (data.accountNumber as string | null) : rider.accountNumber;
  const nextJazz = data.jazzCashNumber !== undefined ? (data.jazzCashNumber as string | null) : rider.jazzCashNumber;
  if (!nextAccount && !nextJazz) {
    return apiFieldErrors({
      accountNumber: "Keep at least one payout method: a bank account or a JazzCash number",
    });
  }
  const nextTitle = data.accountTitle !== undefined ? (data.accountTitle as string | null) : rider.accountTitle;
  if (!nextTitle) {
    return apiFieldErrors({ accountTitle: "Enter the account holder's name" });
  }
  if (Object.keys(data).length === 0) return apiError("No changes to save", 400);

  await prisma.rider.update({ where: { id: rider.id }, data });
  await writeAuditLog({
    userId,
    action: "RIDER_PROFILE_UPDATED",
    entity: "Rider",
    entityId: rider.id,
    previousValue: {
      vehicleType: rider.vehicleType,
      accountNumber: maskTail(rider.accountNumber),
      jazzCashNumber: maskTail(rider.jazzCashNumber),
      bankName: rider.bankName,
      accountTitle: rider.accountTitle,
    },
    newValue: {
      ...(data.vehicleType !== undefined ? { vehicleType: data.vehicleType } : {}),
      ...(data.accountNumber !== undefined ? { accountNumber: maskTail(data.accountNumber as string | null) } : {}),
      ...(data.jazzCashNumber !== undefined ? { jazzCashNumber: maskTail(data.jazzCashNumber as string | null) } : {}),
      ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
      ...(data.accountTitle !== undefined ? { accountTitle: data.accountTitle } : {}),
    },
  });
  return apiSuccess({ message: "Profile updated" });
}

/**
 * Record COD cash inside a transaction: locks the order row, re-reads what is
 * still due, caps the payment at subtotal − discount (payment ledger) and
 * treats a duplicate CashCollection (P2002) as "already collected".
 * Returns the amount recorded.
 */
async function recordCodCash(
  tx: Prisma.TransactionClient,
  p: {
    orderId: string;
    riderId: string;
    userId: string;
    requested?: number;
    notes: string;
    requireFull: boolean;
  }
): Promise<number> {
  // Locks the row (SELECT … FOR UPDATE) and reads the current ledger.
  // CASH pays products first, then a cash-on-delivery delivery fee (full COD).
  const preview = await lockAndAddPayment(tx, p.orderId, "CASH", 0);
  const existing = await tx.cashCollection.findUnique({ where: { orderId: p.orderId } });
  if (existing) throw new Error("CASH_ALREADY_COLLECTED");
  const due = preview.remainingAmount;
  if (due <= 0) throw new Error("NO_COD_REMAINING");
  const requested =
    typeof p.requested === "number" && Number.isFinite(p.requested) && p.requested > 0
      ? p.requested
      : due;
  if (p.requireFull && requested + 0.01 < due) {
    throw new Error(`COD_NOT_FULL:${due.toFixed(0)}`);
  }
  // Re-run the capped ledger with the real amount (row is already locked).
  const ledger = await lockAndAddPayment(tx, p.orderId, "CASH", requested);
  const amount = ledger.applied;
  if (amount <= 0) throw new Error("NO_COD_REMAINING");

  try {
    await tx.cashCollection.create({
      data: {
        orderId: p.orderId,
        amountCollected: amount,
        riderId: p.riderId,
        collectedById: p.userId,
        notes: p.notes,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("CASH_ALREADY_COLLECTED");
    }
    throw e;
  }
  await tx.cashRemittance.upsert({
    where: { orderId: p.orderId },
    create: {
      orderId: p.orderId,
      riderId: p.riderId,
      amount,
      status: "PENDING",
      notes:
        ledger.feeApplied > 0
          ? `COD collected (products + delivery fee Rs ${ledger.feeApplied}) — remit to MandiBazaar`
          : "COD collected — remit to MandiBazaar",
    },
    update: { amount, riderId: p.riderId, status: "PENDING" },
  });
  await tx.order.update({
    where: { id: p.orderId },
    data: {
      productAmountPaid: ledger.productAmountPaid,
      deliveryFeePaid: ledger.deliveryFeePaid,
      remainingAmount: ledger.remainingAmount,
      productPaymentStatus: ledger.productFullyPaid ? "PAID" : "PARTIALLY_PAID",
    },
  });
  return amount;
}
