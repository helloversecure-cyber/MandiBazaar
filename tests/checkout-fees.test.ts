import { describe, it, expect } from "vitest";
import {
  computeDeliveryFee,
  estimateCartDelivery,
  flatDeliveryFee,
  toDeliverySettings,
  type DeliverySettings,
} from "@/lib/orders/delivery-fee";
import {
  checkoutBlockers,
  collectCartIssues,
  freeDeliveryStatus,
  lineStockNote,
  minimumOrderStatus,
} from "@/lib/orders/cart-summary";
import {
  STRIPE_MIN_AMOUNT_PKR,
  cardAllowedFor,
  onlineAmountFor,
  stripeMinimumMessage,
} from "@/lib/payments/card-minimum";

const S: DeliverySettings = {
  ratePerKm: 10,
  defaultFee: 100,
  freeDeliveryThreshold: 5000,
  minimumOrderAmount: 300,
  maxDeliveryFee: null,
};
const noPinStore = [{ storeId: "s1", city: "Lahore", latitude: null, longitude: null }];
const pinStore = [{ storeId: "s1", city: "Lahore", latitude: 31.5, longitude: 74.3 }];

describe("delivery fee rules", () => {
  it("flat fee when no pins", () => {
    const r = computeDeliveryFee({ city: "Lahore", productsSubtotal: 665, stores: noPinStore }, S);
    expect(r.fee).toBe(100);
    expect(r.basis).toBe("FLAT");
    expect(r.freeDeliveryShortBy).toBe(4335);
  });
  it("free at the threshold, measured on products BEFORE the coupon", () => {
    const r = computeDeliveryFee({ city: "Lahore", productsSubtotal: 5000, stores: noPinStore }, S);
    expect(r.isFree).toBe(true);
    expect(r.basis).toBe("FREE_THRESHOLD");
    expect(computeDeliveryFee({ city: "Lahore", productsSubtotal: 4999, stores: noPinStore }, S).fee).toBe(100);
  });
  it("free only when EVERY product is free-delivery (QA E5)", () => {
    expect(computeDeliveryFee({ city: "L", productsSubtotal: 665, stores: noPinStore, allProductsFreeDelivery: true }, S).fee).toBe(0);
    expect(computeDeliveryFee({ city: "L", productsSubtotal: 665, stores: noPinStore, allProductsFreeDelivery: false }, S).fee).toBe(100);
  });
  it("uses deliveryRatePerKm from settings (not a hard-coded 10)", () => {
    const dest = { latitude: 31.55, longitude: 74.3 }; // ~5.56 km one way
    const r10 = computeDeliveryFee({ city: "L", productsSubtotal: 500, stores: pinStore, ...dest }, S);
    const r25 = computeDeliveryFee({ city: "L", productsSubtotal: 500, stores: pinStore, ...dest }, { ...S, ratePerKm: 25 });
    expect(r10.basis).toBe("DISTANCE");
    expect(r10.fee).toBe(Math.round(r10.distanceKm * 10));
    expect(r25.fee).toBe(Math.round(r25.distanceKm * 25));
    expect(r25.ratePerKm).toBe(25);
  });
  it("caps the fee at maxDeliveryFee", () => {
    const far = { latitude: 33.6, longitude: 73.0 }; // Lahore → Islamabad
    const uncapped = computeDeliveryFee({ city: "L", productsSubtotal: 500, stores: pinStore, ...far }, S);
    expect(uncapped.fee).toBeGreaterThan(300);
    const capped = computeDeliveryFee({ city: "L", productsSubtotal: 500, stores: pinStore, ...far }, { ...S, maxDeliveryFee: 300 });
    expect(capped.fee).toBe(300);
    expect(capped.capped).toBe(true);
    const flat = computeDeliveryFee({ city: "L", productsSubtotal: 500, stores: noPinStore }, { ...S, defaultFee: 400, maxDeliveryFee: 250 });
    expect(flat.fee).toBe(250);
  });
  it("multi-store flat fee", () => {
    expect(flatDeliveryFee(S, 1)).toBe(100);
    expect(flatDeliveryFee(S, 3)).toBe(140);
  });
  it("minimum order on products subtotal", () => {
    const r = computeDeliveryFee({ city: "L", productsSubtotal: 265, stores: noPinStore }, S);
    expect(r.meetsMinimum).toBe(false);
    expect(r.minimumOrderShortBy).toBe(35);
  });
  it("settings parsing", () => {
    expect(toDeliverySettings(null)).toEqual({ ratePerKm: 10, defaultFee: 100, freeDeliveryThreshold: 5000, minimumOrderAmount: 0, maxDeliveryFee: null });
    const s = toDeliverySettings({ deliveryRatePerKm: "15", defaultDeliveryFee: 120, freeDeliveryThreshold: 0, minimumOrderAmount: "300", maxDeliveryFee: "0" });
    expect(s).toEqual({ ratePerKm: 15, defaultFee: 120, freeDeliveryThreshold: 0, minimumOrderAmount: 300, maxDeliveryFee: null });
    // threshold 0 = no free delivery by amount
    expect(computeDeliveryFee({ city: "L", productsSubtotal: 99999, stores: noPinStore }, s).isFree).toBe(false);
  });
});

