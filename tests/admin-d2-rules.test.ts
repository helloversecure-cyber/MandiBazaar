import { describe, expect, it } from "vitest";
import {
  storeApprovalErrorMessage,
  storeApprovalGaps,
  storeApprovalMissingText,
} from "@/lib/catalog/store-approval";
import {
  categoryActivationError,
  categoryNameKey,
  findDuplicateCategory,
} from "@/lib/catalog/category-rules";
import { categorySchema } from "@/lib/validators/schemas";
import {
  phoneLookupVariants,
  riderApprovalProblems,
  riderQuickAddSchema,
  settingsChanges,
  settingsSchema,
  staffCreateSchema,
  stockAdjustLimitError,
  stockAdjustSchema,
  isInvalidCustomerPhone,
} from "@/lib/admin/form-rules";
import { buildApprovedChangesUpdate, describePendingChanges } from "@/lib/catalog/product-changes";

describe("store approval guard (N7 / P4)", () => {
  it("blocks a store with no payout and no location", () => {
    const gaps = storeApprovalGaps({});
    expect(gaps).toEqual(["payout", "location"]);
    expect(storeApprovalMissingText(gaps)).toBe("Missing: payout details, map location");
    expect(storeApprovalErrorMessage(gaps)).toContain("payout details");
  });
  it("accepts bank account OR IBAN OR JazzCash", () => {
    const loc = { latitude: 31.52, longitude: 74.35 };
    expect(storeApprovalGaps({ ...loc, bankAccountNumber: "0012345678901" })).toEqual([]);
    expect(storeApprovalGaps({ ...loc, bankIban: "pk36 scbl 0000 0011 2345 6702" })).toEqual([]);
    expect(storeApprovalGaps({ ...loc, jazzCashNumber: "+92 300 1234567" })).toEqual([]);
  });
  it("rejects junk payout numbers and out-of-Pakistan coordinates", () => {
    expect(storeApprovalGaps({ bankAccountNumber: "12", latitude: 31.5, longitude: 74.3 })).toEqual(["payout"]);
    expect(storeApprovalGaps({ jazzCashNumber: "03001234567", latitude: 0, longitude: 0 })).toEqual(["location"]);
    expect(storeApprovalGaps({ jazzCashNumber: "03001234567", latitude: 31.5, longitude: null })).toEqual(["location"]);
  });
});

describe("category rules (P11 / S13)", () => {
  const list = [
    { id: "1", name: "Daal", slug: "daal" },
    { id: "2", name: "Daal & Pulses", slug: "daal-pulses" },
  ];
  it("normalises case and spaces", () => {
    expect(categoryNameKey("  DAAL   &  pulses ")).toBe("daal & pulses");
  });
  it("finds duplicates ignoring case, and by slug", () => {
    expect(findDuplicateCategory("daal", list)?.id).toBe("1");
    expect(findDuplicateCategory(" DAAL ", list)?.id).toBe("1");
    expect(findDuplicateCategory("Daal Pulses", list)?.id).toBe("2");
    expect(findDuplicateCategory("Rice", list)).toBeNull();
  });
  it("ignores the category being edited", () => {
    expect(findDuplicateCategory("Daal", list, "1")).toBeNull();
  });
  it("needs an image to be active", () => {
    expect(categoryActivationError({ isActive: true, imageUrl: "" })).toBeTruthy();
    expect(categoryActivationError({ isActive: false, imageUrl: "" })).toBeNull();
    expect(categorySchema.safeParse({ name: "Rice", isActive: true }).success).toBe(false);
    expect(categorySchema.safeParse({ name: "Rice", isActive: false }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "Rice", isActive: true, imageUrl: "/uploads/r.jpg" }).success).toBe(true);
  });
  it.each(["a", "   ", "<script>x</script>", "x".repeat(41), "12345"])("rejects name %s", (name) => {
    expect(categorySchema.safeParse({ name, isActive: false }).success).toBe(false);
  });
});

