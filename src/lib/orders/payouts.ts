import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { recordStorePayoutLedger } from "@/lib/finance/ledger";

/**
 * A store is settled from product money the platform actually holds. For a COD
 * order the rider collected the cash, so the platform may only settle the store
 * once that cash has been verified-remitted (spec §8: never settle on an
 * unverified COD collection). Online-paid orders are always reconciled.
 */
export function isOrderCodReconciled(order: {
  paymentMethod: string;
  cashRemittance?: { status: string } | null;
}): boolean {
  if (order.paymentMethod !== "CASH_ON_DELIVERY") return true;
  return order.cashRemittance?.status === "RECEIVED";
}

type BankSnapshot = {
  bankAccountTitle?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIban?: string | null;
  jazzCashNumber?: string | null;
  jazzCashAccountTitle?: string | null;
};

function pickPayoutMethod(snap: BankSnapshot | null | undefined): {
  method: "BANK" | "JAZZCASH" | null;
  reason?: string;
} {
  if (snap?.jazzCashNumber?.trim()) {
    return { method: "JAZZCASH" };
  }
  if (
    snap?.bankIban?.trim() ||
    snap?.bankAccountNumber?.trim() ||
    (snap?.bankName?.trim() && snap?.bankAccountTitle?.trim())
  ) {
    return { method: "BANK" };
  }
  return {
    method: null,
    reason: "Store has no JazzCash number or bank details",
  };
}

export type PayoutDraft = {
  storeId: string;
  storeName: string;
  gross: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
  orderIds: string[];
  account: BankSnapshot;
  method: "BANK" | "JAZZCASH" | null;
  missingReason?: string;
};

/** Pure: commission + net for a store's gross sales (rounded to whole rupees like before). */
export function payoutAmounts(gross: number, commissionRate: number) {
  const commissionAmount = Math.round((gross * commissionRate) / 100);
  return { commissionAmount, netAmount: Math.max(0, gross - commissionAmount) };
}

/** Where the money would go, as a short masked text for the confirmation summary. */
export function describePayoutAccount(snap: BankSnapshot | null | undefined): string {
  const mask = (v: string) => (v.length > 4 ? `••••${v.slice(-4)}` : v);
  if (snap?.jazzCashNumber?.trim()) {
    return `JazzCash ${mask(snap.jazzCashNumber.trim())}${snap.jazzCashAccountTitle ? ` (${snap.jazzCashAccountTitle})` : ""}`;
  }
  const acct = snap?.bankIban?.trim() || snap?.bankAccountNumber?.trim();
  if (acct) {
    return `Bank ${snap?.bankName || ""} ${mask(acct)}${snap?.bankAccountTitle ? ` (${snap.bankAccountTitle})` : ""}`.replace(/\s+/g, " ").trim();
  }
  return "No payout account";
}

/**
 * Store sales not yet in any (non-cancelled) payout: delivered orders up to
 * `periodEnd`, product sales − platform commission. Delivery fees stay with the
 * platform. Read-only — used for the "Pay all stores" preview and by generate.
 * (Before: only orders delivered in the last 7 days were picked up, so a missed
 * week was never paid out.)
 */
