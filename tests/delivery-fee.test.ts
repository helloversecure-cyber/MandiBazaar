import { describe, it, expect } from "vitest";
import { roundTripKm } from "@/lib/orders/delivery-fee";

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
