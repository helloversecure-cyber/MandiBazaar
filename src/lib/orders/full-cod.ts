/**
 * Full cash on delivery for small orders (owner decision 9).
 *
 * Normally the delivery fee is paid online and only products can be cash on
 * delivery. When the products total AFTER the coupon is at most
 * `StoreSettings.fullCodMaxOrderAmount` (0 = feature off) the customer may pay
 * EVERYTHING (products + delivery fee) in cash to the rider.
 *
 * Such an order is stored with paymentMethod CASH_ON_DELIVERY,
 * productPaymentStatus CASH_ON_DELIVERY and deliveryFeePaymentStatus
 * CASH_ON_DELIVERY. deliveryFeePaymentStatus stays CASH_ON_DELIVERY after the
 * rider collects (it records HOW the fee is paid); `deliveryFeePaid` records how
 * much of it was collected.
 *
 * The pure helpers here are safe on client and server (unit tested in
 * tests/full-cod.test.ts).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

function rupees(n: number) {
  return `Rs ${r2(n).toLocaleString("en-PK")}`;
}

export const FULL_COD_CHOICE = "FULL_COD" as const;

export type FullCodStatus = {
  /** Setting is on (limit > 0) */
  enabled: boolean;
  /** This order may pay everything in cash */
  eligible: boolean;
  /** StoreSettings.fullCodMaxOrderAmount (0 = off) */
  limit: number;
  /** Products total after coupon that was checked */
  productTotal: number;
  /** "Full cash on delivery available for orders up to Rs 2,000" (null when off) */
  message: string | null;
};

/**
 * Eligibility: setting on and products total after the coupon ≤ limit (equal is
 * allowed). An empty order is never eligible.
 */
export function fullCodStatus(productTotalAfterDiscount: number, limit: number): FullCodStatus {
  const max = Math.max(0, Number(limit) || 0);
  const total = r2(Math.max(0, Number(productTotalAfterDiscount) || 0));
  const enabled = max > 0;
  const eligible = enabled && total > 0 && total <= max + 0.001;
  return {
    enabled,
    eligible,
    limit: max,
    productTotal: total,
    message: enabled ? `Full cash on delivery available for orders up to ${rupees(max)}` : null,
  };
}

/** Rider collects the delivery fee in cash on this order. */
export function feeIsCashOnDelivery(o: { deliveryFeePaymentStatus?: string | null }): boolean {
  return o.deliveryFeePaymentStatus === "CASH_ON_DELIVERY";
}

export type CashDueBreakdown = {
  /** Products still to collect */
  products: number;
  /** Delivery fee still to collect in cash (0 unless full COD) */
  delivery: number;
  total: number;
};

/** What the rider must still collect, split into products and delivery fee. */
export function cashDueBreakdown(o: {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  deliveryFeePaid: number;
  productAmountPaid: number;
  deliveryFeePaymentStatus?: string | null;
}): CashDueBreakdown {
  const productDue = Math.max(0, o.subtotal - o.discount);
  const products = r2(Math.max(0, productDue - o.productAmountPaid));
  const delivery = feeIsCashOnDelivery(o) ? r2(Math.max(0, o.deliveryFee - o.deliveryFeePaid)) : 0;
  return { products, delivery, total: r2(products + delivery) };
}

/** "Collect Rs 650 cash (products Rs 500 + delivery Rs 150)" */
export function collectCashLabel(b: CashDueBreakdown, verb = "Collect"): string {
  if (b.delivery > 0) {
    return `${verb} ${rupees(b.total)} cash (products ${rupees(b.products)} + delivery ${rupees(b.delivery)})`;
  }
  return `${verb} ${rupees(b.total)} cash`;
}

/** Delivery fee payment as shown to admins: "Cash (rider)" for full COD orders. */
export function deliveryFeePaymentLabel(o: {
  deliveryFee: number;
  deliveryFeePaid: number;
  deliveryFeePaymentStatus: string;
}): string {
  if (o.deliveryFee <= 0) return "Free";
  if (feeIsCashOnDelivery(o)) {
    return o.deliveryFeePaid >= o.deliveryFee - 0.001 ? "Cash (rider) — collected" : "Cash (rider)";
  }
  return o.deliveryFeePaymentStatus;
}

/** Customer-facing payment line for full COD orders; null for every other order. */
export function fullCodPaymentLabel(o: {
  deliveryFee: number;
  deliveryFeePaymentStatus?: string | null;
}): string | null {
  return feeIsCashOnDelivery(o) && o.deliveryFee > 0
    ? "Cash on delivery (products + delivery fee)"
    : null;
}

/**
 * Server check at order placement for productPaymentChoice "FULL_COD".
 * fullCod = true → store the fee as CASH_ON_DELIVERY; with no delivery fee it is
 * a plain cash-on-delivery order (fullCod false). `error` → reject the order.
 */
export function resolveFullCodChoice(opts: {
  choice: string;
  productTotal: number;
  deliveryFee: number;
  limit: number;
}): { fullCod: boolean; error: string | null } {
  if (opts.choice !== FULL_COD_CHOICE) return { fullCod: false, error: null };
  const status = fullCodStatus(opts.productTotal, opts.limit);
  if (!status.eligible) {
    return {
      fullCod: false,
      error: status.enabled
        ? `Paying everything in cash is only for orders up to ${rupees(status.limit)} (products after coupon). Please pay the delivery fee online.`
        : "Paying the delivery fee in cash is not available right now. Please pay the delivery fee online.",
    };
  }
  return { fullCod: opts.deliveryFee > 0, error: null };
}
