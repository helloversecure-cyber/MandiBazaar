import { NextRequest } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import {
  apiError,
  apiFieldErrors,
  apiSuccess,
  paginationMeta,
  parsePagination,
  toNumber,
} from "@/lib/utils";
import { zOrderNumber } from "@/lib/validators/pk";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { RefundStatus } from "@prisma/client";
import {
  advanceRefundStatus,
  createRefundRecord,
  getRefundableSummary,
} from "@/lib/orders/refunds";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const sp = req.nextUrl.searchParams;
    const mine = sp.get("mine") === "true";
    const orderKey = sp.get("order")?.trim();
    const isAdmin = [
      "SUPER_ADMIN",
      "ADMIN",
      "ORDER_MANAGER",
    ].includes(session.user.role);

    if (orderKey) {
      if (!isAdmin && !mine) {
        // customers can check refundable on own order via orders API; admins use this
      }
      if (!isAdmin) return apiError("Forbidden", 403);
      const summary = await getRefundableSummary(orderKey);
      if (!summary) return apiError("Order not found", 404);
      return apiSuccess(summary);
    }

    if (!mine && !isAdmin) return apiError("Forbidden", 403);

    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 100 });
    const status = sp.get("status");
    const q = (sp.get("q") || "").trim().slice(0, 40);
    const where = {
      ...(mine ? { requestedById: session.user.id } : {}),
      ...(status && ["PENDING", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"].includes(status)
        ? { status: status as RefundStatus }
        : {}),
      ...(q ? { order: { orderNumber: { contains: q, mode: "insensitive" as const } } } : {}),
    };
    const [total, items] = await Promise.all([prisma.refund.count({ where }), prisma.refund.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true,
            customerId: true,
            orderStatus: true,
          },
        },
        payment: {
          select: {
            method: true,
            amount: true,
            status: true,
            metadata: true,
          },
        },
        requestedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    })]);

    return apiSuccess({
      pagination: paginationMeta(page, limit, total),
      items: items.map((r) => ({
        ...r,
        amount: toNumber(r.amount),
        paymentAmount: r.payment ? toNumber(r.payment.amount) : null,
        latePayment: Boolean(
          r.payment?.metadata &&
            typeof r.payment.metadata === "object" &&
            (r.payment.metadata as { latePaymentOnTerminalOrder?: boolean })
              .latePaymentOnTerminalOrder
        ),
      })),
    });
  } catch {
    return apiError("Failed to load refunds", 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.REFUNDS_WRITE);
    const body = await req.json();
    // QA S15/P7: order number in the real format, reason required, amount ≤ paid − refunded
    const fieldErrors: Record<string, string> = {};
    let orderKey = "";
    if (body.orderNumber != null && String(body.orderNumber).trim()) {
      const parsed = zOrderNumber.safeParse(String(body.orderNumber));
      if (parsed.success) orderKey = parsed.data;
      else if (body.orderId && String(body.orderId).trim() !== String(body.orderNumber).trim()) {
        orderKey = String(body.orderId).trim();
      } else fieldErrors.orderNumber = parsed.error.issues[0]?.message || "Order number looks like ORD-20261031-000001";
    } else if (body.orderId != null && String(body.orderId).trim()) {
      orderKey = String(body.orderId).trim();
    } else {
      fieldErrors.orderNumber = "Enter the order number, e.g. ORD-20261031-000001";
    }
    const reason = String(body.reason || "").trim().slice(0, 500);
    if (reason.length < 3) fieldErrors.reason = "Please give a reason (at least 3 characters)";
    let amount: number | undefined;
    if (body.amount != null && String(body.amount).trim() !== "") {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 1) {
        fieldErrors.amount = "Refund amount must be at least Rs. 1";
      } else if (Math.round(amount * 100) !== amount * 100) {
        fieldErrors.amount = "Use at most 2 decimal places";
      }
    }
    if (Object.keys(fieldErrors).length) return apiFieldErrors(fieldErrors);

    const summary = await getRefundableSummary(orderKey);
    if (!summary) return apiFieldErrors({ orderNumber: "No order with this number" }, 404);
    if (amount != null && amount > summary.refundable + 0.001) {
      return apiFieldErrors({
        amount: `Refund cannot be more than Rs. ${summary.refundable} (paid online ${summary.successPaid} − already refunded or in progress ${summary.refundedOrReserved})`,
      });
    }

    const created = await createRefundRecord({
      orderId: summary.orderId,
      amount,
      reason,
      notes: body.notes ? String(body.notes) : null,
      requestedById: session.user.id,
      allowParallel: Boolean(body.allowParallel),
      autoApprove: Boolean(body.autoApprove),
    });

    if (!created.ok) return apiError(created.error, 400);

    const refund = await prisma.refund.findUnique({
      where: { id: created.refundId },
    });
    return apiSuccess(
      { ...refund, amount: created.amount, refundableLeft: summary.refundable - created.amount },
      201
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError(msg, 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.REFUNDS_WRITE);
    const body = await req.json();
    const id = String(body.id || "");
    const status = body.status as RefundStatus;
    if (!id || !status) return apiError("id and status required", 400);

    const result = await advanceRefundStatus({
      refundId: id,
      status,
      actorId: session.user.id,
      notes: body.notes != null ? String(body.notes) : undefined,
      externalReference:
        body.externalReference != null
          ? String(body.externalReference)
          : undefined,
    });

    if (!result.ok) return apiError(result.error, 400);

    const updated = await prisma.refund.findUnique({ where: { id } });
    return apiSuccess(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError(msg, 400);
  }
}
