import { describe, it, expect } from "vitest";
import { canTransition } from "../src/lib/orders/state-machine";
import { OrderStatus } from "@prisma/client";
import {
  generateSecureHash,
  verifySecureHash,
  toPaisa,
  generateTxnRefNo,
} from "../src/lib/payments/jazzcash";
import { generateOrderNumber, discountPercent, slugify } from "../src/lib/utils";

describe("order state machine", () => {
  it("allows pending payment to confirmed", () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED)).toBe(true);
  });

  it("disallows delivered to processing", () => {
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PROCESSING)).toBe(false);
  });

  it("allows confirmed to cancelled", () => {
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe(true);
  });
});

describe("jazzcash helpers", () => {
  it("converts PKR to paisa", () => {
    expect(toPaisa(250)).toBe("25000");
    expect(toPaisa(3000.5)).toBe("300050");
  });

  it("generates txn ref", () => {
    const ref = generateTxnRefNo("Z");
    expect(ref.startsWith("Z")).toBe(true);
    expect(ref.length).toBeLessThanOrEqual(20);
  });

  it("verifies secure hash round-trip", () => {
    const salt = "TESTSALT";
    const fields = {
      pp_Amount: "25000",
      pp_MerchantID: "MC123",
      pp_TxnRefNo: "T123",
    };
    const hash = generateSecureHash(fields, salt);
    expect(verifySecureHash({ ...fields, pp_SecureHash: hash }, salt)).toBe(true);
    expect(verifySecureHash({ ...fields, pp_SecureHash: "BAD" }, salt)).toBe(false);
  });
});

describe("utils", () => {
  it("generates order numbers", () => {
    const n = generateOrderNumber(123, new Date("2026-08-20"));
    expect(n).toBe("ORD-20260820-000123");
  });

  it("calculates discount percent", () => {
    expect(discountPercent(1000, 800)).toBe(20);
    expect(discountPercent(1000, null)).toBe(0);
  });

  it("slugifies names", () => {
    expect(slugify("Organic Honey!")).toBe("organic-honey");
  });
});
