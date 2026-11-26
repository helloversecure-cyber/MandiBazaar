/** W12: pure helpers behind the customer's send-list, offers and rider-bid screens. */
import { describe, expect, it } from "vitest";
import {
  acceptOfferErrorMessage,
  acceptRiderErrorMessage,
  emptyLine,
  formatCountdown,
  formatQty,
  isBlankLine,
  linesFromCart,
  linesFromList,
  listStatusInfo,
  mapServerFieldError,
  newIdempotencyKey,
  validateDraft,
  vehicleLabel,
  type DraftLine,
} from "@/lib/lists/ui";

const line = (over: Partial<DraftLine> = {}): DraftLine => ({ ...emptyLine(), ...over });

describe("validateDraft (same rules as POST /api/lists)", () => {
  it("builds the payload, trims names and keeps decimals", () => {
    const v = validateDraft([line({ name: "  Desi   ghee ", quantity: "1.5", unit: "kg" }), line({ name: "Eggs", quantity: "12", unit: "pcs", note: "Brown" })]);
    expect(v.formError).toBeNull();
    expect(v.errors).toEqual({});
    expect(v.payload).toEqual([
      { name: "Desi ghee", quantity: 1.5, unit: "kg", categoryId: null, productId: null, note: null },
      { name: "Eggs", quantity: 12, unit: "pcs", categoryId: null, productId: null, note: "Brown" },
    ]);
  });

  it("accepts a comma as the decimal mark", () => {
    expect(validateDraft([line({ name: "Rice", quantity: "2,5" })]).payload[0].quantity).toBe(2.5);
  });

  it("ignores fully blank lines but needs at least one item (B-02)", () => {
    expect(validateDraft([line({ name: "" }), line({ name: " " })]).formError).toBe("Add at least one item");
    const v = validateDraft([line({ name: "Milk" }), line({ name: "" })]);
    expect(v.payload).toHaveLength(1);
  });

  it("reports errors per line and field (B-04)", () => {
    const a = line({ name: "Atta", quantity: "0" });
    const b = line({ name: "Milk", quantity: "" });
    const c = line({ name: "Sugar", quantity: "1", unit: "  " });
    const d = line({ name: "", note: "for the blank name" });
    const v = validateDraft([a, b, c, d]);
    expect(v.errors[a.key]).toEqual({ quantity: "Quantity must be more than 0" });
    expect(v.errors[b.key]).toEqual({ quantity: "Enter a quantity" });
    expect(v.errors[c.key]).toEqual({ unit: "Unit is required" });
    expect(v.errors[d.key]).toEqual({ name: "Item name is required" });
    expect(v.payload).toHaveLength(0);
  });

  it("caps the list at 100 lines (B-03)", () => {
    const many = Array.from({ length: 101 }, (_, i) => line({ name: `Item ${i}` }));
    expect(validateDraft(many).formError).toBe("A list can have at most 100 items");
  });

  it("keeps ids of existing lines when editing", () => {
    const lines = linesFromList([{ id: "ln1", name: "Atta", quantity: 2.5, unit: "kg", categoryId: "c1", productId: null, note: null }]);
    expect(validateDraft(lines).payload).toEqual([{ id: "ln1", name: "Atta", quantity: 2.5, unit: "kg", categoryId: "c1", productId: null, note: null }]);
  });
});

describe("cart → list (B-06)", () => {
  it("catalogue lines keep their productId and variant", () => {
    const lines = linesFromCart([
      { productId: "p1", name: "Atta 10kg", quantity: 2, unit: "bag" },
      { productId: "p2", name: "Milk", variantName: "1L", quantity: 1, unit: "pack" },
    ]);
    expect(lines.map((l) => [l.name, l.quantity, l.unit, l.productId])).toEqual([
      ["Atta 10kg", "2", "bag", "p1"],
      ["Milk (1L)", "1", "pack", "p2"],
    ]);
    expect(isBlankLine({ ...lines[0], name: "" })).toBe(false); // has a product
    expect(validateDraft(lines).payload.map((p) => p.productId)).toEqual(["p1", "p2"]);
  });
});

describe("mapServerFieldError", () => {
  it("maps lines.N.field onto the Nth line that was sent (blank lines skipped)", () => {
    const a = line({ name: "A" });
    const blank = line({ name: "" });
    const b = line({ name: "B" });
    expect(mapServerFieldError([a, blank, b], "lines.1.quantity", "Quantity is too large")).toEqual({ lineKey: b.key, field: "quantity" });
    expect(mapServerFieldError([a], "addressId", "x")).toBeNull();
    expect(mapServerFieldError([a], "lines.5.name", "x")).toBeNull();
  });
});

