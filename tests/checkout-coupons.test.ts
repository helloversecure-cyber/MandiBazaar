import { describe, it, expect } from "vitest";
import {
  computeCouponDiscount,
  couponDefinitionProblems,
  couponDefinitionSchema,
  evaluateCoupon,
  type CouponRecord,
} from "@/lib/orders/coupon-rules";
import {
  couponAddressKey,
  gatherCouponCustomerFacts,
  mobileDigitVariants,
  recordCouponUsageInTx,
  releaseCouponUsageForOrder,
  validateCoupon,
} from "@/lib/orders/coupons";
import { validateFields } from "@/lib/validators/pk";

const NOW = new Date("2026-11-07T12:00:00+05:00");

function coupon(over: Partial<CouponRecord> = {}): CouponRecord {
  return {
    id: "c1",
    code: "SAVE10",
    type: "PERCENTAGE",
    value: 10,
    minimumOrderAmount: 1000,
    maximumDiscount: 500,
    startDate: new Date("2026-01-01T00:00:00+05:00"),
    expiryDate: new Date("2027-12-31T23:59:59+05:00"),
    usageLimit: null,
    perUserLimit: 1,
    firstOrderOnly: false,
    usedCount: 0,
    isActive: true,
    ...over,
  };
}
const FRESH = { customerUses: 0, hasPreviousOrder: false };

describe("coupon evaluation — every rejection reason", () => {
  it("invalid code", () => {
    const r = evaluateCoupon(null, 2000, FRESH, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("NOT_FOUND");
      expect(r.rejection.message).toBe("This coupon code is not valid.");
    }
  });
  it("inactive", () => {
    const r = evaluateCoupon(coupon({ isActive: false }), 2000, FRESH, NOW);
    expect(!r.ok && r.rejection.code).toBe("INACTIVE");
  });
  it("not started", () => {
    const r = evaluateCoupon(coupon({ startDate: new Date("2026-12-01T00:00:00+05:00") }), 2000, FRESH, NOW);
    expect(!r.ok && r.rejection.code).toBe("NOT_STARTED");
    expect(!r.ok && r.rejection.message).toContain("1 Dec 2026");
  });
  it("expired", () => {
    const r = evaluateCoupon(coupon({ expiryDate: new Date("2026-11-01T23:59:59+05:00") }), 2000, FRESH, NOW);
    expect(!r.ok && r.rejection.code).toBe("EXPIRED");
  });
  it("usage limit reached", () => {
    const r = evaluateCoupon(coupon({ usageLimit: 100, usedCount: 100 }), 2000, FRESH, NOW);
    expect(!r.ok && r.rejection.code).toBe("USAGE_LIMIT");
    expect(evaluateCoupon(coupon({ usageLimit: 100, usedCount: 99 }), 2000, FRESH, NOW).ok).toBe(true);
  });
  it("guest must sign in", () => {
    const r = evaluateCoupon(coupon(), 2000, null, NOW);
    expect(!r.ok && r.rejection.code).toBe("SIGN_IN");
  });
  it("first order only", () => {
    const c = coupon({ firstOrderOnly: true });
    const r = evaluateCoupon(c, 2000, { customerUses: 0, hasPreviousOrder: true }, NOW);
    expect(!r.ok && r.rejection.code).toBe("FIRST_ORDER_ONLY");
    expect(evaluateCoupon(c, 2000, FRESH, NOW).ok).toBe(true);
  });
  it("already used (per-customer limit)", () => {
    const r = evaluateCoupon(coupon(), 2000, { customerUses: 1, hasPreviousOrder: true }, NOW);
    expect(!r.ok && r.rejection.code).toBe("ALREADY_USED");
    expect(!r.ok && r.rejection.message).toBe("You have already used this coupon.");
    const three = coupon({ perUserLimit: 3 });
    expect(evaluateCoupon(three, 2000, { customerUses: 2, hasPreviousOrder: true }, NOW).ok).toBe(true);
    expect(evaluateCoupon(three, 2000, { customerUses: 3, hasPreviousOrder: true }, NOW).ok).toBe(false);
    expect(evaluateCoupon(coupon({ perUserLimit: null }), 2000, { customerUses: 50, hasPreviousOrder: true }, NOW).ok).toBe(true);
  });
  it("minimum order shows how much more to add (QA T1 wording)", () => {
    const r = evaluateCoupon(coupon(), 665, FRESH, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("MIN_ORDER");
      expect(r.rejection.shortBy).toBe(335);
      expect(r.rejection.message).toBe("Add Rs 335 more to use this coupon (minimum order Rs 1,000).");
    }
    expect(evaluateCoupon(coupon(), 1000, FRESH, NOW).ok).toBe(true);
  });
  it("legacy unsafe coupons are never applied", () => {
    // GFDHTGD: 120 %, no cap
    const r = evaluateCoupon(coupon({ value: 120, maximumDiscount: null }), 1595, FRESH, NOW);
    expect(!r.ok && r.rejection.code).toBe("MISCONFIGURED");
    // 11.11: Rs 1,111 fixed with minimum Rs 1,000
    const f = evaluateCoupon(coupon({ type: "FIXED", value: 1111, minimumOrderAmount: 1000, maximumDiscount: null }), 1330, FRESH, NOW);
    expect(!f.ok && f.rejection.code).toBe("MISCONFIGURED");
    // percentage without a maximum discount
    expect(evaluateCoupon(coupon({ maximumDiscount: null }), 2000, FRESH, NOW).ok).toBe(false);
  });
  it("success gives the discount", () => {
    const r = evaluateCoupon(coupon(), 2000, FRESH, NOW);
    expect(r).toEqual({ ok: true, discount: 200 });
  });
});

