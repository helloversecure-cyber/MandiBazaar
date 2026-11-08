import { describe, expect, it } from "vitest";
import {
  checkProduct,
  isLargePriceChange,
  normalizeUnit,
  parseUnit,
  percentOff,
  planProductEdit,
  readPendingChanges,
  stockBelowReservedError,
  storeProductCreateSchema,
  storeProductUpdateSchema,
  type LiveProduct,
} from "@/lib/validators/product-rules";

const valid = {
  name: "Organic Tomato",
  description: "Fresh red tomatoes from Punjab farms",
  price: 250,
  salePrice: null,
  stockQuantity: 30,
  unit: "1 kg",
};

describe("product rules (N3)", () => {
  it("accepts a normal product", () => {
    const r = checkProduct(storeProductCreateSchema, valid);
    expect(r.ok).toBe(true);
  });

  it.each([
    ["price", 0],
    ["price", -50],
    ["price", 99.5],
    ["price", 99_999_999_999],
    ["price", 1_000_001],
    ["stockQuantity", 1.5],
    ["stockQuantity", -1],
    ["stockQuantity", 100_001],
    ["name", "A"],
    ["name", "x".repeat(81)],
    ["name", "12345"],
    ["description", "x".repeat(2001)],
    ["shortDescription", "x".repeat(301)],
    ["unit", "aeroplane"],
    ["unit", ""],
  ])("rejects %s = %s with a field error", (field, value) => {
    const r = checkProduct(storeProductCreateSchema, { ...valid, [field]: value });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors[field]).toBeTruthy();
  });

  it("accepts limits 1 and 1,000,000 / stock 0 and 100,000", () => {
    expect(checkProduct(storeProductCreateSchema, { ...valid, price: 1_000_000, stockQuantity: 100_000 }).ok).toBe(true);
    expect(checkProduct(storeProductCreateSchema, { ...valid, price: 1, stockQuantity: 0 }).ok).toBe(true);
  });

  it("blocks a deal price that is not lower than the price", () => {
    const r = checkProduct(storeProductCreateSchema, { ...valid, price: 100, salePrice: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.salePrice).toMatch(/lower/);
    expect(checkProduct(storeProductCreateSchema, { ...valid, price: 100, salePrice: 100 }).ok).toBe(false);
    expect(checkProduct(storeProductCreateSchema, { ...valid, price: 100, salePrice: 90 }).ok).toBe(true);
  });

  it("update schema only checks sent fields", () => {
    expect(checkProduct(storeProductUpdateSchema, { stockQuantity: 5 }).ok).toBe(true);
    expect(checkProduct(storeProductUpdateSchema, { price: 0 }).ok).toBe(false);
  });

  it("normalises units from the dropdown and legacy text", () => {
    expect(normalizeUnit("1kg")).toBe("1 kg");
    expect(normalizeUnit("1 KG")).toBe("1 kg");
    expect(normalizeUnit("/ 1pc")).toBe("1 pc");
    expect(normalizeUnit("500g")).toBe("500 g");
    expect(normalizeUnit("1 liter")).toBe("1 litre");
    expect(normalizeUnit("6 pcs")).toBe("6 pc");
    expect(normalizeUnit("dozen")).toBe("1 dozen");
    expect(normalizeUnit("loaf")).toBeNull();
    expect(parseUnit("5L")).toEqual({ size: 5, unit: "litre" });
  });

  it("stock can't go below reserved units", () => {
    expect(stockBelowReservedError(1, 2)).toMatch(/reserved/);
    expect(stockBelowReservedError(2, 2)).toBeNull();
  });

  it("percent off (N5)", () => {
    expect(percentOff(200, 150)).toBe(25);
    expect(percentOff(200, 200)).toBe(0);
    expect(percentOff(200, null)).toBe(0);
  });
});

const live: LiveProduct = {
  status: "ACTIVE",
  name: "Daal Channa",
  categoryId: "cat1",
  unit: "1 kg",
  description: "Clean daal channa",
  shortDescription: "Clean daal channa",
  price: 300,
  salePrice: null,
  images: [{ url: "/uploads/products/a.jpg", sortOrder: 0 }],
};

