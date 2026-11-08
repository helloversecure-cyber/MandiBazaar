import { describe, it, expect } from "vitest";
import {
  checkPayoutSelection,
  computeRiderFee,
  describeRiderPayRule,
  effectiveRiderFee,
  maskRiderPayoutAccount,
  payoutFieldErrors,
  summarizeRiderEarnings,
  type PayoutCandidate,
} from "@/lib/riders/pay-rules";
import { recordRiderFeeForOrder } from "@/lib/riders/pay";
import { parseRiderDocuments } from "@/lib/riders/documents";

const S = { baseFee: 50, perKmFee: 12.5 };

describe("rider fee formula", () => {
  it("base only when per-km is 0 or distance missing", () => {
    expect(computeRiderFee({ baseFee: 50, perKmFee: 0 }, 7)).toBe(50);
    expect(computeRiderFee(S, null)).toBe(50);
    expect(computeRiderFee(S, undefined)).toBe(50);
    expect(computeRiderFee(S, NaN)).toBe(50);
  });
  it("adds per-km pay and rounds to whole rupees (half up)", () => {
    expect(computeRiderFee(S, 2)).toBe(75);
    expect(computeRiderFee(S, 2.3)).toBe(79); // 78.75
    expect(computeRiderFee({ baseFee: 50, perKmFee: 1 }, 0.5)).toBe(51); // 50.5
    expect(computeRiderFee({ baseFee: 50, perKmFee: 1 }, 0.49)).toBe(50);
    expect(computeRiderFee({ baseFee: 0, perKmFee: 0.1 }, 4.94)).toBe(0); // 0.494
    expect(computeRiderFee({ baseFee: 50, perKmFee: 15 }, 2.1)).toBe(82); // 81.5 (float 81.49999…)
  });
  it("is never negative", () => {
    expect(computeRiderFee({ baseFee: -10, perKmFee: -5 }, 3)).toBe(0);
    expect(computeRiderFee(S, -4)).toBe(50);
  });
  it("describes the rule in one line", () => {
    expect(describeRiderPayRule({ baseFee: 50, perKmFee: 0 })).toBe("Rs 50 per delivery");
    expect(describeRiderPayRule({ baseFee: 50, perKmFee: 10 })).toBe("Rs 50 per delivery + Rs 10 per km");
  });
  it("keeps a fixed fee even if settings change", () => {
    expect(effectiveRiderFee({ riderFee: 60, distanceKm: 10 }, { baseFee: 100, perKmFee: 100 })).toBe(60);
    expect(effectiveRiderFee({ riderFee: null, distanceKm: 2 }, S)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Idempotent recording with an in-memory tx
// ---------------------------------------------------------------------------

type Del = { orderId: string; riderId: string | null; riderFee: number | null; riderPayoutId: string | null; deliveredAt?: Date };

function fakeTx(opts: {
  order: { id: string; orderStatus: string; riderId: string | null; deliveryDistanceKm: number | null };
  delivery?: Del;
  settings: { riderBaseFee: number; riderPerKmFee: number };
}) {
  const state = { delivery: opts.delivery ? { ...opts.delivery } : undefined, settings: { ...opts.settings }, writes: 0 };
  const matches = (where: Record<string, unknown>) =>
    !!state.delivery &&
    Object.entries(where).every(([k, v]) => (state.delivery as Record<string, unknown>)[k] === v);
  const tx = {
    storeSettings: { findFirst: async () => state.settings },
    order: {
      findUnique: async () => ({
        ...opts.order,
        deliveredAt: new Date(),
        delivery: state.delivery ? { riderFee: state.delivery.riderFee } : null,
      }),
    },
    delivery: {
      upsert: async ({ create }: { create: Del }) => {
        state.writes++;
        if (!state.delivery) state.delivery = { ...create, riderPayoutId: create.riderPayoutId ?? null };
        return state.delivery;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Del> }) => {
        if (!matches(where)) return { count: 0 };
        state.writes++;
        Object.assign(state.delivery!, data);
        return { count: 1 };
      },
      findUnique: async () => (state.delivery ? { riderFee: state.delivery.riderFee } : null),
    },
  };
  return { tx: tx as never, state };
}

describe("recordRiderFeeForOrder", () => {
  const order = { id: "o1", orderStatus: "DELIVERED", riderId: "r1", deliveryDistanceKm: 4 };

  it("creates the delivery row and fixes the fee", async () => {
    const { tx, state } = fakeTx({ order, settings: { riderBaseFee: 50, riderPerKmFee: 10 } });
    expect(await recordRiderFeeForOrder(tx, "o1")).toBe(90);
    expect(state.delivery).toMatchObject({ orderId: "o1", riderId: "r1", riderFee: 90 });
  });

  it("is idempotent and never changes a fixed fee after settings change", async () => {
    const { tx, state } = fakeTx({
      order,
      delivery: { orderId: "o1", riderId: "r1", riderFee: null, riderPayoutId: null },
      settings: { riderBaseFee: 50, riderPerKmFee: 10 },
    });
    expect(await recordRiderFeeForOrder(tx, "o1")).toBe(90);
    state.settings.riderBaseFee = 500;
    expect(await recordRiderFeeForOrder(tx, "o1")).toBe(90);
    expect(state.delivery!.riderFee).toBe(90);
  });

  it("does nothing for non-delivered orders or orders without a rider", async () => {
    const a = fakeTx({ order: { ...order, orderStatus: "FAILED" }, settings: { riderBaseFee: 50, riderPerKmFee: 0 } });
    expect(await recordRiderFeeForOrder(a.tx, "o1")).toBeNull();
    expect(a.state.writes).toBe(0);
    const b = fakeTx({ order: { ...order, riderId: null }, settings: { riderBaseFee: 50, riderPerKmFee: 0 } });
    expect(await recordRiderFeeForOrder(b.tx, "o1")).toBeNull();
    expect(b.state.writes).toBe(0);
  });

  it("uses base only when distance is missing", async () => {
    const { tx } = fakeTx({ order: { ...order, deliveryDistanceKm: null }, settings: { riderBaseFee: 70, riderPerKmFee: 10 } });
    expect(await recordRiderFeeForOrder(tx, "o1")).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Payout selection / double-pay guard
// ---------------------------------------------------------------------------

describe("checkPayoutSelection", () => {
  const c = (id: string, extra: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
    orderId: id,
    eligible: true,
    riderPayoutId: null,
    riderFee: 60,
    distanceKm: null,
    ...extra,
  });

  it("accepts exactly the confirmed unpaid deliveries", () => {
    const r = checkPayoutSelection(["a", "b"], { amount: 110, count: 2 }, [c("a"), c("b", { riderFee: null })], {
      baseFee: 50,
      perKmFee: 0,
    });
    expect(r).toMatchObject({ ok: true, amount: 110, count: 2, fees: { a: 60, b: 50 } });
  });

  it("refuses already-paid deliveries (double pay) with 409", () => {
    const r = checkPayoutSelection(["a"], { amount: 60, count: 1 }, [c("a", { riderPayoutId: "p1" })], S);
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses deliveries that are not this rider's / not delivered / missing", () => {
    expect(checkPayoutSelection(["a"], { amount: 60, count: 1 }, [c("a", { eligible: false })], S)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(checkPayoutSelection(["zz"], { amount: 60, count: 1 }, [c("a")], S)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses when amount or count differ from what was confirmed", () => {
    expect(checkPayoutSelection(["a"], { amount: 50, count: 1 }, [c("a")], S)).toMatchObject({ ok: false, status: 409 });
    expect(checkPayoutSelection(["a"], { amount: 60, count: 2 }, [c("a")], S)).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects empty and duplicate lists", () => {
    expect(checkPayoutSelection([], { amount: 0, count: 0 }, [], S)).toMatchObject({ ok: false, status: 400 });
    expect(checkPayoutSelection(["a", "a"], { amount: 120, count: 2 }, [c("a")], S)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("payout form + account masking", () => {
  it("requires a reference for bank / JazzCash, not for cash", () => {
    expect(payoutFieldErrors({ method: "BANK_TRANSFER", reference: "" }).errors.reference).toBeTruthy();
    expect(payoutFieldErrors({ method: "JAZZCASH", reference: "TID12345" }).errors).toEqual({});
    expect(payoutFieldErrors({ method: "CASH" }).errors).toEqual({});
    expect(payoutFieldErrors({ method: "WIRE" }).errors.method).toBeTruthy();
    expect(payoutFieldErrors({ method: "OTHER", reference: "<b>" }).errors.reference).toBeTruthy();
  });
  it("masks payout accounts", () => {
    expect(maskRiderPayoutAccount({ jazzCashNumber: "03001234567" })).toBe("JazzCash ****4567");
    expect(
      maskRiderPayoutAccount({ accountNumber: "PK36SCBL0000001123456702", bankName: "SCB", accountTitle: "Ali" })
    ).toBe("Bank SCB ****6702 (Ali)");
    expect(maskRiderPayoutAccount({})).toBe("No payout account");
  });
});

describe("summarizeRiderEarnings", () => {
  const now = new Date("2026-11-07T12:00:00");
  const day = 24 * 60 * 60 * 1000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const periods = [
    { key: "today", label: "Today", since: today },
    { key: "week", label: "Last 7 days", since: new Date(now.getTime() - 7 * day) },
    { key: "month", label: "Last 30 days", since: new Date(now.getTime() - 30 * day) },
    { key: "all", label: "All time" },
  ];
  const row = (id: string, ago: number, fee: number | null, paid: string | null, km: number | null = null) => ({
    orderId: id,
    orderNumber: id,
    deliveredAt: new Date(now.getTime() - ago * day),
    distanceKm: km,
    riderFee: fee,
    riderPayoutId: paid,
  });

  it("totals per period and splits unpaid / paid", () => {
    const s = summarizeRiderEarnings(
      [row("a", 0.1, 60, null), row("b", 3, null, null, 2), row("c", 20, 55, "p1"), row("d", 90, 50, "p1")],
      periods,
      S
    );
    expect(s.periods.map((p) => [p.key, p.deliveries, p.earned])).toEqual([
      ["today", 1, 60],
      ["week", 2, 135],
      ["month", 3, 190],
      ["all", 4, 240],
    ]);
    expect(s.unpaid).toEqual({ count: 2, amount: 135 });
    expect(s.paid).toEqual({ count: 2, amount: 105 });
  });
});

describe("parseRiderDocuments", () => {
  it("keeps uploads / https, skips blanks, rejects other URLs", () => {
    const r = parseRiderDocuments({
      photoUrl: "/uploads/riders/a.jpg",
      cnicUrl: "https://res.cloudinary.com/x/y.jpg",
      cnicBackUrl: "",
      licenseUrl: "javascript:alert(1)",
      bikeUrl: "http://evil.example.com/a.jpg",
      other: "x",
    });
    expect(r.value).toEqual({ photoUrl: "/uploads/riders/a.jpg", cnicUrl: "https://res.cloudinary.com/x/y.jpg" });
    expect(Object.keys(r.errors).sort()).toEqual(["bikeUrl", "licenseUrl"]);
  });
});
