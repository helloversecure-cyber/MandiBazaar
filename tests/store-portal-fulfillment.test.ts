import { describe, expect, it } from "vitest";
import { storeFulfillmentActions, storeFulfillmentBlockReason } from "@/lib/stores/fulfillment-rules";
import { plural, maskTail } from "@/lib/portal/format";

const ctx = (orderStatus: string, fulfillmentStatus: string, productPaymentStatus = "PAID") => ({
  orderStatus,
  fulfillmentStatus,
  productPaymentStatus,
  deliveryFeePaymentStatus: "PAID",
});

describe("store fulfillment gating (N2)", () => {
  it("blocks cancelled, unpaid, failed and refunded orders", () => {
    expect(storeFulfillmentBlockReason(ctx("CANCELLED", "CONFIRMED"), "READY_FOR_DISPATCH")).toMatch(/cancelled/);
    expect(storeFulfillmentBlockReason(ctx("PENDING_PAYMENT", "PENDING_PAYMENT"), "READY_FOR_DISPATCH")).toMatch(/not paid/);
    expect(storeFulfillmentBlockReason(ctx("CONFIRMED", "PENDING_PAYMENT"), "PROCESSING")).toMatch(/not paid/);
    expect(storeFulfillmentBlockReason(ctx("FAILED", "CONFIRMED"), "PACKED")).toBeTruthy();
    expect(storeFulfillmentBlockReason(ctx("CONFIRMED", "CONFIRMED", "REFUNDED"), "READY_FOR_DISPATCH")).toMatch(/refunded/);
    expect(storeFulfillmentActions(ctx("CANCELLED", "CONFIRMED"))).toEqual([]);
  });

  it("allows forward steps on confirmed orders (processing → packed → ready)", () => {
    expect(storeFulfillmentActions(ctx("CONFIRMED", "CONFIRMED"))).toEqual(["PROCESSING", "PACKED", "READY_FOR_DISPATCH"]);
    expect(storeFulfillmentActions(ctx("PROCESSING", "PROCESSING"))).toEqual(["PACKED", "READY_FOR_DISPATCH"]);
    expect(storeFulfillmentActions(ctx("PROCESSING", "PACKED"))).toEqual(["READY_FOR_DISPATCH"]);
    expect(storeFulfillmentBlockReason(ctx("CONFIRMED", "CONFIRMED", "CASH_ON_DELIVERY"), "READY_FOR_DISPATCH")).toBeNull();
  });

  it("rejects backwards / unknown steps and already-ready orders", () => {
    expect(storeFulfillmentBlockReason(ctx("PROCESSING", "PACKED"), "PROCESSING")).toMatch(/already done/);
    expect(storeFulfillmentBlockReason(ctx("CONFIRMED", "CONFIRMED"), "DELIVERED")).toBeTruthy();
    expect(storeFulfillmentBlockReason(ctx("PROCESSING", "READY_FOR_DISPATCH"), "READY_FOR_DISPATCH")).toMatch(/already/);
  });
});

describe("portal format helpers (M11, O6)", () => {
  it("plural", () => {
    expect(plural(1, "order")).toBe("1 order");
    expect(plural(2, "order")).toBe("2 orders");
    expect(plural(0, "item")).toBe("0 items");
    expect(plural(1, "delivery", "deliveries")).toBe("1 delivery");
    expect(plural(3, "delivery", "deliveries")).toBe("3 deliveries");
  });
  it("maskTail", () => {
    expect(maskTail("0012345678904567")).toBe("****4567");
    expect(maskTail(null)).toBeNull();
  });
});
