import { NextRequest } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import {
  ORDER_STATUS_LABELS,
  canAssignRider,
  validateAdminStatusChange,
} from "@/lib/orders/state-machine";
import { finalizeSale, releaseReservedStock, restockReturnedSale } from "@/lib/inventory/stock";
import { markRemittanceReceived } from "@/lib/finance/admin-remittance";
import { writeAuditLog } from "@/lib/audit";
import {
  notifyOrderEvent,
  notifyRiderAssignment,
} from "@/lib/notifications/service";
import {
  apiError,
  apiSuccess,
  paginationMeta,
  parsePagination,
  toNumber,
} from "@/lib/utils";
import { OrderStatus, Prisma } from "@prisma/client";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getUserStoreIds } from "@/lib/stores/access";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { isJazzCashConfigured } from "@/lib/payments/jazzcash";
import { isJazzCashQrEnabled } from "@/lib/payments/jazzcash-qr";
import { cancelOrderInTx } from "@/lib/orders/cancel-order";
import { syncFulfillmentsToOrderStatus } from "@/lib/orders/fulfillment-sync";
import { recordStatusEvent } from "@/lib/orders/status-events";
import { sendDeliveryConfirmationRequest } from "@/lib/orders/delivery-confirm";
import {
  pendingPaymentTtlMinutes,
  sweepExpiredPendingPayments,
} from "@/lib/orders/expire-pending";
import {
  customerDisplayPhone,
  orderWaitingFlag,
  waitingTooLongWhere,
} from "@/lib/orders/attention";
import { normalizePkPhone } from "@/lib/validators/pk";
import { recordRiderFeeForOrder } from "@/lib/riders/pay";
import { lockAndAddPayment } from "@/lib/orders/payment-ledger";
import { cashDueBreakdown, deliveryFeePaymentLabel, feeIsCashOnDelivery } from "@/lib/orders/full-cod";
import { remittanceDue, deadlineFrom, remittanceDeadlineHours } from "@/lib/finance/remittance";
import { notifyCodCollected } from "@/lib/notifications/remittance-events";

const CUSTOMER_CANCELABLE: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
];

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "DELIVERY_MANAGER"];

const ORDER_STATUSES = Object.values(OrderStatus) as string[];

