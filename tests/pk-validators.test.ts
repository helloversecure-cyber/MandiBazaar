import { describe, expect, it } from "vitest";
import {
  normalizePkMobile, normalizePkPhone, normalizeCnic, normalizePkIban, normalizeBankAccount,
  normalizeEmail, isSafeMapsUrl, zPersonName, zPassword, zRupees, zQuantity, zCouponCode,
  zCategoryName, zLatitude, zLongitude, zSafeLink, zOrderNumber, zMobile, optional, zodFieldErrors,
} from "@/lib/validators/pk";
import { z } from "zod";
import { pageWindow } from "@/components/ui/Pagination";
import { parsePagination } from "@/lib/utils";

const ok = (s: z.ZodTypeAny, v: unknown) => s.safeParse(v).success;

describe("S0 rules from the QA report", () => {
  it("mobile", () => {
    expect(normalizePkMobile("03001234567")).toBe("03001234567");
    expect(normalizePkMobile("+923001234567")).toBe("03001234567");
    expect(normalizePkMobile("0092 300-1234567")).toBe("03001234567");
    expect(normalizePkMobile("0300-1234567")).toBe("03001234567");
    for (const bad of ["abc", "123", "13001234567", "283752893750238947", "abcdefg", ""])
      expect(normalizePkMobile(bad)).toBeNull();
  });
  it("landline / UAN", () => {
    expect(normalizePkPhone("042-35761234")).toBe("04235761234");
    expect(normalizePkPhone("111-626-334")).toBe("111626334");
    expect(normalizePkPhone("xyz")).toBeNull();
    expect(normalizePkPhone("123")).toBeNull();
  });
  it("email", () => {
    expect(normalizeEmail("Ali@Gmail.com")).toBe("ali@gmail.com");
    for (const bad of ["abc", "test@abc", "test@@gmail.com", "testgmail.com", "test@hsdjklfhsdlh", "a".repeat(95) + "@x.com"])
      expect(normalizeEmail(bad)).toBeNull();
  });
  it("CNIC", () => {
    expect(normalizeCnic("35202-1234567-1")).toBe("35202-1234567-1");
    expect(normalizeCnic("3520212345671")).toBe("35202-1234567-1");
    for (const bad of ["abc", "123", "872164872xb129874", "85202-1234567-1"]) expect(normalizeCnic(bad)).toBeNull();
  });
  it("IBAN / bank account", () => {
    expect(normalizePkIban("pk36 scbl 0000 0011 2345 6702")).toBe("PK36SCBL0000001123456702");
    expect(normalizePkIban("12")).toBeNull();
    expect(normalizeBankAccount("0012345678901")).toBe("0012345678901");
    expect(normalizeBankAccount("abc")).toBeNull();
    expect(normalizeBankAccount("12")).toBeNull();
  });
  it("names", () => {
    expect(ok(zPersonName, "Muhammad Ali")).toBe(true);
    expect(ok(zPersonName, "محمد علی")).toBe(true);
    for (const bad of ["12345", "   ", "a".repeat(61), "<b>Test</b> @#$%", "1234567890"]) expect(ok(zPersonName, bad)).toBe(false);
  });
  it("password", () => {
    expect(ok(zPassword, "Mandi2026")).toBe(true);
    for (const bad of ["1234567", "        ", "abcdefgh", "12345678", "a1".repeat(40)]) expect(ok(zPassword, bad)).toBe(false);
  });
  it("money / stock", () => {
    const price = zRupees({ min: 1, max: 1_000_000 });
    expect(ok(price, 400)).toBe(true);
    expect(ok(price, "400")).toBe(true);
    for (const bad of [-50, 0, 99_999_999_999, 1.5, "abc"]) expect(ok(price, bad)).toBe(false);
    const stock = zQuantity();
    expect(ok(stock, 30)).toBe(true);
    for (const bad of [1.5, -99999, 100_001]) expect(ok(stock, bad)).toBe(false);
  });
  it("coupon code / category", () => {
    expect(zCouponCode.parse("save10")).toBe("SAVE10");
    for (const bad of ["a", "a b!", "   ", "X".repeat(21)]) expect(ok(zCouponCode, bad)).toBe(false);
    expect(ok(zCategoryName, "Daal & Pulses")).toBe(true);
    for (const bad of ["a", "   ", "x".repeat(41), "<script>x</script>"]) expect(ok(zCategoryName, bad)).toBe(false);
  });
  it("location / links / order number", () => {
    expect(ok(zLatitude, 31.5204)).toBe(true);
    expect(ok(zLatitude, "hello")).toBe(false);
    expect(ok(zLongitude, 999)).toBe(false);
    expect(isSafeMapsUrl("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isSafeMapsUrl("not a link")).toBe(false);
    expect(ok(zSafeLink, "/products")).toBe(true);
    expect(ok(zSafeLink, "javascript:alert(1)")).toBe(false);
    expect(ok(zOrderNumber, "ORD-20261031-000001")).toBe(true);
    expect(ok(zOrderNumber, "MB-20260913-0001")).toBe(false);
  });
  it("optional + field errors", () => {
    const s = z.object({ phone: zMobile, email: optional(z.string().email()) });
    const r = s.safeParse({ phone: "abc", email: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodFieldErrors(r.error)).toEqual({ phone: "Enter a valid mobile number, e.g. 03001234567" });
  });
});

describe("pagination helpers", () => {
  it("pageWindow", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(6, 20)).toEqual([1, "…", 5, 6, 7, "…", 20]);
  });
  it("parsePagination handles junk", () => {
    expect(parsePagination(new URLSearchParams("page=abc&limit=xyz"))).toMatchObject({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination(new URLSearchParams("page=3&limit=500"), { maxLimit: 50 })).toMatchObject({ page: 3, limit: 50, skip: 100 });
  });
});