describe("settings validation (S14 / U5)", () => {
  const valid = {
    businessName: "MandiBazaar",
    phone: "042-35761234",
    email: "Help@MandiBazaar.pk",
    address: "",
    defaultDeliveryFee: "100",
    deliveryRatePerKm: "10",
    maxDeliveryFee: "",
    freeDeliveryThreshold: "5000",
    minimumOrderAmount: "300",
    platformCommissionPct: "10",
  };
  it("accepts good values and normalises", () => {
    const r = settingsSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("help@mandibazaar.pk");
      expect(r.data.phone).toBe("04235761234");
      expect(r.data.maxDeliveryFee).toBeUndefined();
      expect(r.data.defaultDeliveryFee).toBe(100);
    }
  });
  it.each([
    ["businessName", ""],
    ["phone", "abc"],
    ["phone", "042-111-MANDI"],
    ["email", "not-an-email"],
    ["defaultDeliveryFee", "-100"],
    ["defaultDeliveryFee", "5001"],
    ["defaultDeliveryFee", ""],
    ["deliveryRatePerKm", "501"],
    ["freeDeliveryThreshold", "abc"],
    ["minimumOrderAmount", "-50"],
    ["minimumOrderAmount", "10.5"],
    ["platformCommissionPct", "51"],
  ])("rejects %s = %s", (field, value) => {
    const r = settingsSchema.safeParse({ ...valid, [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe(field);
  });
  it("max delivery fee must be ≥ default fee", () => {
    const r = settingsSchema.safeParse({ ...valid, maxDeliveryFee: "50" });
    expect(r.success).toBe(false);
  });
  it("lists old → new changes", () => {
    const changes = settingsChanges(
      { defaultDeliveryFee: 100, minimumOrderAmount: 300 },
      { defaultDeliveryFee: 150, minimumOrderAmount: 300 },
      ["defaultDeliveryFee", "minimumOrderAmount"]
    );
    expect(changes).toEqual([{ field: "defaultDeliveryFee", label: "Default delivery fee", from: 100, to: 150 }]);
  });
});

describe("quick-add rider / staff (P5 / S11)", () => {
  const rider = {
    name: "Muhammad Ali",
    phone: "+92 300 1234567",
    email: "",
    password: "",
    cnicNumber: "3520212345671",
    city: "Lahore",
    vehicleType: "Bike",
    accountNumber: "",
    jazzCashNumber: "",
  };
  it("accepts a valid rider and normalises", () => {
    const r = riderQuickAddSchema.safeParse(rider);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBe("03001234567");
      expect(r.data.cnicNumber).toBe("35202-1234567-1");
      expect(r.data.password).toBeUndefined();
    }
  });
  it.each([
    ["name", "12345"],
    ["phone", "abc"],
    ["email", "not-an-email"],
    ["cnicNumber", "872164872xb129874"],
    ["city", "Atlantis"],
    ["vehicleType", "Aeroplane"],
    ["password", "a"],
    ["password", "Rider@12345"],
    ["accountNumber", "12"],
  ])("rejects %s = %s", (field, value) => {
    const r = riderQuickAddSchema.safeParse({ ...rider, [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe(field);
  });
  it("staff rules", () => {
    expect(staffCreateSchema.safeParse({ fullName: "   ", phone: "03001234567", role: "ADMIN" }).success).toBe(false);
    expect(staffCreateSchema.safeParse({ fullName: "Ayesha", phone: "123", role: "ADMIN" }).success).toBe(false);
    expect(staffCreateSchema.safeParse({ fullName: "Ayesha", phone: "03001234567", email: "test@abc", role: "ADMIN" }).success).toBe(false);
    expect(staffCreateSchema.safeParse({ fullName: "Ayesha", phone: "03001234567", role: "SUPER_ADMIN" }).success).toBe(false);
    expect(staffCreateSchema.safeParse({ fullName: "Ayesha", phone: "03001234567", role: "ADMIN" }).success).toBe(true);
  });
  it("phone lookup covers legacy formats", () => {
    const v = phoneLookupVariants("03001234567");
    expect(v).toEqual(expect.arrayContaining(["03001234567", "+923001234567", "0300-1234567", "923001234567"]));
  });
  it("rider approval needs a valid CNIC, documents and payout", () => {
    const docs = {
      photoUrl: "/a", cnicUrl: "/b", cnicBackUrl: "/c", licenseUrl: "/d", bikeUrl: "/e", bikeCardUrl: "/f",
    };
    expect(riderApprovalProblems({ ...docs, cnicNumber: "35202-1234567-1", accountNumber: "0012345678901" })).toEqual([]);
    const bad = riderApprovalProblems({ cnicNumber: "872164872xb129874", accountNumber: "made up" });
    expect(bad.length).toBe(3);
    expect(riderApprovalProblems({ photoUrl: "/a", cnicUrl: "/b", cnicBackUrl: "/c", vehicleType: "Bicycle", cnicNumber: "35202-1234567-1", jazzCashNumber: "03001234567" })).toEqual([]);
  });
});

describe("stock adjustment (S15)", () => {
  it.each(["0", "1.5", "", "abc", "100001"])("rejects quantity %s", (quantity) => {
    expect(stockAdjustSchema.safeParse({ quantity, note: "reason" }).success).toBe(false);
  });
  it("needs a reason for reductions only", () => {
    expect(stockAdjustSchema.safeParse({ quantity: "-5", note: "" }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ quantity: "-5", note: "Damaged" }).success).toBe(true);
    expect(stockAdjustSchema.safeParse({ quantity: "10", note: "" }).success).toBe(true);
  });
  it("can't go below reserved", () => {
    expect(stockAdjustLimitError(-8, { stock: 10, reserved: 3 })).toMatch(/reserved/);
    expect(stockAdjustLimitError(-7, { stock: 10, reserved: 3 })).toBeNull();
    expect(stockAdjustLimitError(-99999, { stock: 10, reserved: 0 })).toMatch(/below 0/);
  });
});

describe("pending product changes (N9 admin side)", () => {
  const live = {
    name: "Daal mash",
    categoryId: "c1",
    unit: "1kg",
    price: 300,
    salePrice: null,
    images: [{ url: "/a.jpg", sortOrder: 0 }],
  };
  it("shows only real changes, old → new", () => {
    const rows = describePendingChanges(
      live,
      { price: 600, name: "Daal mash", categoryId: "c2", images: [{ url: "/b.jpg", sortOrder: 0 }] },
      (id) => (id === "c1" ? "Daal" : "Pulses")
    );
    expect(rows.map((r) => r.field)).toEqual(["price", "categoryId", "images"]);
    expect(rows[0]).toMatchObject({ from: 300, to: 600 });
    expect(rows[1]).toMatchObject({ from: "Daal", to: "Pulses" });
  });
  it("builds a safe update", () => {
    const r = buildApprovedChangesUpdate(live, { price: 600, images: [{ url: "/b.jpg", sortOrder: 1 }, { url: "/c.jpg", sortOrder: 0 }] });
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.data.price).toBe(600);
      expect(r.images?.map((i) => i.url)).toEqual(["/c.jpg", "/b.jpg"]);
    }
    expect("error" in buildApprovedChangesUpdate(live, { salePrice: 400 })).toBe(true);
    expect("error" in buildApprovedChangesUpdate(live, { images: [] })).toBe(true);
  });
});

describe("invalid customer phones (P10)", () => {
  it.each(["sadfasdfdsa", "12345678901234", "Ali Khan", null, ""])("flags %s", (p) => {
    expect(isInvalidCustomerPhone(p)).toBe(true);
  });
  it.each(["03001234567", "0300-1234567", "+923001234567"])("accepts %s", (p) => {
    expect(isInvalidCustomerPhone(p)).toBe(false);
  });
});
