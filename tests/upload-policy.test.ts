import { describe, expect, it } from "vitest";
import { canUploadToFolder } from "@/lib/uploads/upload-policy";

describe("upload policy", () => {
  it("allows guest signup folders without a session", () => {
    for (const folder of ["logos", "cnic", "shops", "proofs", "riders"]) {
      expect(canUploadToFolder(folder, null).ok).toBe(true);
    }
  });

  it("requires auth for product, carousel, and category uploads", () => {
    expect(canUploadToFolder("products", null).ok).toBe(false);
    expect(canUploadToFolder("carousel", null).ok).toBe(false);
    expect(canUploadToFolder("categories", null).ok).toBe(false);
    expect(canUploadToFolder("categories", "STORE_OWNER").ok).toBe(false);
    expect(canUploadToFolder("payment-proofs", null).ok).toBe(false);
  });

  it("allows store owners to upload products", () => {
    expect(canUploadToFolder("products", "STORE_OWNER").ok).toBe(true);
    expect(canUploadToFolder("products", "CUSTOMER").ok).toBe(false);
  });

  it("allows riders and customers (JazzCash receipts) to upload payment proofs", () => {
    expect(canUploadToFolder("payment-proofs", "RIDER").ok).toBe(true);
    expect(canUploadToFolder("payment-proofs", "CUSTOMER").ok).toBe(true);
    expect(canUploadToFolder("payment-proofs", "STORE_OWNER").ok).toBe(false);
  });

  it("allows platform admins everywhere", () => {
    expect(canUploadToFolder("carousel", "SUPER_ADMIN").ok).toBe(true);
    expect(canUploadToFolder("categories", "SUPER_ADMIN").ok).toBe(true);
    expect(canUploadToFolder("products", "ADMIN").ok).toBe(true);
    expect(canUploadToFolder("payment-proofs", "ORDER_MANAGER").ok).toBe(true);
  });
});
