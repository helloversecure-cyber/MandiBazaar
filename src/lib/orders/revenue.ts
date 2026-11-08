/**
 * Dashboard / reports money maths (QA P1, P12). Pure — unit tested in
 * tests/admin-money-revenue.test.ts.
 *
 * Which orders count: placed in the period and NOT unpaid / cancelled / failed
 * (PENDING_PAYMENT, CANCELLED, FAILED are excluded). Returned orders stay in, their
 * refunds are subtracted.
 *
 * Sales side
 *   Gross product sales − Discounts + Delivery fees paid − Refunds = Net sales
 * Money side
 *   Online payments + Cash collected = Money received
 *   Net sales + Cash delivery fees to collect
 *     = Money received + COD still to collect − Refunds                (always reconciles)
 *   Revenue (paid) = Money received − Refunds
 *
 * Full cash on delivery (deliveryFeePaymentStatus CASH_ON_DELIVERY): the delivery
 * fee counts as delivery revenue only once the rider collected it
 * (deliveryFeePaid). Until then it is in "COD still to collect" and in
 * "Cash delivery fees to collect" (so the check above still adds up). With no
 * full-COD orders cashFeesToCollect is 0 and the check is the old one.
 *
 * Online payments are SUCCESSFUL captures (Payment rows with status SUCCESS, or
 * REFUNDED = captured then refunded), never attempts/transactions, and per order
 * they are capped at what the order billed, so a duplicate record cannot inflate
 * the total. Anything above the bill is reported as `overRecorded` for review.
 */

export const REVENUE_EXCLUDED_STATUSES = ["PENDING_PAYMENT", "CANCELLED", "FAILED"] as const;

export type RevenuePaymentInput = {
  type: string; // DELIVERY_FEE | PRODUCT_AMOUNT | FULL_PAYMENT | REFUND
  status: string; // PaymentTxnStatus
  amount: number;
};

export type RevenueOrderInput = {
  id: string;
  orderNumber?: string;
  orderStatus: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  deliveryFeePaid: number;
  deliveryFeePaymentStatus: string;
  payments: RevenuePaymentInput[];
  /** CashCollection.amountCollected (0 when none) */
  cashCollected: number;
  /** Sum of COMPLETED refunds on this order */
  refundsCompleted: number;
};

