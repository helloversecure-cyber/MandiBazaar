import { describe, it, expect } from "vitest";
import {
  cashDueBreakdown,
  collectCashLabel,
  deliveryFeePaymentLabel,
  fullCodPaymentLabel,
  fullCodStatus,
  resolveFullCodChoice,
} from "@/lib/orders/full-cod";
import {
  addPayment,
  cashOutstanding,
  clampLedger,
  outstanding,
  toLedgerOrder,
  type LedgerOrder,
} from "@/lib/orders/payment-ledger";
import { cashFeeToCollect, summarizeRevenue, type RevenueOrderInput } from "@/lib/orders/revenue";
import { refundableAmount } from "@/lib/orders/refunds";
import { checkoutSchema } from "@/lib/validators/schemas";

describe("full cash on delivery eligibility (owner decision 9)", () => {
  it("is allowed up to and including the limit", () => {
    expect(fullCodStatus(1999, 2000).eligible).toBe(true);
    expect(fullCodStatus(2000, 2000).eligible).toBe(true); // boundary equal
    expect(fullCodStatus(2000.01, 2000).eligible).toBe(false);
    expect(fullCodStatus(2500, 2000).eligible).toBe(false);
  });

  it("limit 0 switches the feature off", () => {
    const s = fullCodStatus(100, 0);
    expect(s.enabled).toBe(false);
    expect(s.eligible).toBe(false);
    expect(s.message).toBeNull();
  });

  it("checks the products total AFTER the coupon discount", () => {
    // subtotal 2,300 − coupon 400 = 1,900 → eligible
    expect(fullCodStatus(2300 - 400, 2000).eligible).toBe(true);
    expect(fullCodStatus(2300, 2000).eligible).toBe(false);
  });

  it("never allows an empty order and shows the limit message", () => {
    expect(fullCodStatus(0, 2000).eligible).toBe(false);
    expect(fullCodStatus(500, 2000).message).toBe(
      "Full cash on delivery available for orders up to Rs 2,000"
    );
  });
});

describe("order placement re-checks FULL_COD", () => {
  it("rejects an order above the limit", () => {
    const r = resolveFullCodChoice({ choice: "FULL_COD", productTotal: 2500, deliveryFee: 150, limit: 2000 });
    expect(r.fullCod).toBe(false);
    expect(r.error).toMatch(/only for orders up to Rs 2,000/);
  });

  it("rejects when the setting is off", () => {
    const r = resolveFullCodChoice({ choice: "FULL_COD", productTotal: 500, deliveryFee: 150, limit: 0 });
    expect(r.error).toMatch(/not available/);
  });

  it("accepts an eligible order (boundary equal) and marks the fee as cash", () => {
    expect(resolveFullCodChoice({ choice: "FULL_COD", productTotal: 2000, deliveryFee: 150, limit: 2000 })).toEqual({
      fullCod: true,
      error: null,
    });
  });

  it("with no delivery fee it is a plain COD order; other choices are untouched", () => {
    expect(resolveFullCodChoice({ choice: "FULL_COD", productTotal: 500, deliveryFee: 0, limit: 2000 })).toEqual({
      fullCod: false,
      error: null,
    });
    expect(resolveFullCodChoice({ choice: "CASH_ON_DELIVERY", productTotal: 9000, deliveryFee: 150, limit: 2000 })).toEqual({
      fullCod: false,
      error: null,
    });
  });

  it("checkoutSchema accepts FULL_COD", () => {
    const r = checkoutSchema.safeParse({
      addressId: "addr1",
      productPaymentChoice: "FULL_COD",
      idempotencyKey: "abcdefgh12",
    });
    expect(r.success).toBe(true);
  });
});

const fullCodOrder: LedgerOrder = {
  subtotal: 600,
  discount: 100,
  deliveryFee: 150,
  deliveryFeePaid: 0,
  productAmountPaid: 0,
  deliveryFeePaymentStatus: "CASH_ON_DELIVERY",
};

