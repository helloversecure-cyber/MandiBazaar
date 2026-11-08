import { create } from "zustand";
import { freeDeliveryStatus } from "@/lib/orders/cart-summary";

type CartState = {
  count: number;
  /**
   * Products subtotal BEFORE any coupon — the amount the free-delivery rule uses
   * (delivery-fee.ts), so the banner and the real fee always agree (QA T2/E5).
   */
  productTotal: number;
  /** 0 = no free-delivery threshold */
  freeDeliveryThreshold: number;
  isFreeDelivery: boolean;
  /** Bumps when cart changes so alert can refetch / toast */
  revision: number;
  setCount: (n: number) => void;
  bump: () => void;
  setDeliveryProgress: (p: {
    productTotal: number;
    freeDeliveryThreshold?: number;
    isFreeDelivery?: boolean;
  }) => void;
};

export const useCartStore = create<CartState>((set) => ({
  count: 0,
  productTotal: 0,
  freeDeliveryThreshold: 5000,
  isFreeDelivery: false,
  revision: 0,
  setCount: (n) => set({ count: n }),
  bump: () => set((s) => ({ count: s.count + 1, revision: s.revision + 1 })),
  setDeliveryProgress: (p) =>
    set((s) => {
      const threshold = p.freeDeliveryThreshold ?? s.freeDeliveryThreshold;
      return {
        productTotal: p.productTotal,
        freeDeliveryThreshold: threshold,
        isFreeDelivery:
          p.isFreeDelivery ?? (threshold > 0 && p.productTotal >= threshold),
      };
    }),
}));

type QuoteLike = {
  items?: unknown[];
  subtotal?: number;
  freeDeliveryThreshold?: number;
  allProductsFreeDelivery?: boolean;
};

/** Apply a cart / quote API payload to the free-delivery banner. */
export function applyCartQuoteToStore(data: QuoteLike) {
  const { setCount, setDeliveryProgress } = useCartStore.getState();
  const subtotal = Number(data.subtotal ?? 0);
  const threshold = Number(data.freeDeliveryThreshold ?? 0);
  const status = freeDeliveryStatus(subtotal, threshold, Boolean(data.allProductsFreeDelivery));
  setCount(data.items?.length || 0);
  setDeliveryProgress({
    productTotal: subtotal,
    freeDeliveryThreshold: status.threshold,
    isFreeDelivery: status.qualifies,
  });
}

let inFlight: Promise<void> | null = null;

/**
 * Refresh free-delivery progress from API or guest cart.
 * Concurrent callers (header, banner, cards) share one request, and guests go
 * straight to the public quote instead of hitting the signed-in cart API (401 noise).
 */
export function refreshCartDeliveryProgress(): Promise<void> {
  if (!inFlight) {
    inFlight = doRefreshCartDeliveryProgress().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function isSignedIn(): Promise<boolean> {
  try {
    const { getSession } = await import("next-auth/react");
    return Boolean((await getSession())?.user);
  } catch {
    return true; // fall back to the server deciding
  }
}

async function doRefreshCartDeliveryProgress() {
  try {
    const signedIn = await isSignedIn();
    const res = signedIn ? await fetch("/api/cart?city=Lahore") : null;
    if (!res || res.status === 401) {
      const { readGuestCart } = await import("@/lib/store/guest-cart");
      const guest = readGuestCart();
      if (!guest.length) {
        applyCartQuoteToStore({ items: [], subtotal: 0 });
        return;
      }
      const q = await fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: guest.map((g) => ({
            productId: g.productId,
            variantId: g.variantId || null,
            quantity: Math.min(1000, Math.max(1, Math.floor(g.quantity) || 1)),
          })),
        }),
      });
      const qd = await q.json();
      if (qd.success) applyCartQuoteToStore(qd.data);
      return;
    }
    const data = await res.json();
    if (data.success) applyCartQuoteToStore(data.data);
  } catch {
    /* ignore */
  }
}
