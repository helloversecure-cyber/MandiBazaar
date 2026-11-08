import { describe, it, expect } from "vitest";
import {
  customerEventFor,
  customerEventMessage,
  customerExtraType,
  extraChannels,
  notifyStoresFor,
  storeNewOrderMessage,
  storeRecipientIds,
} from "@/lib/notifications/order-events";

describe("order event → customer SMS/email", () => {
  it("allow-list of key events", () => {
    expect(customerEventFor("ORDER_CONFIRMED", "CONFIRMED")).toBe("CONFIRMED");
    expect(customerEventFor("ORDER_CANCELLED", "CANCELLED")).toBe("CANCELLED");
    expect(customerEventFor("ORDER_STATUS", "OUT_FOR_DELIVERY")).toBe("OUT_FOR_DELIVERY");
    expect(customerEventFor("ORDER_STATUS", "DELIVERED")).toBe("DELIVERED");
    expect(customerEventFor("ORDER_STATUS", "CANCELLED")).toBe("CANCELLED");
    expect(customerEventFor("REFUND_UPDATE", "CANCELLED", "COMPLETED")).toBe("REFUNDED");
  });

  it("everything else stays in-app only", () => {
    expect(customerEventFor("ORDER_STATUS", "PACKED")).toBeNull();
    expect(customerEventFor("ORDER_STATUS", "ASSIGNED_TO_RIDER")).toBeNull();
    expect(customerEventFor("REFUND_UPDATE", "CANCELLED", "PENDING")).toBeNull();
    expect(customerEventFor("REFUND_UPDATE", "CANCELLED", null)).toBeNull();
    expect(customerEventFor("PAYMENT_SUCCESS", "CONFIRMED")).toBeNull();
    expect(customerEventFor("PAYMENT_PROOF_SUBMITTED", "PENDING_PAYMENT")).toBeNull();
    expect(customerEventFor("ORDER_READY", "READY_FOR_DISPATCH")).toBeNull();
  });

  it("channels only when the provider is configured and the contact exists", () => {
    expect(extraChannels({ smsOn: false, emailOn: false, phone: "03001234567", email: "a@b.com" })).toEqual([]);
    expect(extraChannels({ smsOn: true, emailOn: false, phone: "03001234567", email: "a@b.com" })).toEqual(["SMS"]);
    expect(extraChannels({ smsOn: true, emailOn: true, phone: null, email: "a@b.com" })).toEqual(["EMAIL"]);
    expect(extraChannels({ smsOn: true, emailOn: true, phone: "03001234567", email: null })).toEqual(["SMS"]);
    expect(extraChannels({ smsOn: true, emailOn: true, phone: "03001234567", email: "a@b.com" })).toEqual(["SMS", "EMAIL"]);
  });

  it("messages carry the order number; de-dup type per event", () => {
    for (const ev of ["CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED"] as const) {
      expect(customerEventMessage(ev, "ORD-123").body).toContain("ORD-123");
      expect(customerEventMessage(ev, "ORD-123").body.length).toBeLessThan(160);
    }
    expect(customerExtraType("DELIVERED")).toBe("CUSTOMER_ORDER_DELIVERED");
  });
});

describe("stores are told about confirmed orders", () => {
  it("only on ORDER_CONFIRMED", () => {
    expect(notifyStoresFor("ORDER_CONFIRMED")).toBe(true);
    expect(notifyStoresFor("PAYMENT_SUCCESS")).toBe(false);
    expect(notifyStoresFor("ORDER_STATUS")).toBe(false);
  });

  it("owner + active members, no duplicates", () => {
    expect(
      storeRecipientIds({
        ownerId: "o",
        members: [
          { userId: "o", isActive: true },
          { userId: "m1", isActive: true },
          { userId: "m2", isActive: false },
        ],
      })
    ).toEqual(["o", "m1"]);
  });

  it("message", () => {
    expect(storeNewOrderMessage("ORD-9", 3).body).toBe("New order ORD-9 — 3 items to prepare. Open your store portal.");
    expect(storeNewOrderMessage("ORD-9", 1).body).toBe("New order ORD-9 — 1 item to prepare. Open your store portal.");
  });
});
