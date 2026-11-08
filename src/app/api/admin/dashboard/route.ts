import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toNumber, apiError, apiSuccess } from "@/lib/utils";
import {
  REVENUE_EXCLUDED_STATUSES,
  summarizeRevenue,
  type RevenueOrderInput,
} from "@/lib/orders/revenue";
import {
  expiredPendingWhere,
  pendingPaymentTtlMinutes,
  sweepExpiredPendingPayments,
} from "@/lib/orders/expire-pending";
import { riderPayForPeriod } from "@/lib/riders/earnings";

export const dynamic = "force-dynamic";

const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  this_month: "This month",
  previous_month: "Previous month",
  custom: "Selected dates",
};

/** Hours an order may sit in "Ready for dispatch" without a rider before we flag it. */
const READY_NO_RIDER_HOURS = 2;

function dateRange(preset: string, from?: string, to?: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (preset) {
    case "yesterday":
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case "last7":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "last30":
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      break;
    case "this_month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "previous_month":
      start.setMonth(start.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case "custom": {
      const f = from ? new Date(from) : null;
      const t = to ? new Date(to) : null;
      if (f && !isNaN(f.getTime())) start.setTime(f.getTime());
      start.setHours(0, 0, 0, 0);
      if (t && !isNaN(t.getTime())) end.setTime(t.getTime());
      end.setHours(23, 59, 59, 999);
      break;
    }
    default: // today
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

const revenueSelect = {
  id: true,
  orderNumber: true,
  orderStatus: true,
  subtotal: true,
  discount: true,
  deliveryFee: true,
  deliveryFeePaid: true,
  deliveryFeePaymentStatus: true,
  payments: { select: { type: true, status: true, amount: true } },
  cashCollection: { select: { amountCollected: true } },
  refunds: { where: { status: "COMPLETED" as const }, select: { amount: true } },
} satisfies Prisma.OrderSelect;

type RevenueRow = Prisma.OrderGetPayload<{ select: typeof revenueSelect }>;

function toRevenueInput(o: RevenueRow): RevenueOrderInput {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    orderStatus: o.orderStatus,
    subtotal: toNumber(o.subtotal),
    discount: toNumber(o.discount),
    deliveryFee: toNumber(o.deliveryFee),
    deliveryFeePaid: toNumber(o.deliveryFeePaid),
    deliveryFeePaymentStatus: o.deliveryFeePaymentStatus,
    payments: o.payments.map((p) => ({
      type: p.type,
      status: p.status,
      amount: toNumber(p.amount),
    })),
    cashCollected: o.cashCollection ? toNumber(o.cashCollection.amountCollected) : 0,
    refundsCompleted: o.refunds.reduce((s, r) => s + toNumber(r.amount), 0),
  };
}

async function revenueFor(where: Prisma.OrderWhereInput) {
  const rows = await prisma.order.findMany({
    where: {
      ...where,
      orderStatus: { notIn: [...REVENUE_EXCLUDED_STATUSES] },
    },
    select: revenueSelect,
  });
  return summarizeRevenue(rows.map(toRevenueInput));
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(PERMISSIONS.REPORTS_READ);

    // Cancel unpaid orders past the payment window before counting (cheap, bounded)
    try {
      await sweepExpiredPendingPayments({ limit: 20 });
    } catch {
      /* never block the dashboard */
    }

    const sp = req.nextUrl.searchParams;
    const preset = sp.get("range") || "today";
    const rangeKey = RANGE_LABELS[preset] ? preset : "today";
    const { start, end } = dateRange(
      rangeKey,
      sp.get("from") || undefined,
      sp.get("to") || undefined
    );

    const createdAt = { gte: start, lte: end };
    const revenueOrders: Prisma.OrderWhereInput = {
      createdAt,
      orderStatus: { notIn: [...REVENUE_EXCLUDED_STATUSES] },
    };

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const now = Date.now();
    const readyCutoff = new Date(now - READY_NO_RIDER_HOURS * 60 * 60 * 1000);
    const ttl = pendingPaymentTtlMinutes();
    const paymentCutoff = new Date(now - ttl * 60 * 1000);

    const [
      range,
      month,
      allTime,
      ordersPlaced,
      openOrders,
      deliveredOrders,
      cancelledOrders,
      lowStockRows,
      customers,
      pendingCash,
      productsSold,
      statusBreakdown,
      paymentBreakdown,
      topProducts,
      readyNoRider,
      unpaidPastWindow,
      receiptsWaiting,
      productsWaiting,
      storesWaiting,
      refundsOpen,
      remittancesOpen,
    ] = await Promise.all([
      revenueFor({ createdAt }),
      revenueFor({ createdAt: { gte: monthStart } }),
      revenueFor({}),
      prisma.order.count({ where: { createdAt } }),
      prisma.order.count({
        where: {
          orderStatus: {
            in: [
              "CONFIRMED",
              "PROCESSING",
              "PACKED",
              "READY_FOR_DISPATCH",
              "ASSIGNED_TO_RIDER",
              "OUT_FOR_DELIVERY",
            ],
          },
        },
      }),
      prisma.order.count({ where: { orderStatus: "DELIVERED", createdAt } }),
      prisma.order.count({ where: { orderStatus: "CANCELLED", createdAt } }),
      prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int as count FROM "Product" WHERE status = 'ACTIVE' AND "stockQuantity" <= "lowStockThreshold"`
      ),
      prisma.user.count({ where: { role: { name: "CUSTOMER" } } }),
      prisma.order.aggregate({
        where: {
          productPaymentStatus: "CASH_ON_DELIVERY",
          remainingAmount: { gt: 0 },
          orderStatus: { notIn: [...REVENUE_EXCLUDED_STATUSES, "RETURNED"] },
        },
        _sum: { remainingAmount: true },
        _count: true,
      }),
      prisma.orderItem.aggregate({
        where: { order: revenueOrders },
        _sum: { quantity: true },
      }),
      prisma.order.groupBy({
        by: ["orderStatus"],
        where: { createdAt },
        _count: true,
      }),
      prisma.order.groupBy({
        by: ["paymentMethod"],
        where: revenueOrders,
        _count: true,
      }),
      prisma.orderItem.groupBy({
        by: ["productName"],
        where: { order: revenueOrders },
        _sum: { quantity: true, finalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
      prisma.order.count({
        where: {
          orderStatus: "READY_FOR_DISPATCH",
          riderId: null,
          updatedAt: { lt: readyCutoff },
        },
      }),
      prisma.order.count({ where: expiredPendingWhere(paymentCutoff) }),
      prisma.paymentProof.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.product.count({
        where: { OR: [{ status: "DRAFT" }, { pendingChangesAt: { not: null } }] },
      }),
      prisma.store.count({ where: { status: "PENDING" } }),
      prisma.refund.count({
        where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
      }),
      prisma.cashRemittance.count({
        where: { status: { in: ["PENDING", "SUBMITTED", "DISPUTED"] } },
      }),
    ]);

    // H: rider pay (cost) for the period, next to delivery-fee income
    const riderPay = await riderPayForPeriod({ start, end });

    const lowStock = Number(lowStockRows?.[0]?.count ?? 0);
    const rangeLabel = RANGE_LABELS[rangeKey];

    const needsAttention = [
      {
        key: "ready_no_rider",
        label: `Ready for dispatch with no rider for over ${READY_NO_RIDER_HOURS} hours`,
        count: readyNoRider,
        href: "/admin/orders?status=READY_FOR_DISPATCH&waiting=1",
      },
      {
        key: "unpaid_past_window",
        label: `Unpaid orders past the ${ttl}-minute payment window`,
        count: unpaidPastWindow,
        href: "/admin/orders?status=PENDING_PAYMENT",
      },
      {
        key: "receipts_waiting",
        label: "Payment receipts waiting for review",
        count: receiptsWaiting,
        href: "/admin/payments",
      },
      {
        key: "products_waiting",
        label: "Products waiting for review",
        count: productsWaiting,
        href: "/admin/products",
      },
      {
        key: "stores_waiting",
        label: "Stores waiting for approval",
        count: storesWaiting,
        href: "/admin/stores",
      },
      {
        key: "refunds_open",
        label: "Refunds to process",
        count: refundsOpen,
        href: "/admin/refunds",
      },
      {
        key: "remittances_open",
        label: "Rider cash remittances to confirm",
        count: remittancesOpen,
        href: "/admin/payouts",
      },
      {
        key: "over_recorded",
        label: "Orders with more payment recorded than billed",
        count: allTime.overRecordedOrders.length,
        href: "/admin/payments",
        orderNumbers: allTime.overRecordedOrders.slice(0, 10),
      },
    ];

    const accounting = {
      grossProductSales: range.grossProductSales,
      discounts: range.discounts,
      deliveryRevenue: range.deliveryRevenue,
      refunds: range.refunds,
      netSales: range.netSales,
      onlinePayments: range.onlinePayments,
      cashCollected: range.cashCollected,
      moneyReceived: range.moneyReceived,
      codToCollect: range.codToCollect,
      /** Full-COD delivery fees not yet collected (part of codToCollect, not yet delivery revenue) */
      cashFeesToCollect: range.cashFeesToCollect,
      revenuePaid: range.revenuePaid,
      /** @deprecated kept for old clients: same as revenuePaid */
      netRevenue: range.revenuePaid,
      /** @deprecated kept for old clients: COD still to collect on these orders */
      pendingCash: range.codToCollect,
    };

    return apiSuccess({
      rangeKey,
      rangeLabel,
      cards: {
        revenue: range.revenuePaid,
        paidOrders: range.orderCount,
        ordersPlaced,
        monthlyRevenue: month.revenuePaid,
        totalRevenue: allTime.revenuePaid,
        openOrders,
        deliveredOrders,
        cancelledOrders,
        productsSold: productsSold._sum.quantity || 0,
        lowStockProducts: lowStock,
        customers,
        pendingCashCollections: {
          count: pendingCash._count,
          amount: toNumber(pendingCash._sum.remainingAmount),
        },
        // Back-compat keys (old dashboard): now follow the chosen range
        todayRevenue: range.revenuePaid,
        todayOrders: ordersPlaced,
        pendingOrders: openOrders,
      },
      accounting,
      /** Rider pay for deliveries completed in the period (by delivery time) */
      riderPay: {
        earned: riderPay.earned,
        unpaid: riderPay.unpaid,
        deliveries: riderPay.deliveries,
        unpaidAllTime: riderPay.unpaidAllTime,
        unpaidAllTimeDeliveries: riderPay.unpaidAllTimeDeliveries,
        paidOut: riderPay.paidOut,
        payoutCount: riderPay.payoutCount,
        deliveryRevenue: range.deliveryRevenue,
      },
      reconciliation: {
        reconciles: range.reconciles,
        overRecorded: range.overRecorded,
        overRecordedOrders: range.overRecordedOrders,
      },
      needsAttention,
      charts: {
        statusBreakdown: statusBreakdown.map((s) => ({
          status: s.orderStatus,
          count: s._count,
        })),
        paymentBreakdown: paymentBreakdown.map((p) => ({
          method: p.paymentMethod,
          count: p._count,
        })),
        topProducts: topProducts.map((t) => ({
          name: t.productName,
          quantity: t._sum.quantity || 0,
          revenue: toNumber(t._sum.finalPrice),
        })),
      },
      range: { start, end },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin/dashboard]", e);
    return apiError("Failed to load dashboard", 500);
  }
}
