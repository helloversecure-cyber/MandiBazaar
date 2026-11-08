import { describe, it, expect } from "vitest";
import { OrderStatus } from "@prisma/client";
import {
  adminNextStatuses,
  canTransition,
  nextStatuses,
  validateAdminStatusChange,
} from "@/lib/orders/state-machine";
import { summarizeRevenue, type RevenueOrderInput } from "@/lib/orders/revenue";
import { addPayment, clampLedger, outstanding } from "@/lib/orders/payment-ledger";
import { manualPaymentDue } from "@/lib/orders/apply-manual-online-payment";
import { isUsableImageUrl, proofDecisionFor } from "@/lib/orders/proof-review";
import { fulfillmentStatusFor } from "@/lib/orders/fulfillment-sync";
import { customerDisplayPhone, orderWaitingFlag } from "@/lib/orders/attention";
import { describePayoutAccount, payoutAmounts } from "@/lib/orders/payouts";
import { refundableAmount } from "@/lib/orders/refunds";

const S = OrderStatus;

describe("order state machine (QA P2 / ORD-07)", () => {
  it("never allows Cancelled → anything, incl. Delivered", () => {
    expect(nextStatuses(S.CANCELLED)).toEqual([]);
    expect(canTransition(S.CANCELLED, S.DELIVERED)).toBe(false);
    expect(adminNextStatuses({ orderStatus: S.CANCELLED })).toEqual([]);
    expect(validateAdminStatusChange({ orderStatus: S.CANCELLED }, S.DELIVERED)).toMatch(/Cannot change/);
  });

  it("offers only the forward step + cancel for each pipeline status", () => {
    const opts = (st: OrderStatus, extra = {}) =>
      adminNextStatuses({ orderStatus: st, ...extra }).map((x) => x.status);
    expect(opts(S.CONFIRMED)).toEqual([S.PROCESSING, S.CANCELLED]);
    expect(opts(S.PROCESSING)).toEqual([S.PACKED, S.CANCELLED]);
    expect(opts(S.PACKED)).toEqual([S.READY_FOR_DISPATCH, S.CANCELLED]);
    // assigning is done with "Assign rider", not the status menu
    expect(opts(S.READY_FOR_DISPATCH)).toEqual([S.CANCELLED]);
    expect(opts(S.ASSIGNED_TO_RIDER)).toEqual([S.OUT_FOR_DELIVERY, S.CANCELLED]);
    expect(opts(S.OUT_FOR_DELIVERY)).toEqual([S.DELIVERED, S.FAILED, S.RETURNED]);
    expect(opts(S.DELIVERED)).toEqual([S.RETURNED]);
    expect(opts(S.RETURNED)).toEqual([]);
  });

  it("does not let admin mark an unpaid order Confirmed by hand", () => {
    expect(adminNextStatuses({ orderStatus: S.PENDING_PAYMENT }).map((x) => x.status)).toEqual([
      S.CANCELLED,
      S.FAILED,
    ]);
    expect(validateAdminStatusChange({ orderStatus: S.PENDING_PAYMENT }, S.CONFIRMED)).toMatch(/payment/);
  });

  it("requires a reason to cancel and blocks impossible steps", () => {
    expect(validateAdminStatusChange({ orderStatus: S.CONFIRMED }, S.CANCELLED)).toBe("Please give a reason");
    expect(validateAdminStatusChange({ orderStatus: S.CONFIRMED }, S.CANCELLED, { reason: "Out of stock" })).toBeNull();
    expect(validateAdminStatusChange({ orderStatus: S.CONFIRMED }, S.DELIVERED)).toMatch(/Cannot change/);
    expect(validateAdminStatusChange({ orderStatus: S.CONFIRMED }, S.CONFIRMED)).toMatch(/already/);
    expect(validateAdminStatusChange({ orderStatus: S.CONFIRMED }, "BOGUS" as OrderStatus)).toBe("Unknown order status");
  });

  it("needs a rider for out-for-delivery and collected cash for delivered", () => {
    expect(validateAdminStatusChange({ orderStatus: S.ASSIGNED_TO_RIDER, riderId: null }, S.OUT_FOR_DELIVERY)).toBe(
      "Assign a rider first"
    );
    expect(validateAdminStatusChange({ orderStatus: S.ASSIGNED_TO_RIDER, riderId: "r1" }, S.OUT_FOR_DELIVERY)).toBeNull();
    expect(
      validateAdminStatusChange(
        { orderStatus: S.OUT_FOR_DELIVERY, riderId: "r1", remainingAmount: 400, cashCollected: false },
        S.DELIVERED
      )
    ).toMatch(/cash/);
    expect(
      validateAdminStatusChange(
        { orderStatus: S.OUT_FOR_DELIVERY, riderId: "r1", remainingAmount: 0 },
        S.DELIVERED
      )
    ).toBeNull();
    expect(validateAdminStatusChange({ orderStatus: S.READY_FOR_DISPATCH }, S.ASSIGNED_TO_RIDER)).toMatch(/rider/);
    expect(validateAdminStatusChange({ orderStatus: S.READY_FOR_DISPATCH }, S.ASSIGNED_TO_RIDER, { riderId: "r1" })).toBeNull();
  });
});