describe("accept offer errors → messages", () => {
  const codes = [
    "ORDER_PLACED",
    "LIST_CLOSED",
    "LIST_CHANGED",
    "OFFER_NOT_FOUND",
    "OFFER_UNAVAILABLE",
    "OFFER_OUTDATED",
    "OFFER_CHANGED",
    "STORE_UNAVAILABLE",
    "MIN_ORDER",
    "ADDRESS_NOT_FOUND",
    "FEATURE_OFF",
    "NOT_FOUND",
  ];
  it("every code from accept.ts has its own clear message", () => {
    const msgs = codes.map((code) => acceptOfferErrorMessage({ status: 409, code, error: "raw" }).message);
    expect(new Set(msgs).size).toBe(codes.length - 1); // OFFER_NOT_FOUND and OFFER_UNAVAILABLE share one
    // MIN_ORDER shows the server's amount text on purpose (next test); the rest are our own words.
    msgs.forEach((m, i) => codes[i] !== "MIN_ORDER" && expect(m).not.toBe("raw"));
  });

  it("refreshes offers when they went stale and uses a new key", () => {
    for (const code of ["LIST_CHANGED", "OFFER_CHANGED", "OFFER_OUTDATED", "ORDER_PLACED", "LIST_CLOSED"]) {
      expect(acceptOfferErrorMessage({ status: 409, code })).toMatchObject({ reload: true, keepKey: false });
    }
  });

  it("minimum order shows the server's amount message", () => {
    expect(acceptOfferErrorMessage({ status: 400, code: "MIN_ORDER", error: "Minimum order is Rs 500" }).message).toBe(
      "Minimum order is Rs 500"
    );
  });

  it("network, server and rate-limit errors keep the same request key for a safe retry", () => {
    expect(acceptOfferErrorMessage(null)).toMatchObject({ keepKey: true, reload: false });
    expect(acceptOfferErrorMessage({ status: 500 })).toMatchObject({ keepKey: true });
    expect(acceptOfferErrorMessage({ status: 429 }).message).toMatch(/wait a minute/);
    expect(acceptOfferErrorMessage({ status: 401 }).message).toMatch(/sign in/);
  });

  it("unknown 400s fall back to the server text", () => {
    expect(acceptOfferErrorMessage({ status: 400, error: "Missing request key" }).message).toBe("Missing request key");
  });
});

describe("accept rider errors → messages", () => {
  it("covers the post-pack bidding codes", () => {
    for (const code of ["ALREADY_ASSIGNED", "BID_NOT_FOUND", "BID_UNAVAILABLE", "BID_CHANGED", "RIDER_GONE", "CLOSED", "NOT_READY", "ORDER_CHANGED"]) {
      const f = acceptRiderErrorMessage({ status: 409, code, error: "raw" });
      expect(f.message).not.toBe("raw");
      expect(f.reload).toBe(true);
    }
    expect(acceptRiderErrorMessage(null).keepKey).toBe(true);
    expect(acceptRiderErrorMessage({ status: 404, code: "NOT_FOUND" }).reload).toBe(false);
  });
});

describe("small formatters", () => {
  it("countdown", () => {
    expect(formatCountdown(0)).toBe("Ended");
    expect(formatCountdown(-5)).toBe("Ended");
    expect(formatCountdown(65_000)).toBe("1m 05s left");
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000)).toBe("2h 05m left");
    expect(formatCountdown(26 * 3600_000)).toBe("1d 2h left");
  });

  it("status labels", () => {
    expect(listStatusInfo("BIDDING").label).toBe("Waiting for offers");
    expect(listStatusInfo("ACCEPTED").tone).toBe("success");
    expect(listStatusInfo("NO_STORES").label).toBe("No stores nearby");
    expect(listStatusInfo("SOMETHING_NEW").label).toBe("something new");
  });

  it("quantities, vehicles and request keys", () => {
    expect(formatQty(2)).toBe("2");
    expect(formatQty(1.2345)).toBe("1.235");
    expect(vehicleLabel("MOTORCYCLE")).toBe("Motorcycle");
    expect(vehicleLabel(null)).toBe("Vehicle not given");
    const k = newIdempotencyKey("list");
    expect(k.startsWith("list-")).toBe(true);
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