describe("±20% rule and pending changes (N9)", () => {
  it("isLargePriceChange", () => {
    expect(isLargePriceChange(300, 360)).toBe(false); // exactly +20%
    expect(isLargePriceChange(300, 240)).toBe(false); // exactly -20%
    expect(isLargePriceChange(300, 361)).toBe(true);
    expect(isLargePriceChange(300, 239)).toBe(true);
    expect(isLargePriceChange(300, 600)).toBe(true);
    expect(isLargePriceChange(0, 10)).toBe(true);
  });

  it("small price change applies now", () => {
    const plan = planProductEdit(live, { price: 330 }, null);
    expect(plan.immediate).toEqual({ price: 330 });
    expect(plan.pending).toBeNull();
    expect(plan.errors).toBeNull();
  });

  it("price 300 → 600 waits for review, live unchanged", () => {
    const plan = planProductEdit(live, { price: 600 }, null);
    expect(plan.immediate).toEqual({});
    expect(plan.pending).toEqual({ price: 600 });
    expect(plan.newlyPending).toEqual(["price"]);
  });

  it("name / category / unit / description / photos always wait on an approved product", () => {
    const plan = planProductEdit(
      live,
      {
        name: "Oats",
        categoryId: "cat2",
        unit: "500 g",
        description: "Rolled oats",
        images: [{ url: "/uploads/products/b.jpg", sortOrder: 0 }],
      },
      null
    );
    expect(plan.immediate).toEqual({});
    expect(Object.keys(plan.pending || {}).sort()).toEqual(
      ["categoryId", "description", "images", "name", "unit"].sort()
    );
  });

  it("unchanged values (incl. legacy unit spelling) are not changes", () => {
    const plan = planProductEdit({ ...live, unit: "1kg" }, { name: "Daal Channa", unit: "1 kg", price: 300 }, null);
    expect(plan.immediate).toEqual({});
    expect(plan.pending).toBeNull();
  });

  it("DRAFT products apply everything immediately", () => {
    const plan = planProductEdit({ ...live, status: "DRAFT" }, { name: "Daal Mash", price: 900 }, null);
    expect(plan.immediate).toEqual({ name: "Daal Mash", price: 900 });
    expect(plan.pending).toBeNull();
  });

  it("merges with earlier pending changes and drops keys set back to live", () => {
    const plan = planProductEdit(live, { name: "Daal Channa", price: 310 }, { name: "Oats", price: 600 });
    expect(plan.pending).toBeNull();
    expect(plan.immediate).toEqual({ price: 310 });
    const keep = planProductEdit(live, { price: 600 }, { name: "Oats", price: 600 });
    expect(keep.pending).toEqual({ name: "Oats", price: 600 });
    expect(keep.newlyPending).toEqual([]);
  });

  it("deal price: small discount live, big discount reviewed, ending a deal is immediate", () => {
    expect(planProductEdit(live, { salePrice: 270 }, null).immediate).toEqual({ salePrice: 270 });
    expect(planProductEdit(live, { salePrice: 150 }, null).pending).toEqual({ salePrice: 150 });
    const withDeal = { ...live, salePrice: 150 };
    expect(planProductEdit(withDeal, { salePrice: null }, null).immediate).toEqual({ salePrice: null });
  });

  it("deal price must stay below the proposed price", () => {
    const plan = planProductEdit(live, { price: 300, salePrice: 320 }, null);
    expect(plan.errors?.salePrice).toBeTruthy();
    const pendingPrice = planProductEdit(live, { salePrice: 290 }, { price: 280 });
    expect(pendingPrice.errors?.salePrice).toBeTruthy();
  });

  it("never leaves the live listing with deal ≥ price", () => {
    const withDeal = { ...live, salePrice: 260 };
    const plan = planProductEdit(withDeal, { price: 250, salePrice: 240 }, null);
    // live 250/260 would be invalid → both held for review
    expect(plan.errors).toBeNull();
    const liveAfterPrice = plan.immediate.price ?? withDeal.price;
    const liveAfterSale = plan.immediate.salePrice !== undefined ? plan.immediate.salePrice : withDeal.salePrice;
    expect(liveAfterSale == null || liveAfterSale < liveAfterPrice).toBe(true);
  });

  it("readPendingChanges ignores junk", () => {
    expect(readPendingChanges(null)).toBeNull();
    expect(readPendingChanges({ submittedById: "u" })).toBeNull();
    expect(readPendingChanges({ price: 600, submittedById: "u", submittedAt: "x", hack: 1 })).toEqual({
      price: 600,
      submittedById: "u",
      submittedAt: "x",
    });
  });
});
