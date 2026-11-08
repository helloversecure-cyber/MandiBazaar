/**
 * Super Admin financial control center — platform-wide figures, 100% database-driven.
 * Store earnings/commission reuse the audited payout math (computePayoutDrafts for
 * unsettled + Payout rows for settled); rider pay is kept completely separate.
 */
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { computePayoutDrafts } from "@/lib/orders/payouts";
import { riderPayForPeriod } from "@/lib/riders/earnings";

export async function adminFinanceOverview() {
  const [
    salesAgg,
    payouts,
    riderPaidAgg,
    riderUnpaidAgg,
    draftsResult,
    deliveredCount,
    cancelledCount,
    refundCount,
    topStores,
    topRiders,
  ] = await Promise.all([
    prisma.orderItem.aggregate({ where: { order: { orderStatus: "DELIVERED" } }, _sum: { finalPrice: true } }),
    prisma.payout.findMany({
      where: { status: { not: "CANCELLED" } },
      select: { status: true, netAmount: true, commissionAmount: true, grossSales: true },
    }),
    prisma.riderPayout.aggregate({ _sum: { amount: true }, _count: true }),
    // Owed-to-riders uses effectiveRiderFee so deliveries whose fee isn't yet
    // materialised (riderFee null) are still counted (not under-reported).
    riderPayForPeriod({ start: new Date(0), end: new Date() }),
    computePayoutDrafts(),
    prisma.order.count({ where: { orderStatus: "DELIVERED" } }),
    prisma.order.count({ where: { orderStatus: "CANCELLED" } }),
    prisma.refund.count({ where: { status: "COMPLETED" } }),
    prisma.orderItem.groupBy({
      by: ["storeId", "storeName"],
      where: { order: { orderStatus: "DELIVERED" } },
      _sum: { finalPrice: true },
      orderBy: { _sum: { finalPrice: "desc" } },
      take: 5,
    }),
    prisma.riderPayout.groupBy({
      by: ["riderId"],
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    }),
  ]);

  const sum = (arr: { netAmount: unknown; commissionAmount: unknown; grossSales: unknown; status: string }[], pred: (s: string) => boolean, key: "netAmount" | "commissionAmount" | "grossSales") =>
    arr.filter((p) => pred(p.status)).reduce((n, p) => n + toNumber(p[key]), 0);

  const settledCommission = sum(payouts, () => true, "commissionAmount");
  const paidStorePayouts = sum(payouts, (s) => s === "PAID", "netAmount");
  const pendingStorePayouts = sum(payouts, (s) => s === "PENDING" || s === "PROCESSING", "netAmount");

  const drafts = draftsResult.drafts as Array<{ gross: number; commissionAmount: number; netAmount: number }>;
  const unsettledGross = drafts.reduce((n, d) => n + d.gross, 0);
  const unsettledCommission = drafts.reduce((n, d) => n + d.commissionAmount, 0);
  const unsettledNet = drafts.reduce((n, d) => n + d.netAmount, 0);

  // COD sales delivered but not yet reconciled (rider hasn't remitted). These are
  // real sales (so they count toward commissionable sales + commission + store net),
  // but are HELD — not yet payable to the store.
  const held = (draftsResult.heldForCod ?? []) as Array<{ gross: number; commissionAmount: number; netAmount: number }>;
  const heldGross = held.reduce((n, d) => n + d.gross, 0);
  const heldCommission = held.reduce((n, d) => n + d.commissionAmount, 0);
  const heldNet = held.reduce((n, d) => n + d.netAmount, 0);

  // Commissionable sales = settled payout gross + unsettled draft gross + held COD
  // gross. Using this (not the raw all-stores delivered total) keeps
  // sales == commission + store net across settled, ready, and held buckets.
  const settledGross = sum(payouts, () => true, "grossSales");
  const commissionableSales = Math.round((settledGross + unsettledGross + heldGross) * 100) / 100;
  const riderOwed = riderUnpaidAgg.unpaidAllTime;

  const riderNames = await prisma.rider.findMany({
    where: { id: { in: topRiders.map((r) => r.riderId) } },
    select: { id: true, name: true },
  });
  const riderNameById = new Map(riderNames.map((r) => [r.id, r.name]));

  return {
    totalProductSales: commissionableSales,
    totalMarketplaceSales: toNumber(salesAgg._sum.finalPrice),
    totalCommissionEarned: Math.round((settledCommission + unsettledCommission + heldCommission) * 100) / 100,
    totalStoreEarnings: Math.round((paidStorePayouts + pendingStorePayouts + unsettledNet + heldNet) * 100) / 100,
    storePayoutsPaid: paidStorePayouts,
    storePayoutsPending: Math.round((pendingStorePayouts + unsettledNet) * 100) / 100,
    storeEarningsHeldForCod: Math.round(heldNet * 100) / 100,
    riderPayoutsPaid: toNumber(riderPaidAgg._sum.amount),
    riderPayoutsPending: riderOwed,
    outstandingLiabilities: Math.round((pendingStorePayouts + unsettledNet + heldNet + riderOwed) * 100) / 100,
    counts: { delivered: deliveredCount, cancelled: cancelledCount, refunded: refundCount, riderPayoutCount: riderPaidAgg._count },
    unsettled: { gross: unsettledGross, commission: unsettledCommission, net: unsettledNet, stores: drafts.length },
    heldForCod: { gross: Math.round(heldGross * 100) / 100, net: Math.round(heldNet * 100) / 100, stores: held.length },
    topStores: topStores.map((s) => ({ storeId: s.storeId, storeName: s.storeName, sales: toNumber(s._sum.finalPrice) })),
    topRiders: topRiders.map((r) => ({ riderId: r.riderId, name: riderNameById.get(r.riderId) ?? "Rider", paid: toNumber(r._sum.amount), payouts: r._count })),
  };
}
