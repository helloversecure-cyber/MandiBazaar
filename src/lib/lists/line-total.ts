/**
 * One line-total rule for item-list offers, shared by the store's bid (its stored
 * itemsTotal), the customer's offer view and order creation on accept — so the
 * total a customer sees and the total accept re-computes can never disagree.
 *
 * Computed in whole paisa: the unit price is first rounded to paisa, then
 * price × quantity is rounded once per line. (Floating-point rupees made
 * 33.33 × 1.5 land on either side of a half paisa depending on the order of
 * operations.)
 */
export function listLineTotal(unitPrice: number, quantity: number): number {
  return paisaLineTotal(unitPrice, quantity) / 100;
}

/** Items total of priced lines: the sum of their line totals. */
export function listItemsTotal(lines: ReadonlyArray<{ unitPrice: number; quantity: number }>): number {
  return sumLineTotals(lines.map((l) => listLineTotal(l.unitPrice, l.quantity)));
}

/** Add rupee line totals in whole paisa (no float drift). */
export function sumLineTotals(totals: ReadonlyArray<number>): number {
  return totals.reduce((s, t) => s + Math.round(t * 100), 0) / 100;
}

function paisaLineTotal(unitPrice: number, quantity: number): number {
  const pricePaisa = Math.round(unitPrice * 100);
  // A tiny epsilon keeps exact halves (4999.5) from rounding down after float noise.
  return Math.round(pricePaisa * quantity + 1e-7);
}
