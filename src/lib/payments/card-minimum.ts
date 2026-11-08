/**
 * Card (Stripe) minimum charge (QA M12/M13). Pure — used by checkout UI and server.
 * Stripe refuses charges below roughly USD 0.50; Rs 150 keeps a safe margin.
 */
export const STRIPE_MIN_AMOUNT_PKR = 150;

/** Amount the customer pays online now: delivery fee (+ products when paying them online). */
export function onlineAmountFor(opts: {
  deliveryFee: number;
  productTotal: number;
  payProductsOnline: boolean;
}): number {
  const fee = Math.max(0, Number(opts.deliveryFee) || 0);
  const products = Math.max(0, Number(opts.productTotal) || 0);
  return Math.round((fee + (opts.payProductsOnline ? products : 0)) * 100) / 100;
}

export function cardAllowedFor(onlineAmount: number): boolean {
  return onlineAmount >= STRIPE_MIN_AMOUNT_PKR;
}

/** Customer-facing explanation when the online amount is below the card minimum. */
export function stripeMinimumMessage(opts: {
  onlineAmount: number;
  deliveryFee: number;
  payProductsOnline: boolean;
  jazzCashAvailable: boolean;
}): string {
  const min = `Rs ${STRIPE_MIN_AMOUNT_PKR.toLocaleString("en-PK")}`;
  const amount = `Rs ${Math.round(opts.onlineAmount).toLocaleString("en-PK")}`;
  if (!opts.payProductsOnline && opts.deliveryFee > 0) {
    const fee = `Rs ${Math.round(opts.deliveryFee).toLocaleString("en-PK")}`;
    return opts.jazzCashAvailable
      ? `Card needs at least ${min}. Pay the ${fee} delivery fee with JazzCash, or pay for your products online too.`
      : `Card needs at least ${min}. Choose "Pay products online now" to pay the ${fee} delivery fee together with your products.`;
  }
  return opts.jazzCashAvailable
    ? `Card needs at least ${min} (this payment is ${amount}). Please pay with JazzCash instead.`
    : `Card needs at least ${min} (this payment is ${amount}). Please add more products to pay by card.`;
}