describe("cart delivery message (same for guests and signed-in)", () => {
  it("fixed fee when stores have no pins", () => {
    const e = estimateCartDelivery({ productsSubtotal: 665, allProductsFreeDelivery: false, stores: noPinStore, settings: S });
    expect(e).toEqual({ kind: "FIXED", fee: 100, message: "Delivery fee: Rs 100 (paid online)" });
  });
  it("calculated at checkout when it depends on the address", () => {
    const e = estimateCartDelivery({ productsSubtotal: 665, allProductsFreeDelivery: false, stores: pinStore, settings: S });
    expect(e.kind).toBe("FROM");
    expect(e.message).toContain("calculated at checkout");
  });
  it("free only by the real rules — never 'No delivery fee' for a mixed Rs 665 cart (QA E5)", () => {
    expect(estimateCartDelivery({ productsSubtotal: 665, allProductsFreeDelivery: false, stores: noPinStore, settings: S }).kind).not.toBe("FREE");
    expect(estimateCartDelivery({ productsSubtotal: 665, allProductsFreeDelivery: true, stores: noPinStore, settings: S }).kind).toBe("FREE");
    expect(estimateCartDelivery({ productsSubtotal: 5000, allProductsFreeDelivery: false, stores: noPinStore, settings: S }).kind).toBe("FREE");
  });
});

describe("free-delivery bar agrees with the fee rule", () => {
  it("uses products subtotal before discount", () => {
    // Rs 1,595 cart with a coupon: bar must say add 3,405 (5000 − 1595), not count the discounted total
    expect(freeDeliveryStatus(1595, 5000, false).shortBy).toBe(3405);
    for (const sub of [0, 665, 4999, 5000, 7000]) {
      const bar = freeDeliveryStatus(sub, 5000, false);
      const fee = computeDeliveryFee({ city: "L", productsSubtotal: sub, stores: noPinStore }, S);
      expect(bar.qualifies).toBe(fee.isFree);
      expect(bar.shortBy).toBe(fee.freeDeliveryShortBy);
    }
  });
  it("no bar without a threshold", () => {
    expect(freeDeliveryStatus(100, 0, false)).toMatchObject({ qualifies: false, message: null });
  });
});

describe("minimum order", () => {
  it("message and shortfall (QA U4)", () => {
    expect(minimumOrderStatus(265, 300)).toEqual({ amount: 300, met: false, shortBy: 35, message: "Minimum order is Rs 300 — add Rs 35 more" });
    expect(minimumOrderStatus(300, 300).met).toBe(true);
    expect(minimumOrderStatus(10, 0).met).toBe(true);
  });
  it("blocks checkout", () => {
    expect(checkoutBlockers({ itemCount: 1, issues: [], minimum: minimumOrderStatus(265, 300) })).toEqual(["Minimum order is Rs 300 — add Rs 35 more"]);
    expect(checkoutBlockers({ itemCount: 0, issues: [], minimum: minimumOrderStatus(0, 0) })).toEqual(["Your cart is empty."]);
    expect(checkoutBlockers({ itemCount: 2, issues: [], minimum: minimumOrderStatus(500, 300) })).toEqual([]);
  });
});

describe("cart issues", () => {
  const line = { name: "Daal mash", quantity: 36, available: 28, productActive: true, storeId: "s1", storeName: "Shah Jee Kiryana Store", storeOpen: true };
  it("stock above available (QA U2)", () => {
    expect(collectCartIssues([line])).toEqual(["Only 28 left of Daal mash — reduce the quantity to 28."]);
    expect(lineStockNote({ ...line, quantity: 28 })).toBe("Only 28 left");
  });
  it("suspended store names the store once (EDGE-03)", () => {
    const closed = { ...line, storeOpen: false, quantity: 1 };
    expect(collectCartIssues([closed, { ...closed, name: "Daal Channa" }])).toEqual([
      "Shah Jee Kiryana Store is not taking orders right now — remove its items to continue.",
    ]);
  });
  it("out of stock / inactive", () => {
    expect(collectCartIssues([{ ...line, available: 0 }])[0]).toContain("out of stock");
    expect(collectCartIssues([{ ...line, productActive: false }])[0]).toContain("no longer available");
  });
});

describe("card minimum (QA M12/M13)", () => {
  it("constant", () => {
    expect(STRIPE_MIN_AMOUNT_PKR).toBe(150);
  });
  it("online amount follows the payment choice", () => {
    expect(onlineAmountFor({ deliveryFee: 100, productTotal: 400, payProductsOnline: false })).toBe(100);
    expect(onlineAmountFor({ deliveryFee: 100, productTotal: 400, payProductsOnline: true })).toBe(500);
    expect(onlineAmountFor({ deliveryFee: 0, productTotal: 120, payProductsOnline: true })).toBe(120);
  });
  it("card disabled below the minimum, with the right advice", () => {
    expect(cardAllowedFor(100)).toBe(false);
    expect(cardAllowedFor(150)).toBe(true);
    expect(stripeMinimumMessage({ onlineAmount: 100, deliveryFee: 100, payProductsOnline: false, jazzCashAvailable: true })).toBe(
      "Card needs at least Rs 150. Pay the Rs 100 delivery fee with JazzCash, or pay for your products online too."
    );
    expect(stripeMinimumMessage({ onlineAmount: 100, deliveryFee: 100, payProductsOnline: false, jazzCashAvailable: false })).toContain("Pay products online now");
  });
});
