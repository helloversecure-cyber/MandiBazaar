import { describe, expect, it } from "vitest";
import {
  parseIdentifier,
  phoneDigitVariants,
  phoneLiteralVariants,
  safeCallbackUrl,
} from "@/lib/auth/identifier";
import { addressSchema, registerSchema } from "@/lib/validators/schemas";
import {
  LOCATION_REQUIRED_MSG,
  PAYOUT_REQUIRED_MSG,
  RIDER_PAYOUT_REQUIRED_MSG,
  missingStoreDocErrors,
  validateRiderSignup,
  validateStoreProfile,
  validateStoreSignup,
} from "@/lib/validators/signup-forms";
import { zodFieldErrors } from "@/lib/validators/pk";

describe("identifier helpers", () => {
  it("classifies identifiers", () => {
    expect(parseIdentifier("+92 300-1234567")).toMatchObject({ kind: "phone", normalized: "03001234567" });
    expect(parseIdentifier(" Ali@Gmail.com ")).toMatchObject({ kind: "email", normalized: "ali@gmail.com" });
    expect(parseIdentifier("abc").kind).toBe("invalid");
    expect(parseIdentifier("123").kind).toBe("invalid");
    expect(parseIdentifier("test@abc").kind).toBe("invalid");
    expect(parseIdentifier("a".repeat(300) + "@gmail.com").kind).toBe("invalid");
  });

  it("phone variants cover legacy formats", () => {
    expect(phoneDigitVariants("03001234567")).toEqual(["03001234567", "923001234567", "00923001234567", "3001234567"]);
    const lit = phoneLiteralVariants("03001234567");
    expect(lit).toContain("0300-1234567");
    expect(lit).toContain("+923001234567");
  });

  it("safeCallbackUrl only allows internal paths", () => {
    expect(safeCallbackUrl("/account/orders")).toBe("/account/orders");
    expect(safeCallbackUrl("/admin/orders?status=PENDING")).toBe("/admin/orders?status=PENDING");
    expect(safeCallbackUrl("//evil.com")).toBe("/");
    expect(safeCallbackUrl("/\\evil.com")).toBe("/");
    expect(safeCallbackUrl("https://evil.com")).toBe("/");
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/");
    expect(safeCallbackUrl("/login?portal=admin", "/admin")).toBe("/admin");
    expect(safeCallbackUrl(undefined, "/x")).toBe("/x");
  });
});

describe("registerSchema (L1)", () => {
  const ok = { fullName: "Muhammad Ali", phone: "+923001234567", email: "Ali@Gmail.com", password: "Mandi2026" };

  it("normalises phone and email", () => {
    const r = registerSchema.parse(ok);
    expect(r.phone).toBe("03001234567");
    expect(r.email).toBe("ali@gmail.com");
  });

  it("email is required", () => {
    expect(registerSchema.safeParse({ ...ok, email: "" }).success).toBe(false);
  });

  it.each([
    ["fullName", "a".repeat(300)],
    ["fullName", "1234567890"],
    ["fullName", "   "],
    ["fullName", "<b>Test</b> @#$%"],
    ["phone", "abcdefg"],
    ["phone", "123"],
    ["phone", "283752893750238947"],
    ["email", "test@hsdjklfhsdlh"],
    ["email", "a".repeat(300) + "@gmail.com"],
    ["password", "        "],
    ["password", "1234567"],
    ["password", "a1".repeat(250)],
  ])("rejects %s = %s", (field, value) => {
    const r = registerSchema.safeParse({ ...ok, [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error))).toContain(field);
  });
});

