import { Prisma } from "@prisma/client";
import { toNumber } from "@/lib/utils";

/**
 * Order payment ledger guard (QA P2 data check: "Rs 3,200 paid on a Rs 500 order").
 *
 * Every code path that records money on an order must go through
 * `lockAndAddPayment` (or the pure `addPayment`) so that:
 *  - deliveryFeePaid never exceeds deliveryFee
 *  - productAmountPaid never exceeds subtotal − discount
 *  - remainingAmount = cash still due on delivery (never negative):
 *      products still due + the delivery fee still due when the fee is
 *      CASH_ON_DELIVERY (full cash on delivery for small orders)
 * Anything above what is due is returned as `excess` (caller decides: refund / flag).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type LedgerOrder = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  deliveryFeePaid: number;
  productAmountPaid: number;
  /** "CASH_ON_DELIVERY" = rider collects the delivery fee in cash (full COD) */
  deliveryFeePaymentStatus?: string | null;
};

/**
 * DELIVERY_FEE / PRODUCT_AMOUNT / FULL_PAYMENT: online or manual payments.
 * CASH: cash handed to the rider — pays products first, then the delivery fee
 * (the fee only when it is CASH_ON_DELIVERY).
 */
export type LedgerBucket = "DELIVERY_FEE" | "PRODUCT_AMOUNT" | "FULL_PAYMENT" | "CASH";

export function productDue(o: Pick<LedgerOrder, "subtotal" | "discount">) {
  return round2(Math.max(0, o.subtotal - o.discount));
}

export function feeIsCash(o: Pick<LedgerOrder, "deliveryFeePaymentStatus">) {
  return o.deliveryFeePaymentStatus === "CASH_ON_DELIVERY";
}

/** remainingAmount: cash still due on delivery. */
export function cashRemaining(
  o: Pick<LedgerOrder, "deliveryFee" | "deliveryFeePaymentStatus">,
  deliveryFeePaid: number,
  productRemaining: number
) {
  const fee = feeIsCash(o) ? Math.max(0, o.deliveryFee - deliveryFeePaid) : 0;
  return round2(Math.max(0, productRemaining) + fee);
}

/** What is still unpaid on each part of the order. */
export function outstanding(o: LedgerOrder) {
  const fee = round2(Math.max(0, o.deliveryFee - o.deliveryFeePaid));
  const product = round2(Math.max(0, productDue(o) - o.productAmountPaid));
  return { fee, product, total: round2(fee + product) };
}

/**
 * What the rider still collects in cash: products still due + the delivery fee
 * still due when it is CASH_ON_DELIVERY (full COD). `fee` is 0 otherwise.
 */
export function cashOutstanding(o: LedgerOrder) {
  const due = outstanding(o);
  const fee = feeIsCash(o) ? due.fee : 0;
  return { product: due.product, fee, total: round2(due.product + fee) };
}

/**
 * Pure: add `amount` to the right bucket(s), capped at what is due.
 * FULL_PAYMENT pays the delivery fee first, then products.
 * CASH pays products first, then a cash-on-delivery fee.
 */
export function addPayment(o: LedgerOrder, bucket: LedgerBucket, amount: number) {
  const amt = round2(Math.max(0, Number.isFinite(amount) ? amount : 0));
  const due = outstanding(o);
  const cashFeeDue = feeIsCash(o) ? due.fee : 0;
  let feeAdd = 0;
  let productAdd = 0;
  if (bucket === "DELIVERY_FEE") {
    feeAdd = Math.min(amt, due.fee);
  } else if (bucket === "PRODUCT_AMOUNT") {
    productAdd = Math.min(amt, due.product);
  } else if (bucket === "CASH") {
    productAdd = Math.min(amt, due.product);
    feeAdd = Math.min(round2(amt - productAdd), cashFeeDue);
  } else {
    feeAdd = Math.min(amt, due.fee);
    productAdd = Math.min(round2(amt - feeAdd), due.product);
  }
  feeAdd = round2(feeAdd);
  productAdd = round2(productAdd);
  const deliveryFeePaid = round2(Math.min(o.deliveryFee, o.deliveryFeePaid + feeAdd));
  const productAmountPaid = round2(Math.min(productDue(o), o.productAmountPaid + productAdd));
  const productRemaining = round2(Math.max(0, productDue(o) - productAmountPaid));
  const remainingAmount = cashRemaining(o, deliveryFeePaid, productRemaining);
  return {
    deliveryFeePaid,
    productAmountPaid,
    remainingAmount,
    feeApplied: feeAdd,
    productApplied: productAdd,
    applied: round2(feeAdd + productAdd),
    excess: round2(Math.max(0, amt - feeAdd - productAdd)),
    feeFullyPaid: deliveryFeePaid >= o.deliveryFee - 0.001,
    productFullyPaid: productRemaining <= 0.001,
  };
}

/** Pure: clamp stored values that are already over what is due (repair). */
export function clampLedger(o: LedgerOrder) {
  const deliveryFeePaid = round2(Math.min(Math.max(0, o.deliveryFeePaid), o.deliveryFee));
  const productAmountPaid = round2(Math.min(Math.max(0, o.productAmountPaid), productDue(o)));
  return {
    deliveryFeePaid,
    productAmountPaid,
    remainingAmount: cashRemaining(o, deliveryFeePaid, productDue(o) - productAmountPaid),
    changed:
      deliveryFeePaid !== round2(o.deliveryFeePaid) ||
      productAmountPaid !== round2(o.productAmountPaid),
  };
}

export function toLedgerOrder(order: {
  subtotal: unknown;
  discount: unknown;
  deliveryFee: unknown;
  deliveryFeePaid: unknown;
  productAmountPaid: unknown;
  deliveryFeePaymentStatus?: string | null;
}): LedgerOrder {
  return {
    subtotal: toNumber(order.subtotal),
    discount: toNumber(order.discount),
    deliveryFee: toNumber(order.deliveryFee),
    deliveryFeePaid: toNumber(order.deliveryFeePaid),
    productAmountPaid: toNumber(order.productAmountPaid),
    deliveryFeePaymentStatus: order.deliveryFeePaymentStatus ?? null,
  };
}

/**
 * Inside a transaction: lock the order row and compute the capped ledger after adding
 * the payment. The caller writes the returned values (plus statuses) to the order.
 * `excess` is money above what was due.
 */
export async function lockAndAddPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
  bucket: LedgerBucket,
  amount: number
) {
  // Row lock so two concurrent callbacks/approvals cannot both add on top of the same value
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const next = addPayment(toLedgerOrder(order), bucket, amount);
  return { order, ...next };
}
