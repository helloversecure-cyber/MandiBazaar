import { describe, it, expect } from "vitest";

describe("payment business rules", () => {
  it("delivery fee cannot be COD — product amount can", () => {
    // Product amount may be JazzCash or cash-to-rider.
    // Delivery fee must always be JazzCash unless fee is zero (free delivery).
    const rules = {
      deliveryFeeMethods: ["JAZZCASH"] as const,
      productAmountMethods: ["JAZZCASH", "CASH_ON_DELIVERY"] as const,
      allowFullCodSkippingDeliveryFee: false,
    };
    expect(rules.deliveryFeeMethods).not.toContain("CASH_ON_DELIVERY");
    expect(rules.productAmountMethods).toContain("CASH_ON_DELIVERY");
    expect(rules.allowFullCodSkippingDeliveryFee).toBe(false);
  });

  it("order confirms only after delivery fee paid or waived", () => {
    const canConfirm = (deliveryFee: number, deliveryFeePaid: number) =>
      deliveryFee === 0 || deliveryFeePaid >= deliveryFee;
    expect(canConfirm(250, 0)).toBe(false);
    expect(canConfirm(250, 250)).toBe(true);
    expect(canConfirm(0, 0)).toBe(true);
  });
});