describe("coupon discount math", () => {
  it("percentage with cap", () => {
    expect(computeCouponDiscount({ type: "PERCENTAGE", value: 10, maximumDiscount: 500 }, 2000)).toBe(200);
    expect(computeCouponDiscount({ type: "PERCENTAGE", value: 10, maximumDiscount: 500 }, 9000)).toBe(500);
  });
  it("rounds down to whole rupees", () => {
    expect(computeCouponDiscount({ type: "PERCENTAGE", value: 10, maximumDiscount: 500 }, 665)).toBe(66);
    expect(computeCouponDiscount({ type: "PERCENTAGE", value: 15, maximumDiscount: 1000 }, 333.33)).toBe(49);
  });
  it("never more than 90% of the products subtotal", () => {
    expect(computeCouponDiscount({ type: "FIXED", value: 1111, maximumDiscount: null }, 1000)).toBe(900);
    expect(computeCouponDiscount({ type: "FIXED", value: 1111, maximumDiscount: null }, 1111)).toBe(999);
    expect(computeCouponDiscount({ type: "PERCENTAGE", value: 120, maximumDiscount: null }, 1595)).toBe(1435);
    expect(computeCouponDiscount({ type: "FIXED", value: 500, maximumDiscount: null }, 1)).toBe(0);
  });
  it("zero / negative subtotal gives nothing", () => {
    expect(computeCouponDiscount({ type: "FIXED", value: 100, maximumDiscount: null }, 0)).toBe(0);
    expect(computeCouponDiscount({ type: "FIXED", value: 100, maximumDiscount: null }, -5)).toBe(0);
  });
  it("products can never become free (any subtotal)", () => {
    for (const s of [1, 10, 99, 150, 1000, 1111, 5000, 123456]) {
      const d = computeCouponDiscount({ type: "FIXED", value: 1_000_000, maximumDiscount: null }, s);
      expect(s - d).toBeGreaterThanOrEqual(s * 0.1 - 1e-9);
    }
  });
});