function parseDay(raw: string | null, endOfDay: boolean): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Orders list.
 * Customers / store owners / riders: their own orders (page, limit, status, q = order number).
 * Admins (QA P2/Q4/R6): q = order number, customer name or phone; from/to (YYYY-MM-DD);
 * storeId; status; waiting=1 (waiting too long). 25 per page in the admin UI.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const sp = req.nextUrl.searchParams;
    const { page, limit, skip, take } = parsePagination(sp, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    const status = sp.get("status");
    const isAdmin = ADMIN_ROLES.includes(session.user.role);

    if (isAdmin && sp.get("meta") === "stores") {
      // Store filter options for the admin orders list: every store that has orders
      const rows = await prisma.orderItem.groupBy({
        by: ["storeId", "storeName"],
        orderBy: { storeName: "asc" },
      });
      const seen = new Map<string, string>();
      for (const r of rows) if (!seen.has(r.storeId)) seen.set(r.storeId, r.storeName);
      return apiSuccess({
        stores: Array.from(seen.entries()).map(([id, name]) => ({ id, name })),
      });
    }

    if (isAdmin) {
      // Unpaid orders past the payment window must not linger (QA N2/CHK-08).
      // Bounded and cooled down, awaited so it is not cut off on serverless.
      try {
        await sweepExpiredPendingPayments({ limit: 20 });
      } catch {
        /* never block the list */
      }
    }

    const and: Prisma.OrderWhereInput[] = [];
    const isStoreOwner = !isAdmin && session.user.role === "STORE_OWNER";
    let ownerStoreIds: string[] = [];
    if (!isAdmin) {
      if (session.user.role === "STORE_OWNER") {
        ownerStoreIds = await getUserStoreIds(session.user.id);
        and.push({ items: { some: { storeId: { in: ownerStoreIds } } } });
      } else if (session.user.role === "RIDER") {
        const rider = await prisma.rider.findUnique({
          where: { userId: session.user.id },
        });
        if (!rider) return apiError("Rider profile not found", 403);
        and.push({ riderId: rider.id });
      } else {
        and.push({ customerId: session.user.id });
      }
    }
    if (status) {
      if (!ORDER_STATUSES.includes(status)) return apiError("Unknown order status", 400);
      and.push({ orderStatus: status as OrderStatus });
    }

    const q = (sp.get("q") || "").trim().slice(0, 80);
    if (q) {
      if (isAdmin) {
        const digits = q.replace(/\D/g, "");
        const phoneForms = new Set<string>([q]);
        const normalized = normalizePkPhone(q);
        if (normalized) phoneForms.add(normalized);
        if (digits.length >= 4) phoneForms.add(digits);
        if (digits.startsWith("03") && digits.length === 11) {
          phoneForms.add(`${digits.slice(0, 4)}-${digits.slice(4)}`);
          phoneForms.add(`+92${digits.slice(1)}`);
          phoneForms.add(`92${digits.slice(1)}`);
        }
        const or: Prisma.OrderWhereInput[] = [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { customer: { fullName: { contains: q, mode: "insensitive" } } },
        ];
        for (const p of Array.from(phoneForms)) {
          or.push({ customer: { phone: { contains: p } } });
          or.push({ deliveryAddressSnapshot: { path: ["phone"], string_contains: p } });
        }
        and.push({ OR: or });
      } else {
        and.push({ orderNumber: { contains: q, mode: "insensitive" } });
      }
    }

    if (isAdmin) {
      const from = parseDay(sp.get("from"), false);
      const to = parseDay(sp.get("to"), true);
      if (sp.get("from") && !from) return apiError("from must be a date (YYYY-MM-DD)", 400);
      if (sp.get("to") && !to) return apiError("to must be a date (YYYY-MM-DD)", 400);
      if (from && to && from > to) return apiError("The start date is after the end date", 400);
      if (from || to) {
        and.push({
          createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) },
        });
      }
      const storeId = (sp.get("storeId") || "").trim();
      if (storeId) and.push({ items: { some: { storeId } } });
      if (sp.get("waiting") === "1") {
        and.push(waitingTooLongWhere(Date.now(), pendingPaymentTtlMinutes()));
      }
    }

    const where: Prisma.OrderWhereInput = and.length ? { AND: and } : {};

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          items: true,
          fulfillments: true,
          customer: {
            select: { id: true, fullName: true, phone: true, email: true },
          },
          // Public rider fields only — never CNIC, account numbers or ID document URLs
          rider: { select: { id: true, name: true, phone: true, vehicleType: true, photoUrl: true } },
          cashCollection: true,
          cashRemittance: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    const now = Date.now();
    const ttl = pendingPaymentTtlMinutes();
    const isPhone = (v: string) => normalizePkPhone(v) != null;

    return apiSuccess({
      items: orders.map((o) => {
        const base = {
          ...o,
          subtotal: toNumber(o.subtotal),
          discount: toNumber(o.discount),
          deliveryFee: toNumber(o.deliveryFee),
          grandTotal: toNumber(o.grandTotal),
          deliveryFeePaid: toNumber(o.deliveryFeePaid),
          productAmountPaid: toNumber(o.productAmountPaid),
          remainingAmount: toNumber(o.remainingAmount),
        };
        const money = {
          /** Full cash on delivery: products + delivery fee in cash to the rider */
          fullCod: feeIsCashOnDelivery(o) && base.deliveryFee > 0,
          deliveryFeePaymentLabel: deliveryFeePaymentLabel(base),
          cashDue: cashDueBreakdown({ ...base, deliveryFeePaymentStatus: o.deliveryFeePaymentStatus }),
        };
        if (isStoreOwner) {
          // A store owner only sees their OWN store's line items, and never the
          // customer's email or the rider's cash-remittance details (cross-tenant).
          const { customer, cashRemittance: _cr, cashCollection: _cc, ...rest } = base;
          void _cr;
          void _cc;
          return {
            ...rest,
            ...money,
            items: o.items.filter((i) => ownerStoreIds.includes(i.storeId)),
            customer: customer
              ? { id: customer.id, fullName: customer.fullName, phone: customer.phone }
              : null,
          };
        }
        if (!isAdmin) return { ...base, ...money };
        const snap = (o.deliveryAddressSnapshot || {}) as { phone?: string; fullName?: string };
        const display = customerDisplayPhone(o.customer?.phone, snap.phone, isPhone);
        return {
          ...base,
          ...money,
          customerPhone: display.phone,
          customerPhoneSource: display.source,
          accountPhoneInvalid: display.accountPhoneInvalid,
          stores: Array.from(new Set(o.items.map((i) => i.storeName))),
          waitingFlag: orderWaitingFlag(o, now, ttl),
        };
      }),
      pagination: paginationMeta(page, limit, total),
    });
  } catch (e) {
    console.error("[GET /api/orders]", e);
    return apiError("Failed to load orders", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    const body = await req.json();

    if (body.action === "CANCEL") {
      const order = await prisma.order.findUnique({
        where: { id: body.orderId },
      });
      if (!order) return apiError("Order not found", 404);

      const isAdmin = ADMIN_ROLES.includes(session.user.role);
      const isOwner = order.customerId === session.user.id;

      if (!isAdmin && !isOwner) return apiError("Forbidden", 403);

      if (order.orderStatus === "CANCELLED") {
        return apiSuccess({ message: "Order already cancelled" });
      }

      if (!isAdmin && !CUSTOMER_CANCELABLE.includes(order.orderStatus)) {
        return apiError(
          "This order can no longer be cancelled. Contact support if you need help.",
          400
        );
      }

      const typedReason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (isAdmin && !isOwner && !typedReason) {
        return apiError("Please give a reason for cancelling", 400);
      }
      const reason = typedReason || "Cancelled by customer";

      return cancelAndRespond({
        orderId: order.id,
        orderNumber: order.orderNumber,
        reason,
        actorId: session.user.id,
        by: isAdmin && !isOwner ? "admin" : "customer",
      });
    }

    if (body.action === "RESUME_PAYMENT") {
      try {
        const pendingOrder = await prisma.order.findFirst({
          where: {
            id: String(body.orderId),
            customerId: session.user.id,
            orderStatus: "PENDING_PAYMENT",
          },
          include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
        });
        if (!pendingOrder) {
          return apiError("Order not found or does not need payment", 404);
        }

        const tillQr = pendingOrder.payments.some((p) => {
          const m = p.metadata as Record<string, unknown> | null;
          return m?.flow === "till_qr" || m?.provider === "jazzcash_till_qr";
        });

        if (tillQr && isJazzCashQrEnabled()) {
          const { getJazzCashQrPublicConfig } = await import(
            "@/lib/payments/jazzcash-qr"
          );
          const cfg = getJazzCashQrPublicConfig();
          if (!cfg.enabled) {
            return apiError("JazzCash QR is not available", 503);
          }
          const feePending = ["PENDING", "INITIATED", "FAILED"].includes(
            pendingOrder.deliveryFeePaymentStatus
          );
          const productPending =
            pendingOrder.productPaymentStatus === "PENDING" ||
            pendingOrder.productPaymentStatus === "FAILED";
          const productTotal = Math.max(
            0,
            Number(pendingOrder.subtotal) - Number(pendingOrder.discount)
          );
          let amountPkr = 0;
          if (feePending && productPending) {
            amountPkr = Number(pendingOrder.grandTotal);
          } else if (feePending) {
            amountPkr = Number(pendingOrder.deliveryFee);
          } else if (productPending) {
            amountPkr = productTotal;
          } else {
            amountPkr = Number(pendingOrder.grandTotal);
          }
          return apiSuccess({
            orderNumber: pendingOrder.orderNumber,
            jazzcashQr: {
              amountPkr,
              tillId: cfg.tillId,
              merchantName: cfg.merchantName,
              qrImageUrl: cfg.qrImageUrl,
              ussdHint: cfg.ussdHint,
              orderId: pendingOrder.id,
              orderNumber: pendingOrder.orderNumber,
            },
            requiresJazzCashQr: true,
          });
        }

        if (isStripeConfigured()) {
          const { resumeStripePayment } = await import("@/lib/payments/stripe");
          const result = await resumeStripePayment(
            String(body.orderId),
            session.user.id
          );
          return apiSuccess({
            orderNumber: result.order.orderNumber,
            stripeCheckout: {
              url: null,
              sessionId: result.checkout.paymentIntentId,
              clientSecret: result.checkout.clientSecret,
              publishableKey: result.checkout.publishableKey,
              mode: result.checkout.mode,
              amountPkr: result.checkout.amountPkr,
            },
            requiresStripe: true,
          });
        }
        if (isJazzCashConfigured()) {
          const { resumeOrderPayment } = await import("@/lib/payments/jazzcash");
          const result = await resumeOrderPayment(
            String(body.orderId),
            session.user.id
          );
          return apiSuccess({
            orderNumber: result.order.orderNumber,
            paymentForm: result.paymentForm,
            requiresJazzCash: true,
          });
        }
        if (isJazzCashQrEnabled()) {
          const { getJazzCashQrPublicConfig } = await import(
            "@/lib/payments/jazzcash-qr"
          );
          const cfg = getJazzCashQrPublicConfig();
          if (cfg.enabled) {
            return apiSuccess({
              orderNumber: pendingOrder.orderNumber,
              jazzcashQr: {
                amountPkr: Number(pendingOrder.grandTotal),
                tillId: cfg.tillId,
                merchantName: cfg.merchantName,
                qrImageUrl: cfg.qrImageUrl,
                ussdHint: cfg.ussdHint,
                orderId: pendingOrder.id,
                orderNumber: pendingOrder.orderNumber,
              },
              requiresJazzCashQr: true,
            });
          }
        }
        return apiError(
          "Online payment is temporarily unavailable. Please try again later.",
          503
        );
      } catch (e) {
        return apiError(
          e instanceof Error ? e.message : "Cannot resume payment",
          400
        );
      }
    }

    if (body.action === "REORDER") {
      const order = await prisma.order.findUnique({
        where: { id: body.orderId },
        include: { items: true },
      });
      if (!order) return apiError("Order not found", 404);
      if (order.customerId !== session.user.id) {
        return apiError("Forbidden", 403);
      }

      const cart = await prisma.cart.upsert({
        where: { userId: session.user.id },
        create: { userId: session.user.id },
        update: {},
      });

      let added = 0;
      let capped = false;
      for (const item of order.items) {
        if (!item.productId) continue;
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: { variants: true },
        });
        if (!product || product.status !== "ACTIVE") continue;

        // Cap at what's actually available now (variant-aware), mirroring cart add —
        // a reorder must never push the cart past current stock.
        let available = product.stockQuantity - product.reservedStock;
        if (item.variantId) {
          const variant = product.variants.find((v) => v.id === item.variantId);
          if (!variant || !variant.isActive) continue;
          available = variant.stockQuantity - variant.reservedStock;
        }
        available = Math.max(0, available);
        if (available <= 0) continue;

        const existing = await prisma.cartItem.findFirst({
          where: {
            cartId: cart.id,
            productId: item.productId,
            variantId: item.variantId || null,
          },
        });
        const current = existing?.quantity ?? 0;
        let nextQty = current + item.quantity;
        if (nextQty > available) {
          nextQty = available;
          capped = true;
        }
        if (nextQty <= current) continue; // already at/over stock — nothing to add

        if (existing) {
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity: nextQty },
          });
        } else {
          await prisma.cartItem.create({
            data: {
              cartId: cart.id,
              productId: item.productId,
              variantId: item.variantId || null,
              quantity: nextQty,
            },
          });
        }
        added++;
      }

      if (!added) {
        return apiError("No available products from this order to reorder", 400);
      }
      return apiSuccess({
        message: capped
          ? `${added} item(s) added to cart — some quantities were reduced to match current stock.`
          : `${added} item(s) added to cart`,
        added,
        capped,
      });
    }

    if (body.action === "REQUEST_REFUND") {
      const order = await prisma.order.findUnique({
        where: { id: body.orderId },
      });
      if (!order) return apiError("Order not found", 404);
      if (order.customerId !== session.user.id) {
        return apiError("Forbidden", 403);
      }

      // Delivered/cancelled paid orders can request refund; not while pending payment unpaid
      if (order.orderStatus === "PENDING_PAYMENT") {
        return apiError(
          "Complete or cancel payment first — there is nothing to refund yet",
          400
        );
      }

      const { createRefundRecord, getRefundableSummary } = await import(
        "@/lib/orders/refunds"
      );
      const summary = await getRefundableSummary(order.id);
      if (!summary || summary.refundable <= 0) {
        return apiError("No online payment to refund on this order", 400);
      }

      const reason =
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : "Customer refund request";

      const created = await createRefundRecord({
        orderId: order.id,
        amount: body.amount ? Number(body.amount) : undefined,
        reason,
        requestedById: session.user.id,
        allowParallel: false,
      });

      if (!created.ok) return apiError(created.error, 400);

      await writeAuditLog({
        userId: session.user.id,
        action: "REFUND_REQUESTED",
        entity: "Refund",
        entityId: created.refundId,
        newValue: { amount: created.amount, reason },
      });

      const refund = await prisma.refund.findUnique({
        where: { id: created.refundId },
      });
      return apiSuccess(refund, 201);
    }

    await requireAdmin(PERMISSIONS.ORDERS_WRITE);
    const {
      orderId,
      orderStatus,
      riderId,
      collectCash,
      amountCollected,
      notes,
      receiveRemittance,
    } = body;

    const order = await prisma.order.findUnique({
      where: { id: String(orderId || "") },
      include: {
        items: true,
        fulfillments: true,
        customer: true,
        cashCollection: true,
        cashRemittance: true,
      },
    });
    if (!order) return apiError("Order not found", 404);

    // --- Record COD cash (admin) -------------------------------------------
    if (collectCash) {
      const remaining = toNumber(order.remainingAmount);
      const codOrder =
        order.productPaymentStatus === "CASH_ON_DELIVERY" ||
        order.productPaymentStatus === "PARTIALLY_PAID" ||
        // Full cash on delivery: the delivery fee is collected in cash too
        order.deliveryFeePaymentStatus === "CASH_ON_DELIVERY";
      if (!codOrder) {
        return apiError(
          "This order's products are not cash on delivery — there is no cash to collect",
          400
        );
      }
      if (
        ["PENDING_PAYMENT", "CANCELLED", "FAILED", "RETURNED"].includes(order.orderStatus)
      ) {
        return apiError(
          `Cannot record cash on a ${ORDER_STATUS_LABELS[order.orderStatus]} order`,
          400
        );
      }
      if (order.cashCollection) {
        return apiError("Cash was already recorded for this order", 400);
      }
      if (remaining <= 0) return apiError("No cash left to collect on this order", 400);
      const amount =
        amountCollected == null || amountCollected === ""
          ? remaining
          : Number(amountCollected);
      if (!Number.isFinite(amount) || amount <= 0) {
        return apiError("Enter the cash amount collected", 400);
      }
      if (amount > remaining + 0.001) {
        return apiError(
          `Cannot collect more than the Rs. ${remaining.toFixed(0)} still due`,
          400
        );
      }

      const deadlineHours = await remittanceDeadlineHours();
      try {
        await prisma.$transaction(async (tx) => {
          // Locks the row; CASH pays products first, then a cash delivery fee (full COD)
          const ledger = await lockAndAddPayment(tx, order.id, "CASH", amount);
          const fresh = ledger.order;
          const freshRemaining = toNumber(fresh.remainingAmount);
          if (amount > freshRemaining + 0.001 || ledger.excess > 0.001) {
            throw new Error("CASH_ALREADY_RECORDED");
          }
          // CashCollection.orderId is unique → a double click cannot record twice
          await tx.cashCollection.create({
            data: {
              orderId: order.id,
              amountCollected: amount,
              riderId: fresh.riderId,
              notes: typeof notes === "string" ? notes.slice(0, 500) : undefined,
              collectedById: session.user.id,
            },
          });
          // A remittance is the rider owing cash to the platform — only when a rider
          // actually holds the cash (QA P7: no remittance on orders without a rider).
          if (fresh.riderId) {
            // The rider RETAINS the delivery fee they just collected in cash (if any)
            // and remits only the product money. Delivery fee paid online = retained 0.
            const cashFeeRetained = toNumber(ledger.deliveryFeePaid) - toNumber(order.deliveryFeePaid);
            const due = remittanceDue(amount, cashFeeRetained);
            const collectedAt = new Date();
            const dueAt = deadlineFrom(collectedAt, deadlineHours);
            await tx.cashRemittance.create({
              data: {
                orderId: order.id,
                riderId: fresh.riderId,
                amount,
                amountDue: due,
                collectedAt,
                dueAt,
                status: "PENDING",
                notes: "COD collected — pending remit to MandiBazaar",
              },
            });
          }
          await tx.order.update({
            where: { id: order.id },
            data: {
              productAmountPaid: ledger.productAmountPaid,
              deliveryFeePaid: ledger.deliveryFeePaid,
              remainingAmount: ledger.remainingAmount,
              productPaymentStatus: ledger.productFullyPaid ? "PAID" : "PARTIALLY_PAID",
            },
          });
        });
      } catch (e) {
        if (
          (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") ||
          (e instanceof Error && e.message === "CASH_ALREADY_RECORDED")
        ) {
          return apiError("Cash was already recorded for this order", 409);
        }
        throw e;
      }
      await writeAuditLog({
        userId: session.user.id,
        action: "CASH_COLLECTED",
        entity: "Order",
        entityId: order.id,
        newValue: { amount, riderId: order.riderId },
      });
      // A remittance obligation now exists for this rider — alert admins (best-effort).
      if (order.riderId) await notifyCodCollected(order.id);
      return apiSuccess({
        message: order.riderId
          ? "Cash recorded — rider remittance pending to MandiBazaar"
          : "Cash recorded as received",
      });
    }

    // --- Mark a rider's remittance received -------------------------------
    if (receiveRemittance) {
      const rem = order.cashRemittance;
      if (!rem || !rem.riderId) {
        return apiError("This order has no rider cash remittance to receive", 400);
      }
      // Settling a rider's COD obligation is a remittance-supervisor action, not a
      // plain order edit. Require the remittance permission and route through the one
      // authoritative, row-locked path (markRemittanceReceived) so the submission
      // ledger, amountRemitted and the rider's COD restriction all stay correct.
      await requireAdmin(PERMISSIONS.REMITTANCES_WRITE);
      const result = await markRemittanceReceived(session.user.id, rem.id, {
        notes: typeof notes === "string" ? notes : undefined,
      });
      return apiSuccess({ message: "Remittance recorded", ...result });
    }

    // --- Assign / re-assign rider -----------------------------------------
    const wantsAssign =
      body.action === "ASSIGN_RIDER" ||
      (orderStatus === "ASSIGNED_TO_RIDER" && riderId);
    if (wantsAssign) {
      const rid = String(riderId || "");
      if (!rid) return apiError("Choose a rider to assign", 400);
      if (!canAssignRider(order.orderStatus)) {
        return apiError(
          `A rider can be assigned only when the order is Ready for Dispatch (now ${ORDER_STATUS_LABELS[order.orderStatus]})`,
          400
        );
      }
      const rider = await prisma.rider.findUnique({ where: { id: rid } });
      if (!rider || rider.approvalStatus !== "APPROVED" || !rider.isActive) {
        return apiError("Choose an approved, active rider", 400);
      }
      // Same rule as self-serve bidding: a rider with unremitted overdue COD can't
      // take new deliveries until they settle (don't bypass it via admin assignment).
      if (rider.codRestrictedAt) {
        return apiError(
          "This rider has overdue COD cash and can't take new deliveries until it's settled.",
          400
        );
      }
      if (order.riderId === rid && order.orderStatus === "ASSIGNED_TO_RIDER") {
        return apiError("This rider is already assigned", 400);
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: OrderStatus.ASSIGNED_TO_RIDER, riderId: rid },
        });
        await tx.delivery.upsert({
          where: { orderId: order.id },
          create: { orderId: order.id, riderId: rid, assignedAt: new Date() },
          update: { riderId: rid, assignedAt: new Date() },
        });
        await syncFulfillmentsToOrderStatus(tx, order.id, OrderStatus.ASSIGNED_TO_RIDER);
      });

      const addr = order.deliveryAddressSnapshot as {
        houseBuilding?: string;
        area?: string;
        city?: string;
        fullName?: string;
        phone?: string;
      };
      const dropAddress = [addr.fullName, addr.phone, addr.houseBuilding, addr.area, addr.city]
        .filter(Boolean)
        .join(", ");
      const pickupLines = order.fulfillments.map((f) => {
        const p = f.pickupAddress as { name?: string; addressLine?: string; city?: string };
        return `${p.name || "Store"} — ${p.addressLine || ""}, ${p.city || ""}`;
      });
      if (pickupLines.length === 0) {
        pickupLines.push(...Array.from(new Set(order.items.map((i) => `${i.storeName}`))));
      }
      await notifyRiderAssignment({
        orderId: order.id,
        orderNumber: order.orderNumber,
        riderPhone: rider.phone,
        riderUserId: rider.userId,
        pickupLines,
        dropAddress,
        cashToCollect: toNumber(order.remainingAmount),
      });

      await writeAuditLog({
        userId: session.user.id,
        action: order.riderId && order.riderId !== rid ? "ORDER_RIDER_REASSIGNED" : "ORDER_STATUS_CHANGED",
        entity: "Order",
        entityId: order.id,
        previousValue: { status: order.orderStatus, riderId: order.riderId },
        newValue: { status: "ASSIGNED_TO_RIDER", riderId: rid },
      });
      if (order.orderStatus !== "ASSIGNED_TO_RIDER") {
        await notifyOrderEvent(
          order.id,
          "ORDER_STATUS",
          "Order update",
          `Your order ${order.orderNumber} has been assigned to a rider.`
        );
      }
      return apiSuccess({ message: `Rider ${rider.name} assigned` });
    }

    // --- Status change -----------------------------------------------------
    if (orderStatus) {
      const to = String(orderStatus) as OrderStatus;
      const reason = typeof notes === "string" ? notes.trim().slice(0, 500) : "";
      const err = validateAdminStatusChange(
        {
          orderStatus: order.orderStatus,
          riderId: order.riderId,
          remainingAmount: toNumber(order.remainingAmount),
          cashCollected: !!order.cashCollection,
        },
        to,
        { riderId: riderId ? String(riderId) : null, reason }
      );
      if (err) return apiError(err, 400);

      if (to === OrderStatus.CANCELLED) {
        return cancelAndRespond({
          orderId: order.id,
          orderNumber: order.orderNumber,
          reason,
          actorId: session.user.id,
          by: "admin",
        });
      }

      if (to === OrderStatus.FAILED) {
        const result = await prisma.$transaction((tx) =>
          cancelOrderInTx(tx, order.id, {
            reason,
            actorId: session.user.id,
            status: OrderStatus.FAILED,
            onlyIfStatusIn: [order.orderStatus],
          })
        );
        if (!result.cancelled) {
          return apiError("The order changed meanwhile — reload and try again", 409);
        }
      } else {
        const changed = await prisma.$transaction(async (tx) => {
          // Guard against a concurrent change (stale page)
          const upd = await tx.order.updateMany({
            where: { id: order.id, orderStatus: order.orderStatus },
            data: {
              orderStatus: to,
              ...(to === "DELIVERED" ? { deliveredAt: new Date() } : {}),
              ...(to === "RETURNED" ? { cancelReason: reason } : {}),
            },
          });
          if (upd.count !== 1) return false;

          await recordStatusEvent(tx, {
            orderId: order.id,
            status: to,
            actorId: session.user.id,
            actorRole: "ADMIN",
            note: reason || null,
          });

          if (to === "DELIVERED") {
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
            await tx.delivery.updateMany({
              where: { orderId: order.id },
              data: { deliveredAt: new Date() },
            });
            // H: fix the rider's pay for this delivery (idempotent)
            await recordRiderFeeForOrder(tx, order.id);
          }

          if (to === "RETURNED") {
            // Put the goods back: a DELIVERED order had its stock finalized (restock
            // + reduce sold); a pre-delivered order still has it reserved (release it).
            const wasDelivered = order.orderStatus === "DELIVERED";
            for (const item of order.items) {
              if (!item.productId) continue;
              if (wasDelivered) {
                await restockReturnedSale(tx, {
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  orderId: order.id,
                  createdById: session.user.id,
                });
              } else {
                await releaseReservedStock(tx, {
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  orderId: order.id,
                  createdById: session.user.id,
                });
              }
            }
          }
          await syncFulfillmentsToOrderStatus(tx, order.id, to);
          return true;
        });
        if (!changed) {
          return apiError("The order changed meanwhile — reload and try again", 409);
        }
        // Ask the customer to confirm receipt once an admin marks it delivered.
        if (to === "DELIVERED") {
          await sendDeliveryConfirmationRequest(order.id);
        }
        // A returned order refunds any money already paid (same as cancel). No-op
        // for unpaid COD orders — createRefundAfterCancel only acts on a paid amount.
        if (to === "RETURNED") {
          const { createRefundAfterCancel } = await import("@/lib/orders/refunds");
          await createRefundAfterCancel({
            orderId: order.id,
            requestedById: session.user.id,
            reason: `Order returned — ${reason || "returned"}`,
          }).catch((e) => {
            console.error("[order-returned] auto-refund failed", order.id, e instanceof Error ? e.message : e);
          });
        }
      }

      await writeAuditLog({
        userId: session.user.id,
        action: "ORDER_STATUS_CHANGED",
        entity: "Order",
        entityId: order.id,
        previousValue: { status: order.orderStatus },
        newValue: { status: to, ...(reason ? { reason } : {}) },
      });

      await notifyOrderEvent(
        order.id,
        "ORDER_STATUS",
        "Order update",
        `Your order ${order.orderNumber} is now ${ORDER_STATUS_LABELS[to].toLowerCase()}.`
      );

      return apiSuccess({ message: `Order moved to ${ORDER_STATUS_LABELS[to]}` });
    }

    return apiError("No changes provided");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError(msg, 400);
  }
}

