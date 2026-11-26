/**
 * W9: delivery code on item-list orders (H-01 … H-07) and store rating (H-09 … H-11).
 * Customer A's list (2 kg sugar, S1's own product, at Rs 500) is accepted from S1,
 * packed, and R1's Rs 150 delivery bid is accepted → cash due Rs 1,150.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string | null; role: string } },
}));
vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/auth")>();
  const need = async () => {
    if (!auth.session) throw new Error("UNAUTHORIZED");
    return auth.session;
  };
  const rider = async () => {
    const session = await need();
    const { prisma: db } = await import("@/lib/db");
    const r = await db.rider.findUnique({ where: { userId: session.user.id } });
    if (!r) throw new Error("FORBIDDEN");
    return { session, rider: r };
  };
  const admin = async () => {
    const session = await need();
    if (session.user.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
    return session;
  };
  return { ...real, getSession: async () => auth.session, requireAuth: need, requireStorePortal: need, requireRider: rider, requireAdmin: admin };
});

import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, submitBid as submitStoreBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { offersForList } from "@/lib/lists/offers";
import {
  DELIVERY_CODE_MAX_ATTEMPTS,
  deliveryCodeMatches,
  makeDeliveryCode,
  normalizeDeliveryCode,
  readDeliveryCode,
} from "@/lib/orders/delivery-code";
import { storeReviewSchema } from "@/lib/stores/reviews";
import { PATCH as storePatch } from "@/app/api/store/route";
import { GET as riderBidsGet, POST as riderBidsPost } from "@/app/api/rider/bids/route";
import { GET as riderGet, PATCH as riderPatch } from "@/app/api/rider/route";
import { GET as ordersGet, PATCH as ordersPatch } from "@/app/api/orders/route";
import { GET as orderDetailGet } from "@/app/api/orders/[orderNumber]/route";
import { POST as acceptRoute } from "@/app/api/orders/[orderNumber]/rider-bids/[bidId]/accept/route";
import { GET as reviewsGet, POST as reviewsPost } from "@/app/api/store-reviews/route";
import { POST as storeReviewsPost } from "@/app/api/stores/[id]/reviews/route";
import { GET as storesGet } from "@/app/api/stores/route";

const KM = 1 / 111;

describe("delivery code helpers (pure)", () => {
  it("the stored value never contains the code, and only the right code matches", () => {
    const { stored, code } = makeDeliveryCode("order-1");
    expect(code).toMatch(/^\d{4}$/);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.split(".")).toHaveLength(3);
    expect(readDeliveryCode("order-1", stored)).toBe(code);
    expect(deliveryCodeMatches("order-1", stored, code)).toBe(true);
    const wrong = String((Number(code) + 1) % 10000).padStart(4, "0");
    expect(deliveryCodeMatches("order-1", stored, wrong)).toBe(false);
    // tied to the order
    expect(deliveryCodeMatches("order-2", stored, code)).toBe(false);
    expect(deliveryCodeMatches("order-1", null, code)).toBe(false);
    expect(deliveryCodeMatches("order-1", "junk", code)).toBe(false);
  });

  it("only 4 digits are a code", () => {
    expect(normalizeDeliveryCode("0123")).toBe("0123");
    expect(normalizeDeliveryCode(" 4567 ")).toBe("4567");
    expect(normalizeDeliveryCode(4567)).toBe("4567");
    for (const v of ["123", "12345", "12a4", "", null, undefined, {}, "１２３４"]) expect(normalizeDeliveryCode(v)).toBeNull();
  });

  it("rating input is checked", () => {
    const ok = storeReviewSchema.safeParse({ orderId: "o1", rating: 4, comment: "  Good \u0007 " });
    expect(ok.success && ok.data.comment).toBe("Good");
    for (const rating of [0, 6, 3.5, "4", null, undefined]) {
      expect(storeReviewSchema.safeParse({ orderId: "o1", rating }).success).toBe(false);
    }
    expect(storeReviewSchema.safeParse({ rating: 3 }).success).toBe(false);
    expect(storeReviewSchema.safeParse({ orderId: "o1", rating: 3, comment: "x".repeat(1001) }).success).toBe(false);
  });
});

describeDb("delivery code and store rating", () => {
  let f: Fixtures;
  let sugarId: string;
  let n = 0;
  const key = () => `w9-key-${++n}-${Date.now()}`;
  const as = (userId: string, role: string) => (auth.session = { user: { id: userId, role } });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });
  const hashOf = async (orderId: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { deliveryCodeHash: true } })).deliveryCodeHash;

  async function listOrder() {
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Sugar", quantity: 2, unit: "kg", productId: sugarId }] })
    );
    const bid = await submitStoreBid(
      { id: f.S1.ownerId },
      l.id,
      bidSchema.parse({ lines: [{ lineId: l.lines[0].id, available: true, unitPrice: 500 }] })
    );
    const order = await acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      l.id,
      acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: key() })
    );
    return { ...order, listId: l.id };
  }

  async function markReady(orderId: string) {
    const ful = await prisma.storeFulfillment.findFirstOrThrow({ where: { orderId } });
    as(f.S1.ownerId, "STORE_OWNER");
    const res = await storePatch(
      new Request("http://localhost/api/store", {
        method: "PATCH",
        body: JSON.stringify({ action: "FULFILLMENT_STATUS", fulfillmentId: ful.id, status: "READY_FOR_DISPATCH" }),
      })
    );
    expect(res.status).toBe(200);
    return prisma.deliveryRequest.findUnique({ where: { orderId } });
  }

  /** List order with R1 accepted at Rs 150. Returns the code from the accept response. */
  async function assignedListOrder() {
    const order = await listOrder();
    const req = (await markReady(order.orderId))!;
    as(f.R1.userId!, "RIDER");
    const bid = await json(
      await riderBidsPost(new Request("http://localhost/api/rider/bids", { method: "POST", body: JSON.stringify({ requestId: req.id, amount: 150 }) }))
    );
    expect(bid.status).toBe(200);
    as(f.customerA.id, "CUSTOMER");
    const acc = await json(
      await acceptRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({ idempotencyKey: key() }) }), {
        params: { orderNumber: order.orderNumber, bidId: bid.body.data.bidId },
      })
    );
    expect(acc.status).toBe(201);
    return { ...order, code: acc.body.data.deliveryCode as string, accept: acc.body.data };
  }

  const rider = async (body: Record<string, unknown>, userId = f.R1.userId!) => {
    as(userId, "RIDER");
    return json(await riderPatch(new Request("http://localhost/api/rider", { method: "PATCH", body: JSON.stringify(body) })));
  };
  const admin = async (body: Record<string, unknown>) => {
    as(f.admin.id, "SUPER_ADMIN");
    return json(await ordersPatch(new Request("http://localhost/api/orders", { method: "PATCH", body: JSON.stringify(body) })));
  };
  const detail = async (orderNumber: string, userId = f.customerA.id, role = "CUSTOMER") => {
    as(userId, role);
    return json(await orderDetailGet(new NextRequest(`http://localhost/api/orders/${orderNumber}`), { params: { orderNumber } }));
  };
  const deliver = (orderId: string, extra: Record<string, unknown> = {}) =>
    rider({ action: "MARK_DELIVERED", orderId, amountCollected: 1150, ...extra });
  const wrongCode = (code: string) => String((Number(code) + 1) % 10000).padStart(4, "0");

  async function outForDelivery() {
    const o = await assignedListOrder();
    expect((await rider({ action: "START_DELIVERY", orderId: o.orderId })).status).toBe(200);
    return o;
  }

  async function cartOrder(opts: { status?: "OUT_FOR_DELIVERY" | "DELIVERED" | "CONFIRMED"; stores?: string[]; customerId?: string; number?: string } = {}) {
    const stores = opts.stores ?? [f.S1.id];
    return prisma.order.create({
      data: {
        orderNumber: opts.number ?? `ORD-CART-${++n}`,
        customerId: opts.customerId ?? f.customerA.id,
        subtotal: 500,
        deliveryFee: 120,
        grandTotal: 620,
        remainingAmount: 500,
        paymentMethod: "CASH_ON_DELIVERY",
        productPaymentStatus: "CASH_ON_DELIVERY",
        deliveryFeePaymentStatus: "PAID",
        deliveryFeePaid: 120,
        orderStatus: opts.status ?? "OUT_FOR_DELIVERY",
        riderId: f.R1.id,
        deliveredAt: opts.status === "DELIVERED" ? new Date() : null,
        deliveryAddressSnapshot: { city: "Lahore", area: "Model Town" },
        items: {
          create: stores.map((storeId, i) => ({
            storeId,
            storeName: `Store ${i + 1}`,
            productName: "Rice",
            sku: `R${i}`,
            unit: "kg",
            quantity: 1,
            unitPrice: 500 / stores.length,
            finalPrice: 500 / stores.length,
          })),
        },
        fulfillments: { create: stores.map((storeId) => ({ storeId, status: "OUT_FOR_DELIVERY" as const, subtotal: 500 / stores.length, itemCount: 1, pickupAddress: {} })) },
      },
    });
  }

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    for (const r of [f.R1, f.R2]) {
      await prisma.rider.update({
        where: { id: r.id },
        data: { lastLatitude: f.S1.latitude! + 1 * KM, lastLongitude: f.S1.longitude!, lastLocationAt: new Date() },
      });
    }
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    sugarId = (
      await prisma.product.create({
        data: { storeId: f.S1.id, categoryId: grocery.id, name: "Sugar", slug: "sugar", sku: "SUG-1", price: 150, unit: "kg", status: "ACTIVE", stockQuantity: 5 },
      })
    ).id;
  });

  afterEach(() => {
    auth.session = null;
  });

  describe("code created (H-01)", () => {
    it("accepting a rider gives the customer a 4-digit code; only a keyed hash is stored", async () => {
      const o = await assignedListOrder();
      expect(o.code).toMatch(/^\d{4}$/);
      const stored = await hashOf(o.orderId);
      expect(stored).toMatch(/^v1\./);
      expect(stored).not.toContain(o.code);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
      expect(row).toMatchObject({ deliveryCodeAttempts: 0, deliveryCodeLockedUntil: null });
      // left out of every default read (so no route can spread it into JSON)
      expect("deliveryCodeHash" in row).toBe(false);

      // customer: in-app notice with the body kept out of the database; the order page shows the code
      const notes = await prisma.notification.findMany({ where: { userId: f.customerA.id, type: "DELIVERY_CODE" } });
      expect(notes).toHaveLength(1);
      expect(notes[0].body).not.toContain(o.code);
      const d = await detail(o.orderNumber);
      expect(d.status).toBe(200);
      expect(d.body.data.deliveryCode).toEqual({ required: true, code: o.code, used: false, lockedUntil: null });
      expect(JSON.stringify(d.body.data)).not.toContain("deliveryCodeHash");
      // another customer can't open the order
      expect((await detail(o.orderNumber, f.customerB.id)).status).toBe(404);
    });

    it("the rider never sees the code in any rider API", async () => {
      const o = await assignedListOrder();
      const stored = (await hashOf(o.orderId))!;
      expect(await prisma.notification.count({ where: { userId: f.R1.userId!, type: "DELIVERY_CODE" } })).toBe(0);

      as(f.R1.userId!, "RIDER");
      const responses = [
        await json(await riderGet(new NextRequest("http://localhost/api/rider?resource=deliveries"))),
        await json(await riderGet(new NextRequest("http://localhost/api/rider"))),
        await json(await riderBidsGet(new NextRequest("http://localhost/api/rider/bids"))),
        await json(await ordersGet(new NextRequest("http://localhost/api/orders"))),
      ];
      for (const r of responses) {
        expect(r.status).toBe(200);
        const s = JSON.stringify(r.body);
        expect(s).not.toContain("deliveryCodeHash");
        expect(s).not.toContain(stored);
        expect(s).not.toContain(stored.split(".")[1]);
        expect(s).not.toMatch(/"deliveryCode"\s*:/);
      }
      const mine = responses[0].body.data.items.find((x: { id: string }) => x.id === o.orderId);
      expect(mine.deliveryCodeRequired).toBe(true);
      expect(responses[1].body.data.recent[0].deliveryCodeRequired).toBe(true);
      // the rider's notifications don't carry it either
      const riderNotes = await prisma.notification.findMany({ where: { userId: f.R1.userId! } });
      for (const nt of riderNotes) expect(nt.body).not.toMatch(new RegExp(`code[^0-9]*${o.code}`, "i"));
      // the store and the admin order lists don't either
      as(f.S1.ownerId, "STORE_OWNER");
      expect(JSON.stringify((await json(await ordersGet(new NextRequest("http://localhost/api/orders")))).body)).not.toContain(stored);
      const adm = await detail(o.orderNumber, f.admin.id, "SUPER_ADMIN");
      expect(JSON.stringify(adm.body)).not.toContain(stored);
      expect(adm.body.data.admin).toMatchObject({ deliveryCodeRequired: true, deliveryCodeAttempts: 0 });
    });

    it("admin's manual Assign rider on a list order also creates the code; a re-assign keeps it", async () => {
      const order = await listOrder();
      await markReady(order.orderId);
      const r = await admin({ action: "ASSIGN_RIDER", orderId: order.orderId, riderId: f.R2.id });
      expect(r.status).toBe(200);
      const first = await hashOf(order.orderId);
      expect(first).toMatch(/^v1\./);
      expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "DELIVERY_CODE" } })).toBe(1);
      expect((await admin({ action: "ASSIGN_RIDER", orderId: order.orderId, riderId: f.R1.id })).status).toBe(200);
      expect(await hashOf(order.orderId)).toBe(first);
      expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "DELIVERY_CODE" } })).toBe(1);
    });

    it("a cart order gets no code (admin assign) and is delivered exactly as before", async () => {
      const cart = await cartOrder({ status: "CONFIRMED" });
      await prisma.order.update({ where: { id: cart.id }, data: { orderStatus: "READY_FOR_DISPATCH", riderId: null } });
      expect((await admin({ action: "ASSIGN_RIDER", orderId: cart.id, riderId: f.R1.id })).status).toBe(200);
      expect(await hashOf(cart.id)).toBeNull();
      expect((await detail(cart.orderNumber)).body.data.deliveryCode).toBeNull();
      expect((await rider({ action: "START_DELIVERY", orderId: cart.id })).status).toBe(200);
      const r = await rider({ action: "MARK_DELIVERED", orderId: cart.id, amountCollected: 500 });
      expect(r.status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: cart.id } })).orderStatus).toBe("DELIVERED");
      expect(await prisma.auditLog.count({ where: { action: { startsWith: "DELIVERY_CODE" } } })).toBe(0);
    });
  });

  describe("handover (H-02 … H-07)", () => {
    it("H-05 Mark delivered without the code → 400 and no try is used", async () => {
      const o = await outForDelivery();
      const r = await deliver(o.orderId);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("CODE_REQUIRED");
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
      expect(row).toMatchObject({ orderStatus: "OUT_FOR_DELIVERY", deliveryCodeAttempts: 0 });
      expect(await prisma.cashCollection.count({ where: { orderId: o.orderId } })).toBe(0);
    });

    it("H-02/H-03/H-06/H-07 right code: delivered with cash, rider fee, stock and ledger as before", async () => {
      const o = await outForDelivery();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).orderStatus).toBe("OUT_FOR_DELIVERY");

      const v = await rider({ action: "VERIFY_DELIVERY_CODE", orderId: o.orderId, deliveryCode: o.code });
      expect(v.status).toBe(200);
      expect(v.body.data).toMatchObject({ verified: true, required: true });

      const r = await deliver(o.orderId, { deliveryCode: o.code });
      expect(r.status).toBe(200);
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: o.orderId },
        include: { delivery: true, cashCollection: true, cashRemittance: true, fulfillments: true },
      });
      expect(row.orderStatus).toBe("DELIVERED");
      expect(row.deliveredAt).not.toBeNull();
      expect(row.delivery!.deliveredAt).not.toBeNull();
      // the cash fee is the rider's; the platform owes nothing extra (riderFee fixed at 0)
      expect(row.delivery!.riderFee).not.toBeNull();
      expect(Number(row.delivery!.riderFee)).toBe(0);
      expect(Number(row.cashCollection!.amountCollected)).toBe(1150);
      expect(row.cashRemittance).not.toBeNull();
      expect(Number(row.remainingAmount)).toBe(0);
      expect(row.fulfillments.map((x) => x.status)).toEqual(["DELIVERED"]);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: sugarId } })).stockQuantity).toBe(3);

      const ledger = await prisma.ledgerEntry.findMany({ where: { orderId: o.orderId } });
      const sum = (t: string) => ledger.filter((e) => e.type === t).reduce((s, e) => s + Number(e.amount), 0);
      expect(sum("RIDER_EARNING")).toBe(150);
      expect(sum("SALE")).toBe(1000);
      expect(sum("STORE_EARNING") + Math.abs(sum("COMMISSION"))).toBeCloseTo(1000, 2);

      const ev = await prisma.orderStatusEvent.findFirstOrThrow({ where: { orderId: o.orderId, status: "DELIVERED" } });
      expect(ev.note).toContain("delivery code");
      expect(await prisma.auditLog.count({ where: { action: "RIDER_MARK_DELIVERED", entityId: o.orderId } })).toBe(1);
      // the code is spent: the customer's page no longer shows it
      expect((await detail(o.orderNumber)).body.data.deliveryCode).toMatchObject({ code: null, used: true });
      // a re-tap doesn't use a try or deliver twice
      expect((await deliver(o.orderId, { deliveryCode: "0000" })).status).toBe(400);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).deliveryCodeAttempts).toBe(0);
    });

    it("H-04 wrong codes: 400 each with tries left, the 5th locks it for 15 min and alerts the admin", async () => {
      const o = await outForDelivery();
      const bad = wrongCode(o.code);
      for (let i = 1; i < DELIVERY_CODE_MAX_ATTEMPTS; i++) {
        const r = i % 2 ? await deliver(o.orderId, { deliveryCode: bad }) : await rider({ action: "VERIFY_DELIVERY_CODE", orderId: o.orderId, deliveryCode: "12a4" });
        expect(r.status).toBe(400);
        expect(r.body).toMatchObject({ code: "CODE_WRONG", attemptsLeft: DELIVERY_CODE_MAX_ATTEMPTS - i });
      }
      const before = Date.now();
      const locked = await deliver(o.orderId, { deliveryCode: bad });
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: "CODE_LOCKED", attemptsLeft: 0 });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
      expect(row.orderStatus).toBe("OUT_FOR_DELIVERY");
      const mins = (row.deliveryCodeLockedUntil!.getTime() - before) / 60_000;
      expect(mins).toBeGreaterThan(14.9);
      expect(mins).toBeLessThan(15.1);

      // even the right code is refused while locked
      const stillLocked = await deliver(o.orderId, { deliveryCode: o.code });
      expect(stillLocked.status).toBe(429);
      expect(stillLocked.body.code).toBe("CODE_LOCKED");

      expect(await prisma.auditLog.count({ where: { action: "DELIVERY_CODE_WRONG", entityId: o.orderId } })).toBe(4);
      const lockAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "DELIVERY_CODE_LOCKED", entityId: o.orderId } });
      expect(lockAudit).toMatchObject({ userId: f.R1.userId });
      expect(lockAudit.newValue).toMatchObject({ attempts: 5, riderId: f.R1.id });
      expect(JSON.stringify(lockAudit.newValue)).not.toContain(o.code);
      expect(await prisma.notification.count({ where: { userId: f.admin.id, type: "DELIVERY_CODE_LOCKED" } })).toBe(1);
      expect((await detail(o.orderNumber)).body.data.deliveryCode.lockedUntil).not.toBeNull();

      // after the lock ends the right code works and the counter is cleared
      await prisma.order.update({ where: { id: o.orderId }, data: { deliveryCodeLockedUntil: new Date(Date.now() - 1000) } });
      expect((await deliver(o.orderId, { deliveryCode: o.code })).status).toBe(200);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({
        orderStatus: "DELIVERED",
        deliveryCodeAttempts: 0,
        deliveryCodeLockedUntil: null,
      });
    });

    it("an expired lock starts a fresh count of tries", async () => {
      const o = await outForDelivery();
      await prisma.order.update({ where: { id: o.orderId }, data: { deliveryCodeAttempts: 5, deliveryCodeLockedUntil: new Date(Date.now() - 1000) } });
      const r = await deliver(o.orderId, { deliveryCode: wrongCode(o.code) });
      expect(r.status).toBe(400);
      expect(r.body.attemptsLeft).toBe(4);
    });

    it("only the assigned rider can try codes", async () => {
      const o = await outForDelivery();
      const r = await rider({ action: "VERIFY_DELIVERY_CODE", orderId: o.orderId, deliveryCode: o.code }, f.R2.userId!);
      expect(r.status).toBe(403);
      expect((await rider({ action: "MARK_DELIVERED", orderId: o.orderId, deliveryCode: wrongCode(o.code) }, f.R2.userId!)).status).toBe(403);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).deliveryCodeAttempts).toBe(0);
    });

    it("code check needs the order out for delivery", async () => {
      const o = await assignedListOrder();
      const r = await rider({ action: "VERIFY_DELIVERY_CODE", orderId: o.orderId, deliveryCode: o.code });
      expect(r.status).toBe(400);
    });
  });

  describe("admin fallbacks", () => {
    it("reset: a new code for the customer and the admin, lock cleared, old code dead, audited", async () => {
      const o = await outForDelivery();
      await prisma.order.update({ where: { id: o.orderId }, data: { deliveryCodeAttempts: 5, deliveryCodeLockedUntil: new Date(Date.now() + 10 * 60_000) } });
      const before = await hashOf(o.orderId);

      as(f.customerA.id, "CUSTOMER");
      const notAdmin = await json(await ordersPatch(new Request("http://localhost/api/orders", { method: "PATCH", body: JSON.stringify({ action: "RESET_DELIVERY_CODE", orderId: o.orderId }) })));
      expect(notAdmin.status).toBe(403);

      const r = await admin({ action: "RESET_DELIVERY_CODE", orderId: o.orderId });
      expect(r.status).toBe(200);
      const code = r.body.data.deliveryCode as string;
      expect(code).toMatch(/^\d{4}$/);
      expect(await hashOf(o.orderId)).not.toBe(before);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ deliveryCodeAttempts: 0, deliveryCodeLockedUntil: null });
      expect((await detail(o.orderNumber)).body.data.deliveryCode.code).toBe(code);
      expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "DELIVERY_CODE" } })).toBe(2);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "DELIVERY_CODE_RESET", entityId: o.orderId } });
      expect(audit.userId).toBe(f.admin.id);
      expect(JSON.stringify(audit)).not.toContain(code);

      if (code !== o.code) expect((await deliver(o.orderId, { deliveryCode: o.code })).status).toBe(400);
      expect((await deliver(o.orderId, { deliveryCode: code })).status).toBe(200);
    });

    it("reset is refused on cart orders and on delivered orders", async () => {
      const o = await outForDelivery();
      await deliver(o.orderId, { deliveryCode: o.code });
      expect((await admin({ action: "RESET_DELIVERY_CODE", orderId: o.orderId })).status).toBe(400);
      const cart = await cartOrder();
      expect((await admin({ action: "RESET_DELIVERY_CODE", orderId: cart.id })).status).toBe(400);
    });

    it("admin marking a code order delivered is the override and is audited", async () => {
      const o = await outForDelivery();
      expect((await admin({ orderId: o.orderId, collectCash: true, amountCollected: 1150 })).status).toBe(200);
      const r = await admin({ orderId: o.orderId, orderStatus: "DELIVERED", notes: "Customer has no phone; confirmed by call" });
      expect(r.status).toBe(200);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId }, include: { delivery: true } });
      expect(row.orderStatus).toBe("DELIVERED");
      expect(row.delivery!.riderFee).not.toBeNull();
      expect((await prisma.product.findUniqueOrThrow({ where: { id: sugarId } })).stockQuantity).toBe(3);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "DELIVERY_CODE_ADMIN_OVERRIDE", entityId: o.orderId } });
      expect(audit.userId).toBe(f.admin.id);
      expect(audit.newValue).toMatchObject({ reason: "Customer has no phone; confirmed by call" });
    });
  });

  describe("store rating (H-09 … H-11)", () => {
    const post = async (body: unknown, userId = f.customerA.id) => {
      as(userId, "CUSTOMER");
      return json(await reviewsPost(new Request("http://localhost/api/store-reviews", { method: "POST", body: JSON.stringify(body) })));
    };
    const get = async (qs: string, userId = f.customerA.id) => {
      as(userId, "CUSTOMER");
      return json(await reviewsGet(new Request(`http://localhost/api/store-reviews?${qs}`)));
    };
    async function deliveredListOrder() {
      const o = await outForDelivery();
      expect((await deliver(o.orderId, { deliveryCode: o.code })).status).toBe(200);
      return o;
    }

    it("H-09 customer rates 4 stars: saved, store told, average updated", async () => {
      const o = await deliveredListOrder();
      const before = await get(`orderId=${o.orderId}`);
      expect(before.body.data).toMatchObject({ canRate: true, review: null, stores: [{ id: f.S1.id }] });

      const r = await post({ orderId: o.orderId, rating: 4, comment: "Fresh sugar, quick packing" });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ orderId: o.orderId, storeId: f.S1.id, storeName: "TEST S1", rating: 4, comment: "Fresh sugar, quick packing", storeRating: { average: 4, count: 1 } });
      const row = await prisma.storeReview.findUniqueOrThrow({ where: { orderId: o.orderId } });
      expect(row).toMatchObject({ userId: f.customerA.id, storeId: f.S1.id, rating: 4 });
      expect(await prisma.notification.count({ where: { userId: f.S1.ownerId, type: "STORE_REVIEW_NEW" } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "STORE_REVIEW_CREATED", entityId: row.id } })).toBe(1);

      const after = await get(`orderNumber=${o.orderNumber}`);
      expect(after.body.data).toMatchObject({ canRate: false, review: { rating: 4 } });
      expect((await detail(o.orderNumber)).body.data.storeReview).toMatchObject({ rating: 4, storeId: f.S1.id });
    });

    it("H-10 rating the same order again → 409", async () => {
      const o = await deliveredListOrder();
      expect((await post({ orderId: o.orderId, rating: 5 })).status).toBe(201);
      const again = await post({ orderId: o.orderId, rating: 1 });
      expect(again.status).toBe(409);
      as(f.customerA.id, "CUSTOMER");
      const alias = await json(
        await storeReviewsPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ orderId: o.orderId, rating: 1 }) }), { params: { id: f.S1.id } })
      );
      expect(alias.status).toBe(409);
      expect(await prisma.storeReview.count()).toBe(1);
    });

    it("H-11 rating before delivery → 400", async () => {
      const o = await outForDelivery();
      const r = await post({ orderId: o.orderId, rating: 4 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("NOT_DELIVERED");
      expect((await get(`orderId=${o.orderId}`)).body.data.canRate).toBe(false);
    });

    it("another customer's order → 404 (rate and view); signed out → 401; bad input → 400", async () => {
      const o = await deliveredListOrder();
      expect((await post({ orderId: o.orderId, rating: 4 }, f.customerB.id)).status).toBe(404);
      expect((await get(`orderId=${o.orderId}`, f.customerB.id)).status).toBe(404);
      expect((await post({ orderId: "nope", rating: 4 })).status).toBe(404);
      auth.session = null;
      expect((await json(await reviewsPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ orderId: o.orderId, rating: 4 }) })))).status).toBe(401);
      for (const rating of [0, 6, 2.5, "4"]) {
        const r = await post({ orderId: o.orderId, rating });
        expect(r.status).toBe(400);
        expect(r.body.fieldErrors.rating).toBe("Pick 1 to 5 stars");
      }
      expect((await get("")).status).toBe(400);
      expect(await prisma.storeReview.count()).toBe(0);
    });

    it("a cart order with two stores: the customer picks the store (one rating per order)", async () => {
      const cart = await cartOrder({ status: "DELIVERED", stores: [f.S1.id, f.S2.id] });
      const noStore = await post({ orderId: cart.id, rating: 3 });
      expect(noStore.status).toBe(400);
      expect(noStore.body.code).toBe("STORE_REQUIRED");
      expect((await post({ orderId: cart.id, rating: 3, storeId: f.S3.id })).status).toBe(400);
      const ok = await post({ orderId: cart.id, rating: 3, storeId: f.S2.id });
      expect(ok.status).toBe(201);
      expect(ok.body.data.storeId).toBe(f.S2.id);
      expect((await post({ orderId: cart.id, rating: 5, storeId: f.S1.id })).status).toBe(409);
    });

    it("the store's average and count show in the stores API and on list offers", async () => {
      const a = await cartOrder({ status: "DELIVERED" });
      const b = await cartOrder({ status: "DELIVERED" });
      expect((await post({ orderId: a.id, rating: 5 })).status).toBe(201);
      as(f.customerA.id, "CUSTOMER");
      const alias = await json(
        await storeReviewsPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ orderId: b.id, rating: 2 }) }), { params: { id: f.S1.id } })
      );
      expect(alias.status).toBe(201);
      expect(alias.body.data.storeRating).toEqual({ average: 3.5, count: 2 });

      auth.session = null;
      const list = await json(await storesGet(new NextRequest("http://localhost/api/stores")));
      expect(list.status).toBe(200);
      const byId = new Map(list.body.data.items.map((s: { id: string; rating: unknown }) => [s.id, s.rating]));
      expect(byId.get(f.S1.id)).toEqual({ average: 3.5, count: 2 });
      expect(byId.get(f.S2.id)).toEqual({ average: null, count: 0 });
      const one = await json(await storesGet(new NextRequest(`http://localhost/api/stores?slug=${f.S1.slug}`)));
      expect(one.body.data.rating).toEqual({ average: 3.5, count: 2 });

      // an open list with an offer from S1 shows the same rating
      const l = await createList(
        { id: f.customerA.id },
        createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Salt", quantity: 1, unit: "kg" }] })
      );
      await submitStoreBid({ id: f.S1.ownerId }, l.id, bidSchema.parse({ lines: [{ lineId: l.lines[0].id, available: true, unitPrice: 50 }] }));
      const offers = await offersForList(l.id);
      expect(offers[0].store).toMatchObject({ id: f.S1.id, rating: 3.5, ratingCount: 2 });
    });
  });
});
