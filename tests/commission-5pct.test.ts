import { describe, it, expect } from "vitest";
import { payoutAmounts } from "@/lib/orders/payouts";

/**
 * M1: the platform takes a 5% commission, deducted from the STORE's product sales
 * (never added to the customer total). Spec example: product subtotal 10,000 →
 * commission 500, store net 9,500. Rider delivery fee is NOT part of this base.
 */
describe("5% store commission", () => {
  it("deducts 5% from store gross and leaves 95% net", () => {
    const { commissionAmount, netAmount } = payoutAmounts(10000, 5);
    expect(commissionAmount).toBe(500);
    expect(netAmount).toBe(9500);
    expect(commissionAmount + netAmount).toBe(10000);
  });

  it("rounds commission to whole rupees", () => {
    expect(payoutAmounts(333, 5).commissionAmount).toBe(17); // 16.65 → 17
  });

  it("never returns a negative net", () => {
    expect(payoutAmounts(0, 5).netAmount).toBe(0);
  });
});
