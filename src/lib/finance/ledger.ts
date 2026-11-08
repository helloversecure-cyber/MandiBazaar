/**
 * Append-only financial ledger.
 *
 * Every money event is journaled as an immutable `LedgerEntry` with a SIGNED
 * amount (+ earned/owed to a party, − deduction/paid out). Rows are never updated
 * or deleted — corrections are new reversing/adjustment rows. All writes are
 * idempotent (guarded by a natural key or refId) so retries never double-count,
 * and every write runs inside the caller's DB transaction where possible.
 *
 * Commission is 5% of eligible PRODUCT sales only (per store, honouring a store's
 * commissionOverride) and is deducted from the store's earnings. The rider's
 * delivery fee (the accepted bid) is a separate RIDER_EARNING — never part of the
 * store commission base, never charged to the customer on top.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** 5% (configurable) of eligible product sales, rounded to whole rupees; net = gross − commission. */
function splitCommission(gross: number, rate: number) {
  const commissionAmount = Math.round((gross * rate) / 100);
  return { commissionAmount, netAmount: Math.max(0, gross - commissionAmount) };
}

export type LedgerInput = {
  type: Prisma.LedgerEntryCreateManyInput["type"];
  orderId?: string | null;
  storeId?: string | null;
  riderId?: string | null;
  amount: number;
  refType?: string | null;
  refId?: string | null;
  meta?: Prisma.InputJsonValue;
};

const money = (n: number) => Math.round(n * 100) / 100;

export async function writeLedger(db: Db, entries: LedgerInput[]): Promise<void> {
  if (entries.length === 0) return;
  await db.ledgerEntry.createMany({
    data: entries.map((e) => ({
      type: e.type,
      orderId: e.orderId ?? null,
      storeId: e.storeId ?? null,
      riderId: e.riderId ?? null,
      amount: money(e.amount),
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      meta: e.meta,
    })),
  });
}

/** Default platform commission % (falls back to 5 when unset). */
async function defaultCommissionPct(db: Db): Promise<number> {
  const s = await db.storeSettings.findFirst({ select: { platformCommissionPct: true } });
  return s ? Number(s.platformCommissionPct) : 5;
}

/**
 * Snapshot SALE / COMMISSION / STORE_EARNING (per store) + RIDER_EARNING the first
 * time an order is confirmed. Idempotent: a second call is a no-op. Call inside the
 * same transaction that confirms the order.
 */
export async function recordOrderConfirmedLedger(db: Db, orderId: string): Promise<void> {
  const already = await db.ledgerEntry.count({ where: { orderId, type: "SALE" } });
  if (already > 0) return;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, delivery: true },
  });
  if (!order) return;

  const defPct = await defaultCommissionPct(db);

  const grossByStore = new Map<string, number>();
  for (const it of order.items) {
    grossByStore.set(it.storeId, (grossByStore.get(it.storeId) ?? 0) + Number(it.finalPrice));
  }

  const storeIds = Array.from(grossByStore.keys());
  const stores = await db.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, commissionOverride: true },
  });
  const overrideById = new Map(
    stores.map((s) => [s.id, s.commissionOverride != null ? Number(s.commissionOverride) : null])
  );

  const entries: LedgerInput[] = [];
  for (const [storeId, gross] of Array.from(grossByStore.entries())) {
    const rate = overrideById.get(storeId) ?? defPct;
    const { commissionAmount, netAmount } = splitCommission(gross, rate);
    entries.push({ type: "SALE", orderId, storeId, amount: gross, meta: { rate, gross } });
    entries.push({ type: "COMMISSION", orderId, storeId, amount: -commissionAmount, meta: { rate } });
    entries.push({ type: "STORE_EARNING", orderId, storeId, amount: netAmount, meta: { rate, gross } });
  }

  // Rider earning = the delivery fee (accepted bid), independent of commission.
  const riderId = order.delivery?.riderId ?? order.riderId ?? null;
  const riderFee =
    order.delivery?.riderFee != null ? Number(order.delivery.riderFee) : Number(order.deliveryFee);
  if (riderId && riderFee > 0) {
    entries.push({ type: "RIDER_EARNING", orderId, riderId, amount: riderFee });
  }

  await writeLedger(db, entries);
}

/** Record a customer payment (idempotent per payment reference). */
export async function recordCustomerPaymentLedger(
  db: Db,
  opts: { orderId: string; amount: number; refId: string }
): Promise<void> {
  const dupe = await db.ledgerEntry.count({ where: { type: "CUSTOMER_PAYMENT", refId: opts.refId } });
  if (dupe > 0) return;
  await writeLedger(db, [
    { type: "CUSTOMER_PAYMENT", orderId: opts.orderId, amount: opts.amount, refType: "payment", refId: opts.refId },
  ]);
}