describe("admin coupon form rules", () => {
  const base = {
    code: "save10",
    type: "PERCENTAGE",
    value: "10",
    minimumOrderAmount: "",
    maximumDiscount: "500",
    usageLimit: "",
    perUserLimit: "1",
    firstOrderOnly: true,
    startDate: "2026-11-01",
    expiryDate: "2026-12-31",
    isActive: true,
  };
  it("accepts a valid percentage coupon and normalises", () => {
    const r = couponDefinitionSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("SAVE10");
      expect(r.data.minimumOrderAmount).toBeNull();
      expect(r.data.usageLimit).toBeNull();
      expect(r.data.perUserLimit).toBe(1);
      expect(r.data.startDate.toISOString()).toBe("2026-10-31T19:00:00.000Z");
      expect(r.data.expiryDate.toISOString()).toBe("2026-12-31T18:59:59.999Z");
    }
  });
  it("rejects 120%", () => {
    expect(validateFields(couponDefinitionSchema, { ...base, value: "120" })).toHaveProperty("value");
    expect(validateFields(couponDefinitionSchema, { ...base, value: "0" })).toHaveProperty("value");
    expect(validateFields(couponDefinitionSchema, { ...base, value: "90" })).toBeNull();
    expect(validateFields(couponDefinitionSchema, { ...base, value: "91" })).toHaveProperty("value");
  });
  it("percentage needs a maximum discount", () => {
    expect(validateFields(couponDefinitionSchema, { ...base, maximumDiscount: "" })).toHaveProperty("maximumDiscount");
  });
  it("fixed value must be at most half the minimum order", () => {
    const fixed = { ...base, type: "FIXED", value: "1000", maximumDiscount: "" };
    expect(validateFields(couponDefinitionSchema, { ...fixed, minimumOrderAmount: "1000" })).toHaveProperty("minimumOrderAmount");
    expect(validateFields(couponDefinitionSchema, { ...fixed, minimumOrderAmount: "1999" })).toHaveProperty("minimumOrderAmount");
    expect(validateFields(couponDefinitionSchema, { ...fixed, minimumOrderAmount: "" })).toHaveProperty("minimumOrderAmount");
    expect(validateFields(couponDefinitionSchema, { ...fixed, minimumOrderAmount: "2000" })).toBeNull();
    expect(validateFields(couponDefinitionSchema, { ...fixed, value: "0", minimumOrderAmount: "2000" })).toHaveProperty("value");
  });
  it("expiry must be after start", () => {
    expect(validateFields(couponDefinitionSchema, { ...base, expiryDate: "2026-10-01" })).toHaveProperty("expiryDate");
    expect(validateFields(couponDefinitionSchema, { ...base, startDate: "nope" })).toHaveProperty("startDate");
  });
  it("code format", () => {
    expect(validateFields(couponDefinitionSchema, { ...base, code: "11.11" })).toHaveProperty("code");
    expect(validateFields(couponDefinitionSchema, { ...base, code: "AB" })).toHaveProperty("code");
  });
  it("limits are whole numbers", () => {
    expect(validateFields(couponDefinitionSchema, { ...base, usageLimit: "0" })).toHaveProperty("usageLimit");
    expect(validateFields(couponDefinitionSchema, { ...base, perUserLimit: "1.5" })).toHaveProperty("perUserLimit");
    expect(validateFields(couponDefinitionSchema, { ...base, usageLimit: "100" })).toBeNull();
  });
  it("definition problems list for legacy rows", () => {
    expect(couponDefinitionProblems({ type: "PERCENTAGE", value: 120, minimumOrderAmount: 1000, maximumDiscount: null })).toHaveLength(2);
    expect(couponDefinitionProblems({ type: "FIXED", value: 1111, minimumOrderAmount: 1000, maximumDiscount: null })).toHaveLength(1);
    expect(couponDefinitionProblems({ type: "FIXED", value: 500, minimumOrderAmount: 1000, maximumDiscount: null })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Per-customer / phone / address limits with an in-memory fake DB
// ---------------------------------------------------------------------------

type FakeUser = { id: string; phone: string | null };
type FakeUsage = { id: string; couponId: string; userId: string; orderId: string | null };
type FakeOrder = {
  id: string;
  customerId: string;
  orderStatus: string;
  deliveryAddressSnapshot: Record<string, unknown>;
  deliveryFeePaid?: number;
  productAmountPaid?: number;
  productPaymentStatus?: string;
  successPayments?: number;
};

function fakeDb(opts: {
  users: FakeUser[];
  usages: FakeUsage[];
  orders: FakeOrder[];
  coupons?: { id: string; code: string; usedCount: number; usageLimit: number | null; [k: string]: unknown }[];
}) {
  const state = { ...opts, coupons: opts.coupons || [] };
  const db = {
    state,
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.users.find((u) => u.id === where.id) || null,
    },
    // userIdsWithPhones: SELECT id FROM "User" WHERE digits IN (...)
    $queryRaw: async (sql: { values: unknown[] }) => {
      const digits = new Set(sql.values.map(String));
      return state.users
        .filter((u) => u.phone && digits.has(u.phone.replace(/[^0-9]/g, "")))
        .map((u) => ({ id: u.id }));
    },
    couponUsage: {
      findMany: async ({ where }: { where: { couponId?: string; orderId?: string } }) =>
        state.usages.filter(
          (u) =>
            (where.couponId == null || u.couponId === where.couponId) &&
            (where.orderId == null || u.orderId === where.orderId)
        ),
      create: async ({ data }: { data: FakeUsage }) => {
        const row = { ...data, id: `u${state.usages.length + 1}` };
        state.usages.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.usages = state.usages.filter((u) => u.id !== where.id);
      },
    },
    order: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        state.orders.filter((o) => where.id.in.includes(o.id)),
      count: async ({ where }: { where: { customerId: { in: string[] }; orderStatus: { notIn: string[] } } }) =>
        state.orders.filter(
          (o) => where.customerId.in.includes(o.customerId) && !where.orderStatus.notIn.includes(o.orderStatus)
        ).length,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const o = state.orders.find((x) => x.id === where.id);
        if (!o) return null;
        return {
          deliveryFeePaid: o.deliveryFeePaid ?? 0,
          productAmountPaid: o.productAmountPaid ?? 0,
          productPaymentStatus: o.productPaymentStatus ?? "CASH_ON_DELIVERY",
          payments: Array.from({ length: o.successPayments ?? 0 }, (_, i) => ({ id: `p${i}` })),
        };
      },
    },
    coupon: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) =>
        state.coupons.find((c) => (where.id ? c.id === where.id : c.code === where.code)) || null,
      findFirst: async () => null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; usedCount?: { lt?: number; gt?: number } };
        data: { usedCount: { increment?: number; decrement?: number } };
      }) => {
        const c = state.coupons.find((x) => x.id === where.id);
        if (!c) return { count: 0 };
        if (where.usedCount?.lt != null && !(c.usedCount < where.usedCount.lt)) return { count: 0 };
        if (where.usedCount?.gt != null && !(c.usedCount > where.usedCount.gt)) return { count: 0 };
        c.usedCount += data.usedCount.increment ?? 0;
        c.usedCount -= data.usedCount.decrement ?? 0;
        return { count: 1 };
      },
    },
  };
  return db;
}

