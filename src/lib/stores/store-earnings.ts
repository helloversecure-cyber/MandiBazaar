/**
 * Store money overview (QA N6 / STO-07 / P7 store side, N1).
 * Read-only: built from OrderItem + Payout rows; payout generation itself
 * lives in src/lib/orders/payouts.ts and is not changed here.
 */
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

/** Order statuses that count as a real (paid / cash-on-delivery confirmed) sale. */
const SALE_STATUSES = [
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

const DAY = 24 * 60 * 60 * 1000;

export function commissionFor(gross: number, ratePct: number): number {
  return Math.round((gross * ratePct) / 100);
}

export async function storeEarningsSummary(storeIds: string[]) {
  const [settings, stores] = await Promise.all([
    prisma.storeSettings.findFirst({ select: { platformCommissionPct: true } }),
    prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, commissionOverride: true },
    }),
  ]);
  const defaultPct = toNumber(settings?.platformCommissionPct ?? 5);
  const rateByStore = new Map(
    stores.map((s) => [
      s.id,
      s.commissionOverride != null ? toNumber(s.commissionOverride) : defaultPct,
    ])
  );

  const weekStart = new Date(Date.now() - 7 * DAY);

  const [deliveredSales, weekSales, deliveredPairs, payouts, heldCodOrders] = await Promise.all([
    prisma.orderItem.aggregate({
      where: { storeId: { in: storeIds }, order: { orderStatus: "DELIVERED" } },
      _sum: { finalPrice: true },
    }),
    prisma.orderItem.aggregate({
      where: {
        storeId: { in: storeIds },
        order: {
          orderStatus: { in: [...SALE_STATUSES] },
          createdAt: { gte: weekStart },
        },
      },
      _sum: { finalPrice: true },
    }),
    prisma.orderItem.groupBy({
      by: ["storeId", "orderId"],
      where: { storeId: { in: storeIds }, order: { orderStatus: "DELIVERED" } },
      _sum: { finalPrice: true },
    }),
    prisma.payout.findMany({
      where: { storeId: { in: storeIds } },
      orderBy: { createdAt: "desc" },
    }),
    // Delivered COD orders whose rider cash is NOT yet verified-remitted: held,
    // not settleable (spec §8). Excluded from "available / unsettled" and shown
    // separately as held.
    prisma.order.findMany({
      where: {
        orderStatus: "DELIVERED",
        paymentMethod: "CASH_ON_DELIVERY",
        items: { some: { storeId: { in: storeIds } } },
        OR: [{ cashRemittance: null }, { cashRemittance: { status: { not: "RECEIVED" } } }],
      },
      select: { id: true },
    }),
  ]);

  const settled = new Set<string>();
  for (const p of payouts) {
    if (p.status === "CANCELLED") continue;
    for (const oid of p.orderIds || []) settled.add(`${p.storeId}:${oid}`);
  }
  const heldCodOrderIds = new Set(heldCodOrders.map((o) => o.id));

  let unsettledGross = 0;
  let unsettledCommission = 0;
  let unsettledOrders = 0;
  let heldForCodGross = 0;
  let heldForCodNet = 0;
  for (const row of deliveredPairs) {
    if (settled.has(`${row.storeId}:${row.orderId}`)) continue;
    const gross = toNumber(row._sum.finalPrice);
    if (gross <= 0) continue;
    const commission = commissionFor(gross, rateByStore.get(row.storeId) ?? defaultPct);
    if (heldCodOrderIds.has(row.orderId)) {
      heldForCodGross += gross;
      heldForCodNet += Math.max(0, gross - commission);
      continue;
    }
    unsettledGross += gross;
    unsettledCommission += commission;
    unsettledOrders += 1;
  }
  const unsettledNet = Math.max(0, unsettledGross - unsettledCommission);

  const pendingPayouts = payouts.filter((p) => p.status === "PENDING" || p.status === "PROCESSING");
  const pendingPayoutNet = pendingPayouts.reduce((s, p) => s + toNumber(p.netAmount), 0);
  const paidOut = payouts
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + toNumber(p.netAmount), 0);
  const totalCommission = payouts
    .filter((p) => p.status !== "CANCELLED")
    .reduce((s, p) => s + toNumber(p.commissionAmount), 0) + unsettledCommission;

  const rates = Array.from(new Set(stores.map((s) => rateByStore.get(s.id) ?? defaultPct)));
  const latest = payouts.find((p) => p.status !== "CANCELLED");
  let nextPayoutDate: string | null = null;
  if (latest) {
    const next = new Date(new Date(latest.periodEnd).getTime() + 7 * DAY);
    nextPayoutDate = (next.getTime() < Date.now() ? new Date() : next).toISOString();
  }

  return {
    commissionPct: rates.length === 1 ? rates[0] : null,
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      commissionPct: rateByStore.get(s.id) ?? defaultPct,
      commissionIsCustom: s.commissionOverride != null,
    })),
    totalSales: toNumber(deliveredSales._sum.finalPrice),
    salesThisWeek: toNumber(weekSales._sum.finalPrice),
    totalCommission,
    paidOut,
    pendingPayoutNet,
    pendingPayoutCount: pendingPayouts.length,
    unsettled: {
      orders: unsettledOrders,
      gross: unsettledGross,
      commission: unsettledCommission,
      net: unsettledNet,
    },
    heldForCod: {
      gross: Math.round(heldForCodGross * 100) / 100,
      net: Math.round(heldForCodNet * 100) / 100,
      orders: heldCodOrderIds.size,
    },
    amountDue: pendingPayoutNet + unsettledNet,
    nextPayoutDate,
    payouts: payouts.map((p) => ({
      id: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      grossSales: toNumber(p.grossSales),
      commissionRate: toNumber(p.commissionRate),
      commissionAmount: toNumber(p.commissionAmount),
      netAmount: toNumber(p.netAmount),
      status: p.status,
      payoutMethod: p.payoutMethod,
      payoutReference: p.payoutReference,
      paidAt: p.paidAt,
      orderCount: (p.orderIds || []).length,
      storeId: p.storeId,
      createdAt: p.createdAt,
    })),
  };
}
