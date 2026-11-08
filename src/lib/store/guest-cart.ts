const KEY = "mb_guest_cart_v1";

export type GuestCartItem = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  name?: string;
  unit?: string;
  unitPrice?: number;
  imageUrl?: string | null;
  freeDelivery?: boolean;
};

export function readGuestCart(): GuestCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeGuestCart(items: GuestCartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full / blocked */
  }
}

export function clearGuestCart() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

/**
 * Add to the guest cart. Pass `maxQuantity` (available stock) to cap the line
 * (QA U2); the cart page also re-caps every line from the live quote.
 */
export function addGuestItem(item: GuestCartItem, opts?: { maxQuantity?: number }) {
  const items = readGuestCart();
  const cap =
    opts?.maxQuantity != null && Number.isFinite(opts.maxQuantity)
      ? Math.max(0, Math.floor(opts.maxQuantity))
      : null;
  const idx = items.findIndex(
    (i) =>
      i.productId === item.productId &&
      (i.variantId || null) === (item.variantId || null)
  );
  if (idx >= 0) {
    items[idx].quantity += item.quantity;
    if (cap != null) items[idx].quantity = Math.min(items[idx].quantity, cap);
    if (item.freeDelivery != null) items[idx].freeDelivery = item.freeDelivery;
  } else {
    const quantity = cap != null ? Math.min(item.quantity, cap) : item.quantity;
    if (quantity > 0) items.push({ ...item, quantity });
  }
  writeGuestCart(items);
  return items;
}

/**
 * Apply a live quote to the guest cart: drop products that no longer exist, cap
 * quantities at available stock and refresh name/price/image. Returns the lines
 * whose quantity was lowered.
 */
export function syncGuestCartWithQuote(
  quoted: {
    productId: string;
    variantId?: string | null;
    available: number;
    productActive?: boolean;
    name?: string;
    unit?: string;
    unitPrice?: number;
    imageUrl?: string | null;
    freeDelivery?: boolean;
  }[],
  missing: { productId: string; variantId?: string | null }[] = []
): { name: string; from: number; to: number }[] {
  const key = (p: string, v?: string | null) => `${p}:${v || ""}`;
  const byKey = new Map(quoted.map((q) => [key(q.productId, q.variantId), q]));
  const gone = new Set(missing.map((m) => key(m.productId, m.variantId)));
  const lowered: { name: string; from: number; to: number }[] = [];
  const next: GuestCartItem[] = [];
  for (const item of readGuestCart()) {
    const k = key(item.productId, item.variantId);
    if (gone.has(k)) continue;
    const q = byKey.get(k);
    if (!q) {
      next.push(item);
      continue;
    }
    let quantity = item.quantity;
    if (q.productActive !== false && q.available > 0 && quantity > q.available) {
      lowered.push({ name: q.name || item.name || "Product", from: quantity, to: q.available });
      quantity = q.available;
    }
    next.push({
      ...item,
      quantity,
      name: q.name ?? item.name,
      unit: q.unit ?? item.unit,
      unitPrice: q.unitPrice ?? item.unitPrice,
      imageUrl: q.imageUrl !== undefined ? q.imageUrl : item.imageUrl,
      freeDelivery: q.freeDelivery ?? item.freeDelivery,
    });
  }
  writeGuestCart(next);
  return lowered;
}

export function updateGuestQty(
  productId: string,
  quantity: number,
  variantId?: string | null
) {
  let items = readGuestCart();
  if (quantity <= 0) {
    items = items.filter(
      (i) =>
        !(
          i.productId === productId &&
          (i.variantId || null) === (variantId || null)
        )
    );
  } else {
    items = items.map((i) =>
      i.productId === productId &&
      (i.variantId || null) === (variantId || null)
        ? { ...i, quantity }
        : i
    );
  }
  writeGuestCart(items);
  return items;
}

/** Merge guest cart into server cart after login — keep failed items locally */
export async function mergeGuestCartToServer() {
  const items = readGuestCart();
  if (!items.length) return 0;
  const remaining: GuestCartItem[] = [];
  let merged = 0;
  for (const item of items) {
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: item.productId,
          variantId: item.variantId || null,
          // Server cart never exceeds stock (QA U2): cap instead of failing
          quantity: Math.min(100, Math.max(1, Math.floor(item.quantity))),
          capToStock: true,
        }),
      });
      if (res.ok) merged++;
      else remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  if (remaining.length) writeGuestCart(remaining);
  else clearGuestCart();
  return merged;
}
