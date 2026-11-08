/**
 * Rider earnings + payouts queries (rider portal "My earnings", admin Riders page,
 * admin dashboard / reports). Server only.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import {
  effectiveRiderFee,
  getRiderPaySettings,
  summarizeRiderEarnings,
  type EarningPeriod,
  type EarningRow,
  type RiderPaySettings,
} from "./pay";

/**
 * Deliveries that count as earned for a rider:
 * - DELIVERED orders delivered by this rider (paid or not), plus
 * - anything already paid to this rider (kept even if the order was later returned).
 * Failed / returned orders that were never paid earn nothing.
 */
export function riderEarnedWhere(riderId: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { riderId, orderStatus: "DELIVERED" },
      { delivery: { riderPayout: { riderId } } },
    ],
  };
}

/** Unpaid, payable deliveries of a rider. */
export function riderUnpaidWhere(riderId: string): Prisma.OrderWhereInput {
  return {
    riderId,
    orderStatus: "DELIVERED",
    OR: [{ delivery: null }, { delivery: { riderPayoutId: null } }],
  };
}

const earningSelect = {
  id: true,
  orderNumber: true,
  deliveredAt: true,
  updatedAt: true,
  deliveryDistanceKm: true,
  delivery: { select: { riderFee: true, riderPayoutId: true, deliveredAt: true } },
} satisfies Prisma.OrderSelect;

type EarningOrder = Prisma.OrderGetPayload<{ select: typeof earningSelect }>;

export function toEarningRow(o: EarningOrder): EarningRow {
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    deliveredAt: o.deliveredAt ?? o.delivery?.deliveredAt ?? o.updatedAt,
    distanceKm: o.deliveryDistanceKm == null ? null : toNumber(o.deliveryDistanceKm),
    riderFee: o.delivery?.riderFee == null ? null : toNumber(o.delivery.riderFee),
    riderPayoutId: o.delivery?.riderPayoutId ?? null,
  };
}

export async function loadRiderEarningRows(where: Prisma.OrderWhereInput) {
  const rows = await prisma.order.findMany({
    where,
    select: earningSelect,
    orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toEarningRow);
}

/** Full earnings page data for one rider. */
export async function riderEarningsOverview(
  riderId: string,
  periods: EarningPeriod[],
  opts: { page: number; limit: number; payoutPage: number; payoutLimit: number }
) {
  const settings = await getRiderPaySettings(prisma);
  const rows = await loadRiderEarningRows(riderEarnedWhere(riderId));
  const summary = summarizeRiderEarnings(rows, periods, settings);

  const skip = (opts.page - 1) * opts.limit;
  const deliveries = rows.slice(skip, skip + opts.limit).map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    deliveredAt: r.deliveredAt,
    distanceKm: r.distanceKm,
    pay: effectiveRiderFee(r, settings),
    feeFixed: r.riderFee != null,
    paid: Boolean(r.riderPayoutId),
  }));

  const [payoutTotal, payouts] = await Promise.all([
    prisma.riderPayout.count({ where: { riderId } }),
    prisma.riderPayout.findMany({
      where: { riderId },
      orderBy: { paidAt: "desc" },
      skip: (opts.payoutPage - 1) * opts.payoutLimit,
      take: opts.payoutLimit,
      select: { id: true, amount: true, deliveryCount: true, method: true, reference: true, paidAt: true },
    }),
  ]);

  return {
    settings,
    summary,
    deliveries,
    deliveriesTotal: rows.length,
    payouts: payouts.map((p) => ({ ...p, amount: toNumber(p.amount) })),
    payoutTotal,
  };
}

/** Unpaid count + amount for several riders (admin Riders list). */
export async function unpaidByRider(riderIds: string[], settings?: RiderPaySettings) {
  const out: Record<string, { count: number; amount: number }> = {};
  if (!riderIds.length) return out;
  const s = settings ?? (await getRiderPaySettings(prisma));
  const rows = await prisma.order.findMany({
    where: {
      riderId: { in: riderIds },
      orderStatus: "DELIVERED",
      OR: [{ delivery: null }, { delivery: { riderPayoutId: null } }],
    },
    select: { riderId: true, ...earningSelect },
  });
  for (const id of riderIds) out[id] = { count: 0, amount: 0 };
  for (const o of rows) {
    if (!o.riderId) continue;
    const b = out[o.riderId] || (out[o.riderId] = { count: 0, amount: 0 });
    b.count += 1;
    b.amount += effectiveRiderFee(toEarningRow(o), s);
  }
  for (const k of Object.keys(out)) out[k].amount = Math.round(out[k].amount * 100) / 100;
  return out;
}

/**
 * Rider pay for an admin period (dashboard / reports), by delivery time:
 * earned = pay for deliveries completed in the period; unpaid = the part of it not
 * yet paid; unpaidAllTime = everything owed to riders now; paidOut = payouts made in
 * the period.
 */
export async function riderPayForPeriod(range: { start: Date; end: Date }) {
  const settings = await getRiderPaySettings(prisma);
  const inRange = { gte: range.start, lte: range.end };
  const [periodRows, owedRows, paidOut] = await Promise.all([
    prisma.order.findMany({
      where: {
        AND: [
          { OR: [{ orderStatus: "DELIVERED" }, { delivery: { riderPayoutId: { not: null } } }] },
          { riderId: { not: null } },
          { deliveredAt: inRange },
        ],
      },
      select: earningSelect,
    }),
    prisma.order.findMany({
      where: {
        orderStatus: "DELIVERED",
        riderId: { not: null },
        OR: [{ delivery: null }, { delivery: { riderPayoutId: null } }],
      },
      select: earningSelect,
    }),
    prisma.riderPayout.aggregate({ where: { paidAt: inRange }, _sum: { amount: true }, _count: true }),
  ]);
  let earned = 0;
  let unpaid = 0;
  for (const o of periodRows) {
    const r = toEarningRow(o);
    const fee = effectiveRiderFee(r, settings);
    earned += fee;
    if (!r.riderPayoutId) unpaid += fee;
  }
  let unpaidAllTime = 0;
  for (const o of owedRows) unpaidAllTime += effectiveRiderFee(toEarningRow(o), settings);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    earned: r2(earned),
    unpaid: r2(unpaid),
    deliveries: periodRows.length,
    unpaidAllTime: r2(unpaidAllTime),
    unpaidAllTimeDeliveries: owedRows.length,
    paidOut: toNumber(paidOut._sum.amount),
    payoutCount: paidOut._count,
  };
}