const addrA = { houseBuilding: "House 12, Street 4", area: "Model Town", city: "Lahore", phone: "03001112222" };

describe("per-customer limit counts account, phone and address (QA T4)", () => {
  it("counts this account's uses", async () => {
    const db = fakeDb({
      users: [{ id: "me", phone: "03009876543" }],
      usages: [{ id: "u1", couponId: "c1", userId: "me", orderId: "o1" }],
      orders: [{ id: "o1", customerId: "me", orderStatus: "DELIVERED", deliveryAddressSnapshot: {} }],
    });
    const f = await gatherCouponCustomerFacts(db as never, "c1", "me", null);
    expect(f).toEqual({ customerUses: 1, hasPreviousOrder: true });
  });

  it("counts another account with the same phone (legacy format)", async () => {
    const db = fakeDb({
      users: [
        { id: "me", phone: "03009876543" },
        { id: "fake", phone: "+92 300 9876543" },
      ],
      usages: [{ id: "u1", couponId: "c1", userId: "fake", orderId: "o1" }],
      orders: [{ id: "o1", customerId: "fake", orderStatus: "CONFIRMED", deliveryAddressSnapshot: {} }],
    });
    const f = await gatherCouponCustomerFacts(db as never, "c1", "me", null);
    expect(f.customerUses).toBe(1);
    // first-order-only also sees the other account's order
    expect(f.hasPreviousOrder).toBe(true);
  });

  it("counts an order delivered to the same address (case/space-insensitive)", async () => {
    const db = fakeDb({
      users: [
        { id: "me", phone: "03009876543" },
        { id: "other", phone: "03111111111" },
      ],
      usages: [{ id: "u1", couponId: "c1", userId: "other", orderId: "o1" }],
      orders: [
        {
          id: "o1",
          customerId: "other",
          orderStatus: "CONFIRMED",
          deliveryAddressSnapshot: { houseBuilding: "house 12,  street 4", area: "MODEL TOWN", city: "lahore", phone: "03111111111" },
        },
      ],
    });
    const f = await gatherCouponCustomerFacts(db as never, "c1", "me", addrA);
    expect(f.customerUses).toBe(1);
    expect(f.hasPreviousOrder).toBe(false);
  });

  it("counts an order delivered to the same delivery phone", async () => {
    const db = fakeDb({
      users: [
        { id: "me", phone: "03009876543" },
        { id: "other", phone: "03111111111" },
      ],
      usages: [{ id: "u1", couponId: "c1", userId: "other", orderId: "o1" }],
      orders: [
        {
          id: "o1",
          customerId: "other",
          orderStatus: "CONFIRMED",
          deliveryAddressSnapshot: { houseBuilding: "Elsewhere", area: "DHA", city: "Lahore", phone: "0300-1112222" },
        },
      ],
    });
    const f = await gatherCouponCustomerFacts(db as never, "c1", "me", addrA);
    expect(f.customerUses).toBe(1);
  });

  it("does not count unrelated customers or other coupons", async () => {
    const db = fakeDb({
      users: [
        { id: "me", phone: "03009876543" },
        { id: "other", phone: "03111111111" },
      ],
      usages: [
        { id: "u1", couponId: "c1", userId: "other", orderId: "o1" },
        { id: "u2", couponId: "c2", userId: "me", orderId: "o2" },
      ],
      orders: [
        { id: "o1", customerId: "other", orderStatus: "CONFIRMED", deliveryAddressSnapshot: { houseBuilding: "X", area: "Y", city: "Z", phone: "03111111111" } },
        { id: "o2", customerId: "me", orderStatus: "CANCELLED", deliveryAddressSnapshot: {} },
      ],
    });
    const f = await gatherCouponCustomerFacts(db as never, "c1", "me", addrA);
    expect(f).toEqual({ customerUses: 0, hasPreviousOrder: false }); // cancelled order is not a "previous order"
  });

  it("validateCoupon end-to-end with the fake DB: already used", async () => {
    const db = fakeDb({
      users: [{ id: "me", phone: "03009876543" }],
      usages: [{ id: "u1", couponId: "c1", userId: "me", orderId: "o1" }],
      orders: [{ id: "o1", customerId: "me", orderStatus: "DELIVERED", deliveryAddressSnapshot: {} }],
      coupons: [
        {
          id: "c1",
          code: "SAVE10",
          type: "PERCENTAGE",
          value: 10,
          minimumOrderAmount: null,
          maximumDiscount: 500,
          startDate: new Date("2026-01-01"),
          expiryDate: new Date("2099-01-01"),
          usageLimit: null,
          perUserLimit: 1,
          firstOrderOnly: false,
          usedCount: 1,
          isActive: true,
        },
      ],
    });
    const r = await validateCoupon("save10", 2000, "me", { db: db as never });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe("ALREADY_USED");
    const guest = await validateCoupon("save10", 2000, undefined, { db: db as never });
    expect(!guest.valid && guest.reason).toBe("SIGN_IN");
    const bad = await validateCoupon("FAKE999", 2000, "me", { db: db as never });
    expect(!bad.valid && bad.error).toBe("This coupon code is not valid.");
  });
});