describe("payment ledger with a cash delivery fee", () => {
  it("cash due = products still due + cash fee", () => {
    expect(cashOutstanding(fullCodOrder)).toEqual({ product: 500, fee: 150, total: 650 });
    // normal COD (fee paid online) — fee not collected in cash
    expect(cashOutstanding({ ...fullCodOrder, deliveryFeePaymentStatus: "PAID", deliveryFeePaid: 150 })).toEqual({
      product: 500,
      fee: 0,
      total: 500,
    });
    // outstanding() keeps its old shape
    expect(outstanding(fullCodOrder)).toEqual({ fee: 150, product: 500, total: 650 });
  });

  it("full cash collection pays products and fee, nothing left", () => {
    const r = addPayment(fullCodOrder, "CASH", 650);
    expect(r.productAmountPaid).toBe(500);
    expect(r.deliveryFeePaid).toBe(150);
    expect(r.remainingAmount).toBe(0);
    expect(r.applied).toBe(650);
    expect(r.feeApplied).toBe(150);
    expect(r.productApplied).toBe(500);
    expect(r.productFullyPaid).toBe(true);
    expect(r.feeFullyPaid).toBe(true);
    expect(r.excess).toBe(0);
  });

  it("caps at what is due and is idempotent", () => {
    const once = addPayment(fullCodOrder, "CASH", 9999);
    expect(once.applied).toBe(650);
    expect(once.excess).toBe(9349);
    const twice = addPayment(
      { ...fullCodOrder, productAmountPaid: once.productAmountPaid, deliveryFeePaid: once.deliveryFeePaid },
      "CASH",
      650
    );
    expect(twice.applied).toBe(0);
    expect(twice.remainingAmount).toBe(0);
  });

  it("partial cash pays products first, fee stays due", () => {
    const r = addPayment(fullCodOrder, "CASH", 550);
    expect(r.productAmountPaid).toBe(500);
    expect(r.deliveryFeePaid).toBe(50);
    expect(r.remainingAmount).toBe(100);
    expect(r.productFullyPaid).toBe(true);
    expect(r.feeFullyPaid).toBe(false);
  });

  it("cash on a normal COD order never touches the (online) fee", () => {
    const normal = { ...fullCodOrder, deliveryFeePaymentStatus: "PENDING" };
    const r = addPayment(normal, "CASH", 650);
    expect(r.applied).toBe(500);
    expect(r.deliveryFeePaid).toBe(0);
    expect(r.remainingAmount).toBe(0); // remaining = products only for normal orders
    expect(r.excess).toBe(150);
  });

  it("remainingAmount / clamp include the cash fee", () => {
    expect(addPayment(fullCodOrder, "CASH", 0).remainingAmount).toBe(650);
    expect(clampLedger(fullCodOrder).remainingAmount).toBe(650);
    expect(
      toLedgerOrder({
        subtotal: "600",
        discount: "100",
        deliveryFee: "150",
        deliveryFeePaid: "0",
        productAmountPaid: "0",
        deliveryFeePaymentStatus: "CASH_ON_DELIVERY",
      }).deliveryFeePaymentStatus
    ).toBe("CASH_ON_DELIVERY");
  });
});