/** Shared cancel (customer + admin): release stock/coupon, audit, notify, auto-refund. */
async function cancelAndRespond(opts: {
  orderId: string;
  orderNumber: string;
  reason: string;
  actorId: string;
  by: "admin" | "customer";
}) {
  const result = await prisma.$transaction((tx) =>
    cancelOrderInTx(tx, opts.orderId, { reason: opts.reason, actorId: opts.actorId })
  );
  if (!result.cancelled) {
    if (result.reason === "ALREADY") {
      return apiSuccess({ message: "Order already cancelled" });
    }
    return apiError(
      result.previousStatus
        ? `Cannot cancel a ${ORDER_STATUS_LABELS[result.previousStatus]} order`
        : "Order not found",
      400
    );
  }

  await writeAuditLog({
    userId: opts.actorId,
    action: "ORDER_CANCELLED",
    entity: "Order",
    entityId: opts.orderId,
    previousValue: { status: result.previousStatus },
    newValue: { reason: opts.reason, by: opts.by },
  });

  await notifyOrderEvent(
    opts.orderId,
    "ORDER_CANCELLED",
    "Order cancelled",
    `Order ${opts.orderNumber} was cancelled.`
  );

  const { createRefundAfterCancel } = await import("@/lib/orders/refunds");
  const refundResult = await createRefundAfterCancel({
    orderId: opts.orderId,
    requestedById: opts.actorId,
    reason: `Order cancelled — ${opts.reason}`,
  });

  return apiSuccess({
    message: "Order cancelled",
    refund: refundResult.created
      ? {
          created: true,
          refundId: refundResult.refundId,
          detail: refundResult.message,
        }
      : { created: false, detail: refundResult.message },
  });
}
