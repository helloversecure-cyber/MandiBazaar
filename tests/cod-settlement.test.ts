import { describe, it, expect } from "vitest";
import { isOrderCodReconciled } from "@/lib/orders/payouts";

describe("isOrderCodReconciled — store settles only on verified COD cash (spec §8)", () => {
  it("online-paid orders are always reconciled", () => {
    expect(isOrderCodReconciled({ paymentMethod: "JAZZCASH", cashRemittance: null })).toBe(true);
    expect(isOrderCodReconciled({ paymentMethod: "STRIPE_CARD", cashRemittance: null })).toBe(true);
  });
  it("a COD order is reconciled only when its remittance is RECEIVED", () => {
    expect(isOrderCodReconciled({ paymentMethod: "CASH_ON_DELIVERY", cashRemittance: { status: "RECEIVED" } })).toBe(true);
  });
  it("a COD order with pending/partial/overdue/missing remittance is NOT reconciled", () => {
    for (const status of ["PENDING", "SUBMITTED", "UNDER_VERIFICATION", "PARTIALLY_REMITTED", "OVERDUE", "REJECTED"]) {
      expect(isOrderCodReconciled({ paymentMethod: "CASH_ON_DELIVERY", cashRemittance: { status } })).toBe(false);
    }
    expect(isOrderCodReconciled({ paymentMethod: "CASH_ON_DELIVERY", cashRemittance: null })).toBe(false);
  });
});