export async function computePayoutDrafts(opts?: { periodEnd?: Date }) {
  const periodEnd = opts?.periodEnd || new Date();
  const settings = await prisma.storeSettings.findFirst();
  const defaultCommission = toNumber(settings?.platformCommissionPct ?? 5);

  const delivered = await prisma.order.findMany({
    where: { orderStatus: "DELIVERED", deliveredAt: { lte: periodEnd } },
    select: {
      id: true,
      deliveredAt: true,
      paymentMethod: true,
      cashRemittance: { select: { status: true } },
      items: { select: { storeId: true, finalPrice: true } },
    },
  });

  const existingPayouts = await prisma.payout.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { storeId: true, orderIds: true },
  });
  const alreadyPaidForStore = new Set(
    existingPayouts.flatMap((p) => (p.orderIds || []).map((orderId) => `${p.storeId}:${orderId}`))
  );

  const byStore = new Map<string, { gross: number; orderIds: string[] }>();
  // COD orders whose cash is not yet verified-remitted — held, not settled.
  const heldByStore = new Map<string, { gross: number; orderIds: string[] }>();
  let earliest: Date | null = null;
  for (const order of delivered) {
    const reconciled = isOrderCodReconciled(order);
    const storeTotals = new Map<string, number>();
    for (const item of order.items) {
      storeTotals.set(item.storeId, (storeTotals.get(item.storeId) || 0) + toNumber(item.finalPrice));
    }
    for (const [storeId, gross] of Array.from(storeTotals.entries())) {
      if (alreadyPaidForStore.has(`${storeId}:${order.id}`)) continue;
      if (!reconciled) {
        // Hold COD sales until the rider's cash is verified-remitted.
        const held = heldByStore.get(storeId) || { gross: 0, orderIds: [] as string[] };
        held.gross += gross;
        held.orderIds.push(order.id);
        heldByStore.set(storeId, held);
        continue;
      }
      const acc = byStore.get(storeId) || { gross: 0, orderIds: [] as string[] };
      acc.gross += gross;
      acc.orderIds.push(order.id);
      byStore.set(storeId, acc);
      if (order.deliveredAt && (!earliest || order.deliveredAt < earliest)) earliest = order.deliveredAt;
    }
  }

  const storeIdUnion = Array.from(new Set([...Array.from(byStore.keys()), ...Array.from(heldByStore.keys())]));
  const stores = storeIdUnion.length
    ? await prisma.store.findMany({ where: { id: { in: storeIdUnion } } })
    : [];
  const rateOf = (store: { commissionOverride: unknown }) =>
    store.commissionOverride != null ? toNumber(store.commissionOverride) : defaultCommission;
  const drafts: PayoutDraft[] = [];
  for (const store of stores) {
    if (!byStore.has(store.id)) continue;
    if (store.status !== "APPROVED") continue;
    const acc = byStore.get(store.id)!;
    const gross = Math.round(acc.gross * 100) / 100;
    if (gross <= 0) continue;
    const rate = store.commissionOverride != null ? toNumber(store.commissionOverride) : defaultCommission;
    const { commissionAmount, netAmount } = payoutAmounts(gross, rate);
    const account: BankSnapshot = {
      bankAccountTitle: store.bankAccountTitle,
      bankName: store.bankName,
      bankAccountNumber: store.bankAccountNumber,
      bankIban: store.bankIban,
      jazzCashNumber: store.jazzCashNumber,
      jazzCashAccountTitle: store.jazzCashAccountTitle,
    };
    const pick = pickPayoutMethod(account);
    drafts.push({
      storeId: store.id,
      storeName: store.name,
      gross,
      commissionRate: rate,
      commissionAmount,
      netAmount,
      orderIds: Array.from(new Set(acc.orderIds)),
      account,
      method: pick.method,
      missingReason: pick.reason,
    });
  }

  const periodStart = new Date(earliest || periodEnd);
  periodStart.setHours(0, 0, 0, 0);

  const storeById = new Map(stores.map((s) => [s.id, s]));
  const heldForCod = Array.from(heldByStore.entries()).map(([storeId, h]) => {
    const store = storeById.get(storeId);
    const gross = Math.round(h.gross * 100) / 100;
    const rate = store ? rateOf(store) : defaultCommission;
    const { commissionAmount, netAmount } = payoutAmounts(gross, rate);
    return {
      storeId,
      storeName: store?.name ?? "",
      gross,
      commissionAmount,
      netAmount,
      orderCount: new Set(h.orderIds).size,
    };
  });
  const heldForCodTotal = Math.round(heldForCod.reduce((s, h) => s + h.gross, 0) * 100) / 100;
  return { periodStart, periodEnd, defaultCommission, drafts, heldForCod, heldForCodTotal };
}

/** Create PENDING payouts for every store with unpaid delivered sales. */
export async function generateWeeklyPayouts(opts?: {
  periodEnd?: Date;
  markedById?: string;
}) {
  // Serialise concurrent settlement runs (double-click / two admins) with a
  // transaction-scoped advisory lock. Without it, two runs each compute drafts
  // before either commits and both create a payout for the same orders → a store
  // is paid twice. The lock makes the second run recompute AFTER the first commits,
  // so it sees the new payouts and skips those orders.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('store-payout-settlement'))`;
    const { periodStart, periodEnd, drafts } = await computePayoutDrafts(opts);
    const created: Awaited<ReturnType<typeof prisma.payout.create>>[] = [];
    for (const d of drafts) {
      const payout = await tx.payout.create({
        data: {
          storeId: d.storeId,
          periodStart,
          periodEnd,
          grossSales: d.gross,
          commissionRate: d.commissionRate,
          commissionAmount: d.commissionAmount,
          netAmount: d.netAmount,
          status: "PENDING",
          orderIds: d.orderIds,
          bankSnapshot: d.account,
          markedById: opts?.markedById,
        },
      });
      created.push(payout);
    }
    return { periodStart, periodEnd, payouts: created };
  });
}

