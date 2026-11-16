import { describe, it, expect } from "vitest";
import { computeDeliveryFee, roundTripKm } from "@/lib/orders/delivery-fee";

describe("delivery fee round trip", () => {
  it("bills go + return at Rs. 10/km", () => {
    const oneWay = 13;
    const billed = roundTripKm(oneWay);
    const rate = 10;
    expect(billed).toBe(26);
    expect(Math.round(billed * rate)).toBe(260);
  });

  it("doubles any one-way distance", () => {
    expect(roundTripKm(5)).toBe(10);
    expect(roundTripKm(0)).toBe(0);
  });
});

describe("computeDeliveryFee free-delivery sponsorship (NEW-08)", () => {
  const settings = { ratePerKm: 10, defaultFee: 100, freeDeliveryThreshold: 5000, minimumOrderAmount: 0, maxDeliveryFee: null };
  const input = { productsSubtotal: 600, stores: [{ storeId: "s1", city: "Lahore", latitude: null, longitude: null }], latitude: null, longitude: null, city: "Lahore" };

  it("store free delivery: customer pays Rs 0 but the store sponsors the notional fee", () => {
    const r = computeDeliveryFee({ ...input, allProductsFreeDelivery: true }, settings);
    expect(r.fee).toBe(0);
    expect(r.isFree).toBe(true);
    expect(r.basis).toBe("FREE_PRODUCTS");
    expect(r.notionalFee).toBe(100); // flat default fee
    expect(r.sponsoredFee).toBe(100); // the store funds the rider on its free deliveries
  });

  it("platform threshold free delivery: the notional fee is the platform's, not the store's", () => {
    const r = computeDeliveryFee({ ...input, productsSubtotal: 6000, allProductsFreeDelivery: false }, settings);
    expect(r.fee).toBe(0);
    expect(r.isFree).toBe(true);
    expect(r.basis).toBe("FREE_THRESHOLD");
    expect(r.notionalFee).toBe(100);
    expect(r.sponsoredFee).toBe(0); // platform absorbs its own promo
  });

  it("paid delivery: no sponsorship", () => {
    const r = computeDeliveryFee({ ...input, allProductsFreeDelivery: false }, settings);
    expect(r.isFree).toBe(false);
    expect(r.fee).toBe(100);
    expect(r.sponsoredFee).toBe(0);
  });
});
