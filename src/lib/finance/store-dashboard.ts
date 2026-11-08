/**
 * Store Owner financial dashboard data — 100% database-driven (no placeholders).
 * Reuses the audited money overview (storeEarningsSummary) and adds order counts,
 * period earnings, and an order-wise financial breakdown with settlement status.
 */
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { storeEarningsSummary, commissionFor } from "@/lib/stores/store-earnings";

const SALE_STATUSES = [
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

async function rateByStore(storeIds: string[]) {
  const [settings, stores] = await Promise.all([
    prisma.storeSettings.findFirst({ select: { platformCommissionPct: true } }),
    prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, commissionOverride: true } }),
  ]);
  const def = toNumber(settings?.platformCommissionPct ?? 5);
  const map = new Map(stores.map((s) => [s.id, s.commissionOverride != null ? toNumber(s.commissionOverride) : def]));
  return { def, map };
}

export type StoreOrderLine = {
  orderId: string;
  orderNumber: string;
  date: Date;
  deliveredAt: Date | null;
  orderStatus: string;
  paymentStatus: string;
  gross: number;
  discount: number;
  commission: number;
  net: number;
  settled: boolean;
  payoutReference: string | null;
  /** COD order whose rider cash isn't verified-remitted yet — not settleable. */
  heldForCod: boolean;
};

export async function storeOrderBreakdown(storeIds: string[], limit = 200): Promise<StoreOrderLine[]> {
  const [{ def, map }, orders, payouts] = await Promise.all([
    rateByStore(storeIds),
    prisma.order.findMany({
      where: { items: { some: { storeId: { in: storeIds } } }, orderStatus: { in: [...SALE_STATUSES, "CANCELLED", "RETURNED"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        deliveredAt: true,
        orderStatus: true,
        productPaymentStatus: true,
        paymentMethod: true,
        cashRemittance: { select: { status: true } },
        discount: true,
        items: { where: { storeId: { in: storeIds } }, select: { finalPrice: true, storeId: true } },
      },
    }),
    prisma.payout.findMany({
      where: { storeId: { in: storeIds }, status: { not: "CANCELLED" } },
      select: { orderIds: true, storeId: true, payoutReference: true, commissionRate: true },
    }),
  ]);

  const settledRef = new Map<string, string | null>();
  // Snapshot the rate that was actually paid, so a later rate change never rewrites
  // the commission/net shown on an already-settled order line.
  const settledRate = new Map<string, number>();
  for (const p of payouts)
    for (const oid of p.orderIds || []) {
      settledRef.set(`${p.storeId}:${oid}`, p.payoutReference);
      settledRate.set(`${p.storeId}:${oid}`, toNumber(p.commissionRate));
    }

  return orders.map((o) => {
    const storeId = o.items[0]?.storeId ?? storeIds[0];
    const gross = o.items.reduce((n, i) => n + toNumber(i.finalPrice), 0);
    const key = `${storeId}:${o.id}`;
    const isSettled = settledRef.has(key);
    // Settled rows use the rate snapshotted at payout time; unsettled rows use the
    // current store/default rate.
    const rate = isSettled ? settledRate.get(key) ?? map.get(storeId) ?? def : map.get(storeId) ?? def;
    // Cancelled / returned orders earn nothing — show them for the record but with
    // zero commission/net so the statement reconciles with the headline figures.
    const earns = o.orderStatus !== "CANCELLED" && o.orderStatus !== "RETURNED";
    const commission = earns ? commissionFor(gross, rate) : 0;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      date: o.createdAt,
      deliveredAt: o.deliveredAt,
      orderStatus: o.orderStatus,
      paymentStatus: o.productPaymentStatus,
      gross: earns ? gross : 0,
      discount: toNumber(o.discount),
      commission,
      net: earns ? Math.max(0, gross - commission) : 0,
      settled: earns && isSettled,
      payoutReference: earns ? settledRef.get(key) ?? null : null,
      heldForCod:
        earns &&
        !isSettled &&
        o.paymentMethod === "CASH_ON_DELIVERY" &&
        o.cashRemittance?.status !== "RECEIVED",
    };
  });
}

export async function storeFinanceDashboard(storeIds: string[]) {
  if (storeIds.length === 0) return null;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [overview, breakdown, completed, cancelled, refunded, monthSales, lifetimeSales] = await Promise.all([
    storeEarningsSummary(storeIds),
    storeOrderBreakdown(storeIds),
    prisma.order.count({ where: { items: { some: { storeId: { in: storeIds } } }, orderStatus: "DELIVERED" } }),
    prisma.order.count({ where: { items: { some: { storeId: { in: storeIds } } }, orderStatus: "CANCELLED" } }),
    prisma.refund.count({ where: { order: { items: { some: { storeId: { in: storeIds } } } }, status: "COMPLETED" } }),
    prisma.orderItem.aggregate({ where: { storeId: { in: storeIds }, order: { orderStatus: "DELIVERED", deliveredAt: { gte: monthStart } } }, _sum: { finalPrice: true } }),
    prisma.orderItem.aggregate({ where: { storeId: { in: storeIds }, order: { orderStatus: "DELIVERED" } }, _sum: { finalPrice: true } }),
  ]);

  return {
    ...overview,
    counts: { completedOrders: completed, cancelledOrders: cancelled, refundedOrders: refunded },
    salesThisMonth: toNumber(monthSales._sum.finalPrice),
    lifetimeSales: toNumber(lifetimeSales._sum.finalPrice),
    breakdown,
  };
}