/** Read-only: what "Pay all stores" would do right now (for the confirmation summary). */
export async function previewSettlement() {
  const { drafts, defaultCommission } = await computePayoutDrafts();
  const pending = await prisma.payout.findMany({
    where: { status: "PENDING" },
    include: {
      store: {
        select: {
          name: true,
          bankAccountTitle: true,
          bankName: true,
          bankAccountNumber: true,
          bankIban: true,
          jazzCashNumber: true,
          jazzCashAccountTitle: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const rows = [
    ...pending.map((p) => {
      const snap = (p.bankSnapshot as BankSnapshot | null) || p.store;
      const pick = pickPayoutMethod(snap);
      return {
        source: "pending" as const,
        id: p.id,
        storeName: p.store.name,
        gross: toNumber(p.grossSales),
        commissionRate: toNumber(p.commissionRate),
        commissionAmount: toNumber(p.commissionAmount),
        netAmount: toNumber(p.netAmount),
        account: describePayoutAccount(snap),
        willPay: !!pick.method,
        skipReason: pick.reason || null,
      };
    }),
    ...drafts.map((d) => ({
      source: "new" as const,
      id: d.storeId,
      storeName: d.storeName,
      gross: d.gross,
      commissionRate: d.commissionRate,
      commissionAmount: d.commissionAmount,
      netAmount: d.netAmount,
      account: describePayoutAccount(d.account),
      willPay: !!d.method,
      skipReason: d.missingReason || null,
    })),
  ];
  const paying = rows.filter((r) => r.willPay);
  return {
    defaultCommissionPct: defaultCommission,
    rows,
    payCount: paying.length,
    skipCount: rows.length - paying.length,
    totalNet: Math.round(paying.reduce((s, r) => s + r.netAmount, 0) * 100) / 100,
    totalCommission: Math.round(paying.reduce((s, r) => s + r.commissionAmount, 0) * 100) / 100,
  };
}

export async function markPayoutPaid(params: {
  payoutId: string;
  markedById: string;
  payoutMethod: "BANK" | "JAZZCASH" | "CASH";
  payoutReference?: string;
  notes?: string;
}) {
  const existing = await prisma.payout.findUnique({ where: { id: params.payoutId } });
  if (!existing) throw new Error("Payout not found");
  if (existing.status === "PAID") throw new Error("Payout already marked paid");
  if (existing.status === "CANCELLED") throw new Error("Cannot pay a cancelled payout");

  // Status flip + ledger journal must be atomic: a crash between them would leave a
  // PAID payout with no STORE_PAYOUT ledger row (reconciliation drift).
  await prisma.$transaction(async (tx) => {
    const res = await tx.payout.updateMany({
      where: { id: params.payoutId, status: "PENDING" },
      data: {
        status: "PAID",
        paidAt: new Date(),
        payoutMethod: params.payoutMethod,
        payoutReference: params.payoutReference,
        notes: params.notes,
        markedById: params.markedById,
      },
    });
    if (res.count === 0) throw new Error("Payout already marked paid");
    await recordStorePayoutLedger(tx, {
      payoutId: existing.id,
      storeId: existing.storeId,
      net: Number(existing.netAmount),
      orderIds: existing.orderIds,
    });
  });
  return prisma.payout.findUniqueOrThrow({ where: { id: params.payoutId } });
}

/**
 * Pay every PENDING store payout in one shot.
 * Auto-selects JazzCash vs BANK from store snapshot. Skips missing payment details.
 */
export async function payAllPendingPayouts(params: {
  markedById: string;
  batchReference?: string;
  notes?: string;
}) {
  const pending = await prisma.payout.findMany({
    where: { status: "PENDING" },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          bankAccountTitle: true,
          bankName: true,
          bankAccountNumber: true,
          bankIban: true,
          jazzCashNumber: true,
          jazzCashAccountTitle: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const batchRef =
    params.batchReference ||
    `BATCH-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).toUpperCase()}`;

  const paid: {
    id: string;
    storeName: string;
    netAmount: number;
    commissionAmount: number;
    method: string;
  }[] = [];
  const skipped: { id: string; storeName: string; reason: string; netAmount: number }[] =
    [];

  for (const p of pending) {
    const snap = (p.bankSnapshot as BankSnapshot | null) || {
      bankAccountTitle: p.store.bankAccountTitle,
      bankName: p.store.bankName,
      bankAccountNumber: p.store.bankAccountNumber,
      bankIban: p.store.bankIban,
      jazzCashNumber: p.store.jazzCashNumber,
      jazzCashAccountTitle: p.store.jazzCashAccountTitle,
    };
    const pick = pickPayoutMethod(snap);
    const net = toNumber(p.netAmount);

    if (!pick.method) {
      skipped.push({
        id: p.id,
        storeName: p.store.name,
        reason: pick.reason || "Missing payment details",
        netAmount: net,
      });
      continue;
    }

    if (net <= 0) {
      // Zero net still close as paid (commission ate everything)
      const claimed = await prisma.$transaction(async (tx) => {
        const res = await tx.payout.updateMany({
          where: { id: p.id, status: "PENDING" },
          data: {
            status: "PAID",
            paidAt: new Date(),
            payoutMethod: pick.method,
            payoutReference: `${batchRef}-ZERO`,
            notes: params.notes || "Zero net after commission — closed",
            markedById: params.markedById,
            bankSnapshot: snap,
          },
        });
        if (res.count === 0) return false; // paid meanwhile by another click
        await recordStorePayoutLedger(tx, {
          payoutId: p.id,
          storeId: p.storeId,
          net: 0,
          orderIds: p.orderIds,
        });
        return true;
      });
      if (!claimed) continue;
      paid.push({
        id: p.id,
        storeName: p.store.name,
        netAmount: 0,
        commissionAmount: toNumber(p.commissionAmount),
        method: pick.method,
      });
      continue;
    }

    const claimed = await prisma.$transaction(async (tx) => {
      const res = await tx.payout.updateMany({
        where: { id: p.id, status: "PENDING" },
        data: {
          status: "PAID",
          paidAt: new Date(),
          payoutMethod: pick.method,
          payoutReference: `${batchRef}-${p.storeId.slice(-6).toUpperCase()}`,
          notes:
            params.notes ||
            `Auto batch payout — commission deducted, paid via ${pick.method}`,
          markedById: params.markedById,
          bankSnapshot: snap,
        },
      });
      if (res.count === 0) return false; // paid meanwhile by another click
      await recordStorePayoutLedger(tx, {
        payoutId: p.id,
        storeId: p.storeId,
        net,
        orderIds: p.orderIds,
      });
      return true;
    });
    if (!claimed) continue;

    paid.push({
      id: p.id,
      storeName: p.store.name,
      netAmount: net,
      commissionAmount: toNumber(p.commissionAmount),
      method: pick.method,
    });
  }

  const totalNetPaid = paid.reduce((s, x) => s + x.netAmount, 0);
  const totalCommission = paid.reduce((s, x) => s + x.commissionAmount, 0);
  const totalSkipped = skipped.reduce((s, x) => s + x.netAmount, 0);

  return {
    batchReference: batchRef,
    paidCount: paid.length,
    skippedCount: skipped.length,
    totalNetPaid,
    totalCommissionKept: totalCommission,
    totalSkipped,
    paid,
    skipped,
  };
}

/**
 * One-click MandiBazaar settlement:
 * 1) Generate weekly payouts (sales − commission) for unpaid delivered orders
 * 2) Pay all PENDING payouts that have bank/JazzCash details
 */
export async function settleAllStores(params: { markedById: string }) {
  const generated = await generateWeeklyPayouts({
    markedById: params.markedById,
  });
  const paid = await payAllPendingPayouts({
    markedById: params.markedById,
    notes: "One-click store settlement — commission auto-deducted",
  });

  return {
    generatedCount: generated.payouts.length,
    periodStart: generated.periodStart,
    periodEnd: generated.periodEnd,
    ...paid,
  };
}
