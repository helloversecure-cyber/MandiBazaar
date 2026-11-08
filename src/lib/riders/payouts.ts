/**
 * Admin → rider payouts. Server only.
 * Creates a RiderPayout and links exactly the deliveries the admin confirmed, in
 * one transaction with the rider row and the delivery rows locked, so the same
 * delivery can never be paid twice (double click, two admins, two tabs).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import {
  checkPayoutSelection,
  getRiderPaySettings,
  type PayoutCandidate,
  type RiderPayoutMethod,
} from "./pay";
import { riderUnpaidWhere, loadRiderEarningRows } from "./earnings";
import { effectiveRiderFee } from "./pay-rules";
import { recordRiderPayoutLedger } from "@/lib/finance/ledger";

export class PayoutConflict extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409
  ) {
    super(message);
  }
}

/** What the "Pay rider" dialog shows: every unpaid delivery right now. */
export async function riderPayoutPreview(riderId: string) {
  const settings = await getRiderPaySettings(prisma);
  const rows = await loadRiderEarningRows(riderUnpaidWhere(riderId));
  const items = rows.map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    deliveredAt: r.deliveredAt,
    distanceKm: r.distanceKm,
    pay: effectiveRiderFee(r, settings),
    feeFixed: r.riderFee != null,
  }));
  const amount = Math.round(items.reduce((s, i) => s + i.pay, 0) * 100) / 100;
  return { settings, items, count: items.length, amount };
}

export async function createRiderPayout(input: {
  riderId: string;
  orderIds: string[];
  expectedAmount: number;
  expectedCount: number;
  method: RiderPayoutMethod;
  reference: string | null;
  notes: string | null;
  paidById: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      // Serialise payouts per rider.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Rider" WHERE id = ${input.riderId} FOR UPDATE`;
      if (!locked.length) throw new PayoutConflict("Rider not found", 404);

      const ids = Array.from(new Set(input.orderIds));
      if (ids.length) {
        await tx.$queryRaw`SELECT id FROM "Delivery" WHERE "orderId" IN (${Prisma.join(ids)}) FOR UPDATE`;
      }
      const orders = await tx.order.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          riderId: true,
          orderStatus: true,
          deliveredAt: true,
          deliveryDistanceKm: true,
          delivery: { select: { id: true, riderFee: true, riderPayoutId: true } },
        },
      });
      const settings = await getRiderPaySettings(tx);
      const candidates: PayoutCandidate[] = orders.map((o) => ({
        orderId: o.id,
        eligible: o.riderId === input.riderId && o.orderStatus === "DELIVERED",
        riderPayoutId: o.delivery?.riderPayoutId ?? null,
        riderFee: o.delivery?.riderFee == null ? null : toNumber(o.delivery.riderFee),
        distanceKm: o.deliveryDistanceKm == null ? null : toNumber(o.deliveryDistanceKm),
      }));
      const check = checkPayoutSelection(
        input.orderIds,
        { amount: input.expectedAmount, count: input.expectedCount },
        candidates,
        settings
      );
      if (!check.ok) throw new PayoutConflict(check.error, check.status);

      // Older orders: create the Delivery row / fix the fee now (persist at payout time).
      for (const o of orders) {
        const fee = check.fees[o.id];
        if (!o.delivery) {
          await tx.delivery.create({
            data: { orderId: o.id, riderId: input.riderId, deliveredAt: o.deliveredAt ?? new Date(), riderFee: fee },
          });
        } else if (o.delivery.riderFee == null) {
          await tx.delivery.updateMany({
            where: { orderId: o.id, riderFee: null, riderPayoutId: null },
            data: { riderFee: fee, riderId: input.riderId },
          });
        }
      }

      const payout = await tx.riderPayout.create({
        data: {
          riderId: input.riderId,
          amount: check.amount,
          deliveryCount: check.count,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          paidById: input.paidById,
        },
      });
      const linked = await tx.delivery.updateMany({
        where: { orderId: { in: check.orderIds }, riderPayoutId: null },
        data: { riderPayoutId: payout.id, riderId: input.riderId },
      });
      if (linked.count !== check.count) {
        throw new PayoutConflict("Some of these deliveries were already paid — reload and try again", 409);
      }
      // Final money check from the rows as stored.
      const sum = await tx.delivery.aggregate({ where: { riderPayoutId: payout.id }, _sum: { riderFee: true } });
      if (Math.abs(toNumber(sum._sum.riderFee) - check.amount) > 0.005) {
        throw new PayoutConflict("The unpaid total changed — reload and confirm again", 409);
      }
      await recordRiderPayoutLedger(tx, {
        riderPayoutId: payout.id,
        riderId: input.riderId,
        amount: check.amount,
      });
      return { ...payout, amount: toNumber(payout.amount) };
    },
    { timeout: 20000 }
  );
}

export async function listRiderPayouts(riderId: string, page: number, limit: number) {
  const [total, items] = await Promise.all([
    prisma.riderPayout.count({ where: { riderId } }),
    prisma.riderPayout.findMany({
      where: { riderId },
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { deliveries: { select: { order: { select: { orderNumber: true } } }, take: 50 } },
    }),
  ]);
  const payerIds = Array.from(new Set(items.map((p) => p.paidById).filter((x): x is string => !!x)));
  const payers = payerIds.length
    ? await prisma.user.findMany({ where: { id: { in: payerIds } }, select: { id: true, fullName: true } })
    : [];
  const payerName = new Map(payers.map((u) => [u.id, u.fullName]));
  return {
    total,
    items: items.map((p) => ({
      id: p.id,
      amount: toNumber(p.amount),
      deliveryCount: p.deliveryCount,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      paidAt: p.paidAt,
      paidBy: p.paidById ? payerName.get(p.paidById) || null : null,
      orderNumbers: p.deliveries.map((d) => d.order.orderNumber),
    })),
  };
}