describe("rider / admin labels", () => {
  it("collect text shows products + delivery", () => {
    const b = cashDueBreakdown(fullCodOrder);
    expect(b).toEqual({ products: 500, delivery: 150, total: 650 });
    expect(collectCashLabel(b)).toBe("Collect Rs 650 cash (products Rs 500 + delivery Rs 150)");
    expect(collectCashLabel({ products: 500, delivery: 0, total: 500 })).toBe("Collect Rs 500 cash");
  });

  it("fee label is Cash (rider) and payment label covers both", () => {
    expect(deliveryFeePaymentLabel({ deliveryFee: 150, deliveryFeePaid: 0, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" })).toBe(
      "Cash (rider)"
    );
    expect(
      deliveryFeePaymentLabel({ deliveryFee: 150, deliveryFeePaid: 150, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" })
    ).toBe("Cash (rider) — collected");
    expect(deliveryFeePaymentLabel({ deliveryFee: 150, deliveryFeePaid: 150, deliveryFeePaymentStatus: "PAID" })).toBe("PAID");
    expect(fullCodPaymentLabel({ deliveryFee: 150, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" })).toBe(
      "Cash on delivery (products + delivery fee)"
    );
    expect(fullCodPaymentLabel({ deliveryFee: 150, deliveryFeePaymentStatus: "PAID" })).toBeNull();
  });
});

function rev(p: Partial<RevenueOrderInput> & { id: string }): RevenueOrderInput {
  return {
    orderStatus: "CONFIRMED",
    subtotal: 0,
    discount: 0,
    deliveryFee: 0,
    deliveryFeePaid: 0,
    deliveryFeePaymentStatus: "PAID",
    payments: [],
    cashCollected: 0,
    refundsCompleted: 0,
    ...p,
  };
}

describe("revenue with full cash-on-delivery orders", () => {
  const normal = rev({
    id: "n",
    subtotal: 830,
    deliveryFee: 100,
    deliveryFeePaid: 100,
    payments: [{ type: "DELIVERY_FEE", status: "SUCCESS", amount: 100 }],
  });

  it("before collection: fee is still to collect, not delivery revenue, and it reconciles", () => {
    const r = summarizeRevenue([
      normal,
      rev({ id: "f", subtotal: 600, discount: 100, deliveryFee: 150, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" }),
    ]);
    expect(r.deliveryRevenue).toBe(100);
    expect(r.cashFeesToCollect).toBe(150);
    expect(r.codToCollect).toBe(830 + 500 + 150);
    expect(r.netSales).toBe(830 + 500 + 100);
    expect(r.netSales + r.cashFeesToCollect).toBe(r.moneyReceived + r.codToCollect - r.refunds);
    expect(r.reconciles).toBe(true);
    expect(r.overRecorded).toBe(0);
  });

  it("after collection: fee counts as delivery revenue and cash collected", () => {
    const r = summarizeRevenue([
      normal,
      rev({
        id: "f",
        orderStatus: "DELIVERED",
        subtotal: 600,
        discount: 100,
        deliveryFee: 150,
        deliveryFeePaid: 150,
        deliveryFeePaymentStatus: "CASH_ON_DELIVERY",
        cashCollected: 650,
      }),
    ]);
    expect(r.deliveryRevenue).toBe(250);
    expect(r.cashCollected).toBe(650);
    expect(r.cashFeesToCollect).toBe(0);
    expect(r.codToCollect).toBe(830);
    expect(r.overRecorded).toBe(0);
    expect(r.netSales).toBe(r.moneyReceived + r.codToCollect - r.refunds);
    expect(r.reconciles).toBe(true);
  });

  it("cancelled full-COD orders are left out entirely", () => {
    const r = summarizeRevenue([
      rev({ id: "c", orderStatus: "CANCELLED", subtotal: 600, deliveryFee: 150, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" }),
    ]);
    expect(r.orderCount).toBe(0);
    expect(r.codToCollect).toBe(0);
    expect(r.cashFeesToCollect).toBe(0);
  });

  it("cashFeeToCollect is 0 for every non-full-COD order", () => {
    expect(cashFeeToCollect({ deliveryFee: 150, deliveryFeePaid: 0, deliveryFeePaymentStatus: "PENDING" })).toBe(0);
    expect(cashFeeToCollect({ deliveryFee: 150, deliveryFeePaid: 0, deliveryFeePaymentStatus: "CASH_ON_DELIVERY" })).toBe(150);
  });
});

describe("cancel / refund of a full-COD order", () => {
  it("nothing to refund online when no online payment was captured", () => {
    expect(refundableAmount([], []).refundable).toBe(0);
  });
});