export type RevenueSummary = {
  orderCount: number;
  grossProductSales: number;
  discounts: number;
  deliveryRevenue: number;
  refunds: number;
  netSales: number;
  onlinePayments: number;
  cashCollected: number;
  moneyReceived: number;
  codToCollect: number;
  /** Full-COD delivery fees not collected yet (included in codToCollect, not in netSales) */
  cashFeesToCollect: number;
  revenuePaid: number;
  overRecorded: number;
  overRecordedOrders: string[];
  /** true when Net sales + cash fees to collect = Money received + COD to collect − Refunds (to the paisa) */
  reconciles: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const CAPTURED = new Set(["SUCCESS", "REFUNDED"]);

export function countsAsRevenue(orderStatus: string): boolean {
  return !(REVENUE_EXCLUDED_STATUSES as readonly string[]).includes(orderStatus);
}

/** Delivery fee actually paid on this order (0 when it was never paid). */
export function deliveryFeeEarned(o: Pick<RevenueOrderInput, "deliveryFee" | "deliveryFeePaid" | "deliveryFeePaymentStatus">) {
  if (o.deliveryFee <= 0) return 0;
  if (o.deliveryFeePaymentStatus === "PAID" || o.deliveryFeePaymentStatus === "REFUNDED") {
    return o.deliveryFee;
  }
  return Math.min(o.deliveryFee, Math.max(0, o.deliveryFeePaid));
}

/** Full-COD delivery fee still to be collected in cash (0 for every other order). */
export function cashFeeToCollect(o: Pick<RevenueOrderInput, "deliveryFee" | "deliveryFeePaid" | "deliveryFeePaymentStatus">) {
  if (o.deliveryFeePaymentStatus !== "CASH_ON_DELIVERY" || o.deliveryFee <= 0) return 0;
  return r2(Math.max(0, o.deliveryFee - deliveryFeeEarned(o)));
}

export function summarizeRevenue(orders: RevenueOrderInput[]): RevenueSummary {
  let gross = 0;
  let discounts = 0;
  let delivery = 0;
  let refunds = 0;
  let online = 0;
  let cash = 0;
  let toCollect = 0;
  let cashFees = 0;
  let over = 0;
  const overOrders: string[] = [];
  let count = 0;

  for (const o of orders) {
    if (!countsAsRevenue(o.orderStatus)) continue;
    count++;
    const productBilled = Math.max(0, o.subtotal - o.discount);
    const feeEarned = deliveryFeeEarned(o);
    const feeToCollect = cashFeeToCollect(o);
    const billed = r2(productBilled + feeEarned);
    // What the order will bring in once the rider collects (full COD fee included)
    const expected = r2(billed + feeToCollect);

    gross += o.subtotal;
    discounts += Math.min(o.discount, o.subtotal);
    delivery += feeEarned;
    refunds += Math.max(0, o.refundsCompleted);

    const capturedOnline = o.payments
      .filter((p) => p.type !== "REFUND" && CAPTURED.has(p.status))
      .reduce((s, p) => s + Math.max(0, p.amount), 0);
    const cashIn = Math.max(0, o.cashCollected);

    const onlineCounted = Math.min(capturedOnline, billed);
    const cashCounted = Math.min(cashIn, Math.max(0, billed - onlineCounted));
    cashFees += feeToCollect;
    const extra = r2(capturedOnline + cashIn - onlineCounted - cashCounted);
    if (extra > 0) {
      over += extra;
      overOrders.push(o.orderNumber || o.id);
    }
    online += onlineCounted;
    cash += cashCounted;
    toCollect += Math.max(0, expected - onlineCounted - cashCounted);
  }

  const grossProductSales = r2(gross);
  const discountsR = r2(discounts);
  const deliveryRevenue = r2(delivery);
  const refundsR = r2(refunds);
  const netSales = r2(grossProductSales - discountsR + deliveryRevenue - refundsR);
  const onlinePayments = r2(online);
  const cashCollected = r2(cash);
  const moneyReceived = r2(onlinePayments + cashCollected);
  const codToCollect = r2(toCollect);
  const cashFeesToCollect = r2(cashFees);
  return {
    orderCount: count,
    grossProductSales,
    discounts: discountsR,
    deliveryRevenue,
    refunds: refundsR,
    netSales,
    onlinePayments,
    cashCollected,
    moneyReceived,
    codToCollect,
    cashFeesToCollect,
    revenuePaid: r2(moneyReceived - refundsR),
    overRecorded: r2(over),
    overRecordedOrders: overOrders,
    reconciles:
      Math.abs(netSales + cashFeesToCollect - (moneyReceived + codToCollect - refundsR)) < 0.005,
  };
}

/** Labels for the dashboard / reports / CSV (QA P12: proper spaces). */
export const REVENUE_LABELS: Record<
  | "grossProductSales"
  | "discounts"
  | "deliveryRevenue"
  | "refunds"
  | "netSales"
  | "onlinePayments"
  | "cashCollected"
  | "moneyReceived"
  | "codToCollect"
  | "cashFeesToCollect"
  | "revenuePaid",
  string
> = {
  grossProductSales: "Gross product sales",
  discounts: "Discounts",
  deliveryRevenue: "Delivery fees paid",
  refunds: "Refunds",
  netSales: "Net sales",
  onlinePayments: "Online payments",
  cashCollected: "Cash collected",
  moneyReceived: "Money received",
  codToCollect: "COD still to collect",
  cashFeesToCollect: "Cash delivery fees to collect",
  revenuePaid: "Revenue (paid)",
};