function order(p: Partial<RevenueOrderInput> & { id: string }): RevenueOrderInput {
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

describe("dashboard revenue reconciliation (QA P1)", () => {
  const orders: RevenueOrderInput[] = [
    // paid online in full: products 400 + fee 100
    order({
      id: "a",
      orderNumber: "ORD-A",
      subtotal: 400,
      deliveryFee: 100,
      deliveryFeePaid: 100,
      payments: [{ type: "FULL_PAYMENT", status: "SUCCESS", amount: 500 }],
    }),
    // COD products 830, fee paid online 100, cash not collected yet
    order({
      id: "b",
      subtotal: 830,
      deliveryFee: 100,
      deliveryFeePaid: 100,
      payments: [
        { type: "DELIVERY_FEE", status: "SUCCESS", amount: 100 },
        { type: "DELIVERY_FEE", status: "INITIATED", amount: 100 }, // attempt — never counted
        { type: "DELIVERY_FEE", status: "FAILED", amount: 100 },
      ],
    }),
    // delivered COD with coupon, cash collected, partly refunded
    order({
      id: "c",
      orderStatus: "DELIVERED",
      subtotal: 1000,
      discount: 100,
      deliveryFee: 150,
      deliveryFeePaid: 150,
      payments: [{ type: "DELIVERY_FEE", status: "SUCCESS", amount: 150 }],
      cashCollected: 900,
      refundsCompleted: 200,
    }),
    // excluded statuses
    order({ id: "x1", orderStatus: "CANCELLED", subtotal: 999, payments: [{ type: "FULL_PAYMENT", status: "SUCCESS", amount: 999 }] }),
    order({ id: "x2", orderStatus: "PENDING_PAYMENT", subtotal: 777 }),
    order({ id: "x3", orderStatus: "FAILED", subtotal: 555 }),
  ];

  it("counts only paid, non-cancelled orders and reconciles", () => {
    const r = summarizeRevenue(orders);
    expect(r.orderCount).toBe(3);
    expect(r.grossProductSales).toBe(2230);
    expect(r.discounts).toBe(100);
    expect(r.deliveryRevenue).toBe(350);
    expect(r.refunds).toBe(200);
    expect(r.netSales).toBe(2230 - 100 + 350 - 200);
    expect(r.onlinePayments).toBe(500 + 100 + 150);
    expect(r.cashCollected).toBe(900);
    expect(r.moneyReceived).toBe(1650);
    expect(r.codToCollect).toBe(830);
    expect(r.revenuePaid).toBe(1650 - 200);
    expect(r.netSales).toBe(r.moneyReceived + r.codToCollect - r.refunds);
    expect(r.reconciles).toBe(true);
    expect(r.overRecorded).toBe(0);
  });

  it("a duplicated capture cannot inflate online payments (Rs 3,200 on a Rs 500 order)", () => {
    const r = summarizeRevenue([
      order({
        id: "dup",
        orderNumber: "ORD-20261010-000004",
        subtotal: 400,
        deliveryFee: 100,
        deliveryFeePaid: 100,
        payments: [
          { type: "FULL_PAYMENT", status: "SUCCESS", amount: 500 },
          { type: "PRODUCT_AMOUNT", status: "SUCCESS", amount: 400 },
        ],
        cashCollected: 400,
      }),
    ]);
    expect(r.onlinePayments).toBe(500);
    expect(r.cashCollected).toBe(0);
    expect(r.moneyReceived).toBe(500);
    expect(r.overRecorded).toBe(800);
    expect(r.overRecordedOrders).toEqual(["ORD-20261010-000004"]);
    expect(r.reconciles).toBe(true);
  });

  it("empty period is all zeros and still reconciles", () => {
    const r = summarizeRevenue([]);
    expect(r.netSales).toBe(0);
    expect(r.moneyReceived).toBe(0);
    expect(r.reconciles).toBe(true);
  });
});

describe("payment ledger caps (QA P2 data check)", () => {
  const base = { subtotal: 400, discount: 0, deliveryFee: 100, deliveryFeePaid: 0, productAmountPaid: 0 };

  it("full payment fills fee then products, excess is reported not stored", () => {
    const r = addPayment(base, "FULL_PAYMENT", 3200);
    expect(r.deliveryFeePaid).toBe(100);
    expect(r.productAmountPaid).toBe(400);
    expect(r.remainingAmount).toBe(0);
    expect(r.excess).toBe(2700);
  });

  it("applying the same product payment twice never goes above what is due", () => {
    const once = addPayment(base, "PRODUCT_AMOUNT", 400);
    const twice = addPayment({ ...base, productAmountPaid: once.productAmountPaid }, "PRODUCT_AMOUNT", 400);
    expect(twice.productAmountPaid).toBe(400);
    expect(twice.applied).toBe(0);
    expect(twice.excess).toBe(400);
  });

  it("partial product payment leaves the rest outstanding", () => {
    const r = addPayment(base, "PRODUCT_AMOUNT", 150);
    expect(r.productAmountPaid).toBe(150);
    expect(r.remainingAmount).toBe(250);
    expect(r.productFullyPaid).toBe(false);
  });

  it("clamps over-recorded rows and reports outstanding", () => {
    const c = clampLedger({ ...base, deliveryFeePaid: 100, productAmountPaid: 3100 });
    expect(c).toMatchObject({ deliveryFeePaid: 100, productAmountPaid: 400, remainingAmount: 0, changed: true });
    expect(outstanding({ ...base, deliveryFeePaid: 100 })).toEqual({ fee: 0, product: 400, total: 400 });
  });

  it("manual receipt amount due follows what is still unpaid", () => {
    const o = {
      deliveryFeePaymentStatus: "PENDING",
      productPaymentStatus: "PENDING",
      subtotal: 400,
      discount: 50,
      deliveryFee: 100,
      deliveryFeePaid: 0,
      productAmountPaid: 0,
    };
    expect(manualPaymentDue(o)).toEqual({ type: "FULL_PAYMENT", amount: 450 });
    expect(manualPaymentDue({ ...o, productPaymentStatus: "CASH_ON_DELIVERY" })).toEqual({ type: "DELIVERY_FEE", amount: 100 });
    expect(manualPaymentDue({ ...o, deliveryFeePaymentStatus: "PAID", deliveryFeePaid: 100 })).toEqual({
      type: "PRODUCT_AMOUNT",
      amount: 350,
    });
    expect(
      manualPaymentDue({ ...o, deliveryFeePaymentStatus: "PAID", deliveryFeePaid: 100, productPaymentStatus: "PAID", productAmountPaid: 350 })
    ).toBeNull();
  });
});

describe("receipt review rules (QA P6 / EDGE-04)", () => {
  const pending = { status: "PENDING_REVIEW", riderId: null, imageUrl: "/uploads/proofs/a.jpg" };
  const openOrder = { orderStatus: "PENDING_PAYMENT", productPaymentStatus: "PENDING", deliveryFeePaymentStatus: "PENDING" };

  it("approves a clear receipt on an unpaid order", () => {
    expect(proofDecisionFor(pending, openOrder)).toEqual({ canApprove: true, canRefund: false, blockedReason: null });
  });

  it("never approves on a cancelled or refunded order; offers refund for cancelled", () => {
    const c = proofDecisionFor(pending, { ...openOrder, orderStatus: "CANCELLED" });
    expect(c.canApprove).toBe(false);
    expect(c.canRefund).toBe(true);
    const rf = proofDecisionFor(pending, { ...openOrder, orderStatus: "CONFIRMED", productPaymentStatus: "REFUNDED" });
    expect(rf.canApprove).toBe(false);
  });

  it("blocks blank images and duplicate receipts", () => {
    expect(proofDecisionFor({ ...pending, imageUrl: "" }, openOrder).canApprove).toBe(false);
    expect(proofDecisionFor(pending, { ...openOrder, orderStatus: "CONFIRMED" }).canApprove).toBe(false);
    // rider proof on an active order is allowed
    expect(proofDecisionFor({ ...pending, riderId: "r1" }, { ...openOrder, orderStatus: "OUT_FOR_DELIVERY" }).canApprove).toBe(true);
    expect(isUsableImageUrl("https://x.blob.core/abc.jpg")).toBe(true);
    expect(isUsableImageUrl("http://evil.com/a.jpg")).toBe(false);
    expect(isUsableImageUrl("/uploads/")).toBe(false);
    expect(isUsableImageUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("store fulfilment sync", () => {
  it("promotes unpaid fulfilments when the order is confirmed and follows forward moves only", () => {
    expect(fulfillmentStatusFor(S.CONFIRMED, S.PENDING_PAYMENT)).toBe(S.CONFIRMED);
    expect(fulfillmentStatusFor(S.PROCESSING, S.READY_FOR_DISPATCH)).toBeNull();
    expect(fulfillmentStatusFor(S.OUT_FOR_DELIVERY, S.READY_FOR_DISPATCH)).toBe(S.OUT_FOR_DELIVERY);
    expect(fulfillmentStatusFor(S.CANCELLED, S.READY_FOR_DISPATCH)).toBe(S.CANCELLED);
    expect(fulfillmentStatusFor(S.DELIVERED, S.CANCELLED)).toBeNull();
  });
});

describe("waiting-too-long flags & phone column", () => {
  const now = new Date("2026-11-07T12:00:00Z").getTime();
  const h = (n: number) => new Date(now - n * 3600_000);
  it("flags ready-without-rider after 2 h and unpaid after the TTL", () => {
    expect(orderWaitingFlag({ orderStatus: S.READY_FOR_DISPATCH, createdAt: h(5), updatedAt: h(3), riderId: null }, now, 45)).toMatch(/no rider/);
    expect(orderWaitingFlag({ orderStatus: S.READY_FOR_DISPATCH, createdAt: h(5), updatedAt: h(1), riderId: null }, now, 45)).toBeNull();
    expect(orderWaitingFlag({ orderStatus: S.PENDING_PAYMENT, createdAt: h(1), updatedAt: h(1) }, now, 45)).toMatch(/Unpaid/);
    expect(orderWaitingFlag({ orderStatus: S.DELIVERED, createdAt: h(99), updatedAt: h(99) }, now, 45)).toBeNull();
  });
  it("shows the address phone when the account phone holds a name", () => {
    const valid = (v: string) => /^03\d{9}$/.test(v);
    expect(customerDisplayPhone("Ali Khan", "03001234567", valid)).toEqual({
      phone: "03001234567",
      source: "address",
      accountPhoneInvalid: true,
    });
    expect(customerDisplayPhone("03009876543", "03001234567", valid).source).toBe("account");
  });
});

describe("payouts & refunds limits (QA P7)", () => {
  it("commission and net", () => {
    expect(payoutAmounts(1149, 10)).toEqual({ commissionAmount: 115, netAmount: 1034 });
    expect(describePayoutAccount({ jazzCashNumber: "03001234567" })).toBe("JazzCash ••••4567");
    expect(describePayoutAccount({})).toBe("No payout account");
  });
  it("refundable = captured − refunds open or done (fully refunded payment cannot be refunded again)", () => {
    expect(refundableAmount([{ status: "SUCCESS", amount: 500 }], [{ status: "PENDING", amount: 200 }]).refundable).toBe(300);
    expect(refundableAmount([{ status: "REFUNDED", amount: 500 }], [{ status: "COMPLETED", amount: 500 }]).refundable).toBe(0);
    expect(refundableAmount([{ status: "INITIATED", amount: 500 }], []).refundable).toBe(0);
    expect(refundableAmount([{ status: "SUCCESS", amount: 500 }], [{ status: "REJECTED", amount: 500 }]).refundable).toBe(500);
  });
});