describe("usage counting and release", () => {
  it("records usage and stops at the total limit", async () => {
    const db = fakeDb({
      users: [],
      usages: [],
      orders: [],
      coupons: [{ id: "c1", code: "X", usedCount: 1, usageLimit: 2 }],
    });
    await recordCouponUsageInTx(db as never, { couponId: "c1", userId: "me", orderId: "o1", discount: 100 });
    expect(db.state.coupons[0].usedCount).toBe(2);
    expect(db.state.usages).toHaveLength(1);
    await expect(
      recordCouponUsageInTx(db as never, { couponId: "c1", userId: "me", orderId: "o2", discount: 100 })
    ).rejects.toThrow("usage limit");
    expect(db.state.usages).toHaveLength(1);
  });

  it("gives the coupon back only when nothing was paid", async () => {
    const db = fakeDb({
      users: [],
      usages: [
        { id: "u1", couponId: "c1", userId: "me", orderId: "unpaid" },
        { id: "u2", couponId: "c1", userId: "me", orderId: "paid" },
      ],
      orders: [
        { id: "unpaid", customerId: "me", orderStatus: "PENDING_PAYMENT", deliveryAddressSnapshot: {} },
        { id: "paid", customerId: "me", orderStatus: "CONFIRMED", deliveryAddressSnapshot: {}, deliveryFeePaid: 100, successPayments: 1 },
      ],
      coupons: [{ id: "c1", code: "X", usedCount: 2, usageLimit: null }],
    });
    expect(await releaseCouponUsageForOrder(db as never, "paid")).toEqual({ released: 0, reason: "PAID" });
    expect(db.state.coupons[0].usedCount).toBe(2);
    expect(await releaseCouponUsageForOrder(db as never, "unpaid")).toEqual({ released: 1 });
    expect(db.state.coupons[0].usedCount).toBe(1);
    // idempotent
    expect(await releaseCouponUsageForOrder(db as never, "unpaid")).toEqual({ released: 0, reason: "NO_COUPON" });
    expect(db.state.coupons[0].usedCount).toBe(1);
  });
});

describe("helpers", () => {
  it("address key", () => {
    expect(couponAddressKey({ houseBuilding: " House 1 ", area: "DHA", city: "Lahore" })).toBe("house 1|dha|lahore");
    expect(couponAddressKey({ houseBuilding: "", area: "DHA", city: "Lahore" })).toBeNull();
  });
  it("phone variants", () => {
    expect(mobileDigitVariants("+92 300 1234567")).toEqual(["03001234567", "923001234567", "3001234567", "00923001234567"]);
    expect(mobileDigitVariants("abc")).toEqual([]);
  });
});