describe("addressSchema (M2)", () => {
  const ok = {
    label: "Home",
    fullName: "Ali Khan",
    phone: "0300-1234567",
    houseBuilding: "House 12",
    area: "Gulberg III",
    city: "Lahore",
    province: "Punjab",
  };
  it("accepts a valid address and keeps the output shape", () => {
    const r = addressSchema.parse({ ...ok, latitude: null, longitude: null, postalCode: "" });
    expect(r.phone).toBe("03001234567");
    expect(r.latitude).toBeUndefined();
    expect(r.postalCode).toBeUndefined();
    expect(addressSchema.parse({ ...ok, label: "" }).label).toBe("Home");
  });
  it("gives field-level errors", () => {
    const r = addressSchema.safeParse({
      ...ok,
      phone: "abc",
      houseBuilding: "1",
      city: "12345",
      postalCode: "123",
      latitude: "hello",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = zodFieldErrors(r.error);
      expect(Object.keys(fe).sort()).toEqual(["city", "houseBuilding", "latitude", "phone", "postalCode"]);
    }
  });
});

const store = {
  name: "Ali Fresh Mart",
  addressLine: "Shop 4, Main Boulevard",
  city: "Lahore",
  province: "Punjab",
  cnicNumber: "3520212345671",
  requestedCategories: ["Vegetables"],
  jazzCashNumber: "03001234567",
  latitude: 31.52,
  longitude: 74.35,
};

describe("store signup (L3)", () => {
  it("accepts a valid application and normalises values", () => {
    const r = validateStoreSignup(store, { server: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cnicNumber).toBe("35202-1234567-1");
      expect(r.data.latitude).toBe(31.52);
    }
  });

  it("shows payout + location + format errors together", () => {
    const r = validateStoreSignup(
      {
        ...store,
        jazzCashNumber: "",
        latitude: "",
        longitude: "",
        phone: "xyz",
        email: "testgmail.com",
        cnicNumber: "abc",
        city: "12345",
        requestedCategories: [],
      },
      { server: true }
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.bankAccountNumber).toBe(PAYOUT_REQUIRED_MSG);
      expect(r.errors.latitude).toBe(LOCATION_REQUIRED_MSG);
      for (const k of ["phone", "email", "cnicNumber", "city", "requestedCategories"]) {
        expect(r.errors[k]).toBeTruthy();
      }
    }
  });

  it("client accepts a Maps link instead of lat/lng; server needs the pin", () => {
    const v = { ...store, latitude: "", longitude: "", googleMapsUrl: "https://maps.app.goo.gl/abc" };
    expect(validateStoreSignup(v, { server: false }).success).toBe(true);
    expect(validateStoreSignup(v, { server: true }).success).toBe(false);
  });

  it("rejects bad IBAN / account / maps link / coordinates", () => {
    const r = validateStoreSignup(
      { ...store, bankIban: "12", bankAccountNumber: "abc", googleMapsUrl: "not a link", latitude: "hello" },
      { server: false }
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      for (const k of ["bankIban", "bankAccountNumber", "googleMapsUrl", "latitude", "bankAccountTitle"]) {
        expect(r.errors[k]).toBeTruthy();
      }
    }
  });

  it("missing documents (L4): address proof optional only for virtual stores", () => {
    expect(Object.keys(missingStoreDocErrors({}, false))).toHaveLength(4);
    expect(Object.keys(missingStoreDocErrors({}, true))).toEqual(["cnicFront", "cnicBack", "shopImage"]);
    expect(missingStoreDocErrors({ cnicFront: "/uploads/a.jpg" }, false).cnicFront).toBeUndefined();
  });
});

describe("store profile (S10)", () => {
  it("blocks saving without a payout method", () => {
    const { cnicNumber: _c, requestedCategories: _r, ...profile } = store;
    void _c;
    void _r;
    expect(validateStoreProfile(profile, { server: true }).success).toBe(true);
    const r = validateStoreProfile({ ...profile, jazzCashNumber: null }, { server: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.bankAccountNumber).toBe(PAYOUT_REQUIRED_MSG);
  });
});

describe("rider signup (S3)", () => {
  const docs = {
    photoUrl: "/uploads/riders/a.jpg",
    cnicUrl: "/uploads/riders/b.jpg",
    cnicBackUrl: "/uploads/riders/c.jpg",
    licenseUrl: "/uploads/riders/d.jpg",
    bikeUrl: "/uploads/riders/e.jpg",
    bikeCardUrl: "/uploads/riders/f.jpg",
  };
  const rider = {
    fullName: "Bilal Ahmed",
    phone: "03001234567",
    email: "bilal@gmail.com",
    password: "Rider2026",
    city: "Lahore",
    vehicleType: "Bike",
    cnicNumber: "35202-1234567-1",
    accountNumber: "PK36 SCBL 0000 0011 2345 6702",
    ...docs,
  };
  it("accepts IBAN or account number in the account field", () => {
    const r = validateRiderSignup(rider);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.accountNumber).toBe("PK36SCBL0000001123456702");
    expect(validateRiderSignup({ ...rider, accountNumber: "0012345678901" }).success).toBe(true);
  });
  it("rejects bad values with field errors", () => {
    const r = validateRiderSignup({
      ...rider,
      city: "12345",
      vehicleType: "Aeroplane",
      cnicNumber: "872164872xb129874",
      accountNumber: "",
      jazzCashNumber: "",
      bikeCardUrl: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.accountNumber).toBe(RIDER_PAYOUT_REQUIRED_MSG);
      for (const k of ["city", "vehicleType", "cnicNumber", "bikeCardUrl"]) expect(r.errors[k]).toBeTruthy();
    }
  });
});