/** Record a store payout (idempotent per payout id). */
export async function recordStorePayoutLedger(
  db: Db,
  opts: { payoutId: string; storeId: string; net: number; orderIds?: string[] }
): Promise<void> {
  const dupe = await db.ledgerEntry.count({ where: { type: "STORE_PAYOUT", refId: opts.payoutId } });
  if (dupe > 0) return;
  await writeLedger(db, [
    {
      type: "STORE_PAYOUT",
      storeId: opts.storeId,
      amount: -Math.abs(opts.net),
      refType: "payout",
      refId: opts.payoutId,
      meta: opts.orderIds ? { orderIds: opts.orderIds } : undefined,
    },
  ]);
}

/** Record a rider payout (idempotent per rider-payout id). */
export async function recordRiderPayoutLedger(
  db: Db,
  opts: { riderPayoutId: string; riderId: string; amount: number }
): Promise<void> {
  const dupe = await db.ledgerEntry.count({ where: { type: "RIDER_PAYOUT", refId: opts.riderPayoutId } });
  if (dupe > 0) return;
  await writeLedger(db, [
    {
      type: "RIDER_PAYOUT",
      riderId: opts.riderId,
      amount: -Math.abs(opts.amount),
      refType: "rider_payout",
      refId: opts.riderPayoutId,
    },
  ]);
}

/**
 * Record a refund as reversing entries (never mutate prior rows). Idempotent per
 * refund id. Splits the refund into:
 *  - product portion → reverse each store's earning + give back its commission,
 *    pro-rata to that store's share of the order's SALE (snapshot rate reused);
 *  - delivery-fee portion → reverse the rider's earning.
 */
export async function recordOrderRefundLedger(
  db: Db,
  opts: { orderId: string; feeRefund: number; productRefund: number; refId: string }
): Promise<void> {
  const dupe = await db.ledgerEntry.count({ where: { type: "REFUND", refId: opts.refId } });
  if (dupe > 0) return;

  const feeRefund = Math.max(0, opts.feeRefund);
  const productRefund = Math.max(0, opts.productRefund);
  const entries: LedgerInput[] = [
    {
      type: "REFUND",
      orderId: opts.orderId,
      amount: -(feeRefund + productRefund),
      refType: "refund",
      refId: opts.refId,
    },
  ];

  // Delivery fee refunded → reverse the rider's earning for this order.
  if (feeRefund > 0) {
    const riderRow = await db.ledgerEntry.findFirst({
      where: { orderId: opts.orderId, type: "RIDER_EARNING" },
      select: { riderId: true, amount: true },
    });
    if (riderRow?.riderId) {
      entries.push({
        type: "RIDER_EARNING",
        orderId: opts.orderId,
        riderId: riderRow.riderId,
        amount: -Math.min(feeRefund, Number(riderRow.amount)),
        refType: "refund",
        refId: opts.refId,
        meta: { reversal: true },
      });
    }
  }

  // Product refunded → reverse store earning + commission, per store pro-rata.
  if (productRefund > 0) {
    const sales = await db.ledgerEntry.findMany({
      where: { orderId: opts.orderId, type: "SALE" },
      select: { storeId: true, amount: true, meta: true },
    });
    const totalSale = sales.reduce((n, s) => n + Number(s.amount), 0);
    if (totalSale > 0) {
      for (const s of sales) {
        if (!s.storeId) continue;
        const refundShare = productRefund * (Number(s.amount) / totalSale);
        const rate =
          (s.meta && typeof s.meta === "object" && "rate" in s.meta ? Number((s.meta as Record<string, unknown>).rate) : NaN) ||
          (await defaultCommissionPct(db));
        const { commissionAmount, netAmount } = splitCommission(refundShare, rate);
        entries.push({ type: "STORE_EARNING", orderId: opts.orderId, storeId: s.storeId, amount: -netAmount, refType: "refund", refId: opts.refId, meta: { reversal: true } });
        entries.push({ type: "COMMISSION", orderId: opts.orderId, storeId: s.storeId, amount: commissionAmount, refType: "refund", refId: opts.refId, meta: { reversal: true } });
      }
    }
  }

  await writeLedger(db, entries);
}

/** Reconciliation view for one order: the ledger must satisfy SALE = |COMMISSION| + STORE_EARNING. */
export async function orderLedgerSummary(orderId: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { orderId }, select: { type: true, amount: true } });
  const sum = (t: string) => rows.filter((r) => r.type === t).reduce((n, r) => n + Number(r.amount), 0);
  return {
    sale: sum("SALE"),
    commission: sum("COMMISSION"),
    storeEarning: sum("STORE_EARNING"),
    riderEarning: sum("RIDER_EARNING"),
    customerPayment: sum("CUSTOMER_PAYMENT"),
    refund: sum("REFUND"),
  };
}
