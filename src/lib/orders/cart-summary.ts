/**
 * Cart messages shared by the guest cart, the signed-in cart and checkout
 * (QA E5, U2, U4, M9, EDGE-03). Pure — safe on client and server.
 */

export type CartLineForIssues = {
  name: string;
  quantity: number;
  /** Units the customer can still buy (stock − reserved) */
  available: number;
  productActive: boolean;
  storeId: string;
  storeName: string;
  /** Store is APPROVED (taking orders) */
  storeOpen: boolean;
};

/** One message per closed store, one per problem product. Empty = can check out. */
export function collectCartIssues(lines: CartLineForIssues[]): string[] {
  const issues: string[] = [];
  const closedStores = new Set<string>();
  for (const l of lines) {
    if (!l.storeOpen) {
      if (!closedStores.has(l.storeId)) {
        closedStores.add(l.storeId);
        issues.push(
          `${l.storeName} is not taking orders right now — remove its items to continue.`
        );
      }
      continue;
    }
    if (!l.productActive) {
      issues.push(`${l.name} is no longer available — remove it to continue.`);
    } else if (l.available <= 0) {
      issues.push(`${l.name} is out of stock — remove it to continue.`);
    } else if (l.quantity > l.available) {
      issues.push(`Only ${l.available} left of ${l.name} — reduce the quantity to ${l.available}.`);
    }
  }
  return issues;
}

/** Message for a single line, shown next to the item. */
export function lineStockNote(l: Pick<CartLineForIssues, "available" | "quantity" | "productActive" | "storeOpen" | "storeName">): string | null {
  if (!l.storeOpen) return `${l.storeName} is not taking orders right now`;
  if (!l.productActive) return "No longer available";
  if (l.available <= 0) return "Out of stock";
  if (l.quantity > l.available) return `Only ${l.available} left — reduce the quantity`;
  if (l.quantity >= l.available) return `Only ${l.available} left`;
  if (l.available <= 5) return `Only ${l.available} left`;
  return null;
}

function rupees(n: number) {
  return `Rs ${(Math.round(n * 100) / 100).toLocaleString("en-PK")}`;
}

export type MinimumOrderStatus = {
  amount: number;
  met: boolean;
  shortBy: number;
  message: string | null;
};

/** "Minimum order is Rs 300 — add Rs 35 more" on the products subtotal (before coupon). */
export function minimumOrderStatus(productsSubtotal: number, minimum: number): MinimumOrderStatus {
  const amount = Math.max(0, Number(minimum) || 0);
  const subtotal = Math.max(0, Number(productsSubtotal) || 0);
  const met = subtotal >= amount;
  const shortBy = met ? 0 : Math.ceil((amount - subtotal) * 100) / 100;
  return {
    amount,
    met,
    shortBy,
    message: met ? null : `Minimum order is ${rupees(amount)} — add ${rupees(shortBy)} more`,
  };
}

export type FreeDeliveryStatus = {
  threshold: number;
  qualifies: boolean;
  shortBy: number;
  /** 0–100 for the progress bar */
  progressPct: number;
  message: string | null;
};

/**
 * Free-delivery progress, computed exactly like delivery-fee.ts: products subtotal
 * BEFORE the coupon, or every product free-delivery. threshold 0 = no threshold.
 */
export function freeDeliveryStatus(
  productsSubtotal: number,
  threshold: number,
  allProductsFreeDelivery: boolean
): FreeDeliveryStatus {
  const t = Math.max(0, Number(threshold) || 0);
  const subtotal = Math.max(0, Number(productsSubtotal) || 0);
  if (allProductsFreeDelivery) {
    return { threshold: t, qualifies: true, shortBy: 0, progressPct: 100, message: "Free delivery — every product in your cart has free delivery" };
  }
  if (t <= 0) return { threshold: 0, qualifies: false, shortBy: 0, progressPct: 0, message: null };
  if (subtotal >= t) {
    return { threshold: t, qualifies: true, shortBy: 0, progressPct: 100, message: `Free delivery unlocked — products total is ${rupees(t)}+` };
  }
  const shortBy = Math.ceil((t - subtotal) * 100) / 100;
  return {
    threshold: t,
    qualifies: false,
    shortBy,
    progressPct: Math.min(100, Math.max(0, (subtotal / t) * 100)),
    message: `Add ${rupees(shortBy)} more for free delivery (${rupees(t)}+)`,
  };
}

/** Everything that blocks "Proceed to checkout" / placing the order. */
export function checkoutBlockers(opts: {
  itemCount: number;
  issues: string[];
  minimum: MinimumOrderStatus;
}): string[] {
  if (opts.itemCount === 0) return ["Your cart is empty."];
  const out = [...opts.issues];
  if (!opts.minimum.met && opts.minimum.message) out.push(opts.minimum.message);
  return out;
}
