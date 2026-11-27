/**
 * W8: rider bidding after the store packs an item-list order (test cases G-01 … G-17).
 * Customer A's list is accepted from S1 (2 km). Riders: R1 1 km from S1, R2 6 km,
 * R3 offline, R4 overdue COD cash, plus R5 30 km away and R6 with no position (Lahore).
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
import {
  POST_PACK_MAX_REOPENS,
  acceptPostPackBid,
  acceptRiderBidSchema,
  closePostPackRequest,
  openPostPackRequest,
  postPackRadiusKm,
  riderNearPickup,
  tickDuePostPackRequests,
  tickPostPackRequest,
} from "@/lib/orders/post-pack-bidding";
import { parseRiderLocation } from "@/lib/riders/location";
import { PATCH as storePatch } from "@/app/api/store/route";
import { GET as riderBidsGet, POST as riderBidsPost, DELETE as riderBidsDelete } from "@/app/api/rider/bids/route";
import { PATCH as riderPatch } from "@/app/api/rider/route";
import { PATCH as ordersPatch } from "@/app/api/orders/route";
import { GET as orderBidsGet } from "@/app/api/orders/[orderNumber]/rider-bids/route";
import { POST as acceptRoute } from "@/app/api/orders/[orderNumber]/rider-bids/[bidId]/accept/route";
import { PATCH as checkoutRequestPatch } from "@/app/api/checkout/delivery-request/route";

const KM = 1 / 111;

describe("rider distance rules (pure)", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  const store = { point: { latitude: 31.5, longitude: 74.3 }, city: "Lahore" };
  const at = (km: number, minsAgo = 1, city: string | null = "Lahore") => ({
    city,
    lastLatitude: 31.5 + km * KM,
    lastLongitude: 74.3,
    lastLocationAt: new Date(now.getTime() - minsAgo * 60_000),
  });

  it("radius doubles on the re-open", () => {
    expect(postPackRadiusKm(10, 0)).toBe(10);
    expect(postPackRadiusKm(10, 1)).toBe(20);
    expect(POST_PACK_MAX_REOPENS).toBe(1);
  });

  it("a fresh position must be inside the radius", () => {
    expect(riderNearPickup(at(1), store, 10, now)).toMatchObject({ near: true });
    expect(riderNearPickup(at(1), store, 10, now).distanceKm).toBeCloseTo(1, 0);
    expect(riderNearPickup(at(30), store, 10, now).near).toBe(false);
    // even in the same city
    expect(riderNearPickup(at(12), store, 10, now).near).toBe(false);
  });

  it("no (or an old) position falls back to the same city", () => {
    expect(riderNearPickup(at(30, 120), store, 10, now)).toEqual({ near: true, distanceKm: null });
    expect(riderNearPickup({ city: "lahore ", lastLatitude: null, lastLongitude: null, lastLocationAt: null }, store, 10, now).near).toBe(true);
    expect(riderNearPickup({ city: "Karachi", lastLatitude: null, lastLongitude: null, lastLocationAt: null }, store, 10, now).near).toBe(false);
    expect(riderNearPickup({ city: null, lastLatitude: null, lastLongitude: null, lastLocationAt: null }, store, 10, now).near).toBe(false);
  });

  it("location input is checked", () => {
    expect(parseRiderLocation({ latitude: "31.5", longitude: 74.3 })).toEqual({ latitude: 31.5, longitude: 74.3 });
    expect(parseRiderLocation({ latitude: 91, longitude: 74 })).toBeNull();
    expect(parseRiderLocation({ latitude: "x", longitude: 74 })).toBeNull();
    expect(parseRiderLocation({ latitude: 0, longitude: 0 })).toBeNull();
  });

  it("accept needs a request key", () => {
    expect(acceptRiderBidSchema.safeParse({}).success).toBe(false);
    expect(acceptRiderBidSchema.safeParse({ idempotencyKey: "k-1234567" }).success).toBe(true);
  });
});

describeDb("rider bidding after packing", () => {
  let f: Fixtures;
  let R5: { id: string; userId: string | null };
  let R6: { id: string; userId: string | null };
  let n = 0;
  const key = () => `rb-key-${++n}-${Date.now()}`;
  const as = (userId: string, role: string) => (auth.session = { user: { id: userId, role } });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });

  async function placeRider(riderId: string, kmNorthOfS1: number) {
    await prisma.rider.update({
      where: { id: riderId },
      data: { lastLatitude: f.S1.latitude! + kmNorthOfS1 * KM, lastLongitude: f.S1.longitude!, lastLocationAt: new Date() },
    });
  }

  async function extraRider(k: string, phone: string, city: string | null) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "RIDER" } });
    const u = await prisma.user.create({ data: { fullName: `Rider ${k}`, email: `rider.${k}@test.local`, phone, roleId: role.id } });
    return prisma.rider.create({
      data: { userId: u.id, name: `TEST ${k}`, phone, city, approvalStatus: "APPROVED", isActive: true, status: "AVAILABLE" },
    });
  }

  /** Customer A's list accepted from S1: 2 kg atta at Rs 500 → products Rs 1,000. */
  async function listOrder() {
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Atta", quantity: 2, unit: "kg", categoryId: grocery.id }] })
    );
    const bid = await submitStoreBid(
      { id: f.S1.ownerId },
      l.id,
      bidSchema.parse({ lines: [{ lineId: l.lines[0].id, available: true, unitPrice: 500 }] })
    );
    return acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      l.id,
      acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: key() })
    );
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

  async function readyListOrder() {
    const order = await listOrder();
    const req = await markReady(order.orderId);
    return { order, req: req! };
  }

  const riderGet = async (userId: string, qs = "") => {
    as(userId, "RIDER");
    return json(await riderBidsGet(new NextRequest(`http://localhost/api/rider/bids${qs}`)));
  };
  const riderBid = async (userId: string, requestId: string, amount: unknown, note?: string) => {
    as(userId, "RIDER");
    return json(
      await riderBidsPost(new Request("http://localhost/api/rider/bids", { method: "POST", body: JSON.stringify({ requestId, amount, note }) }))
    );
  };
  const riderWithdraw = async (userId: string, requestId: string) => {
    as(userId, "RIDER");
    return json(await riderBidsDelete(new Request(`http://localhost/api/rider/bids?requestId=${requestId}`, { method: "DELETE" })));
  };
  const customerView = async (orderNumber: string, userId = f.customerA.id) => {
    as(userId, "CUSTOMER");
    return json(await orderBidsGet(new Request("http://localhost"), { params: { orderNumber } }));
  };
  const customerAccept = async (orderNumber: string, bidId: string, body: Record<string, unknown> = { idempotencyKey: key() }, userId = f.customerA.id) => {
    as(userId, "CUSTOMER");
    return json(
      await acceptRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: { orderNumber, bidId } })
    );
  };
  const notes = (userId: string | null, type: string) => prisma.notification.count({ where: { userId: userId!, type } });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    await placeRider(f.R1.id, 1);
    await placeRider(f.R2.id, 6);
    await placeRider(f.R3.id, 1);
    await placeRider(f.R4.id, 1);
    R5 = await extraRider("r5", "03110000005", "Lahore");
    await placeRider(R5.id, 30);
    R6 = await extraRider("r6", "03110000006", "Lahore");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    auth.session = null;
  });

  describe("opening", () => {
    it("G-01 marking the list order ready opens one POST_PACK request with city, window and no customer details", async () => {
      const before = Date.now();
      const { order, req } = await readyListOrder();
      const o = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
      expect(o.orderStatus).toBe("READY_FOR_DISPATCH");
      expect(req).toMatchObject({ trigger: "POST_PACK", orderId: order.orderId, city: "Lahore", status: "OPEN", reopenCount: 0, customerId: f.customerA.id });
      const secs = (req.expiresAt.getTime() - before) / 1000;
      expect(secs).toBeGreaterThan(290);
      expect(secs).toBeLessThan(320);
      expect(req.summary).toMatchObject({ trigger: "POST_PACK", itemCount: 2, storeCount: 1, storeName: "TEST S1", drop: { city: "Lahore", area: "Model Town" } });
      expect((req.summary as { distanceKm: number }).distanceKm).toBeCloseTo(2, 0);
      const s = JSON.stringify(req.summary);
      for (const secret of ["03001234567", "House 1", "Customer A"]) expect(s).not.toContain(secret);
    });

    it("G-02 a second ready event does not open a second request", async () => {
      const { order, req } = await readyListOrder();
      const again = await prisma.$transaction((tx) => openPostPackRequest(tx, order.orderId));
      expect(again).toEqual({ isListOrder: true, created: false, requestId: req.id });
      expect(await prisma.deliveryRequest.count({ where: { orderId: order.orderId } })).toBe(1);
    });

    it("no request before the order is ready (Processing / Packed)", async () => {
      const order = await listOrder();
      const ful = await prisma.storeFulfillment.findFirstOrThrow({ where: { orderId: order.orderId } });
      as(f.S1.ownerId, "STORE_OWNER");
      for (const status of ["PROCESSING", "PACKED"]) {
        const res = await storePatch(
          new Request("http://localhost/api/store", { method: "PATCH", body: JSON.stringify({ action: "FULFILLMENT_STATUS", fulfillmentId: ful.id, status }) })
        );
        expect(res.status).toBe(200);
      }
      expect(await prisma.deliveryRequest.count()).toBe(0);
      await markReady(order.orderId);
      expect(await prisma.deliveryRequest.count()).toBe(1);
    });

    it("G-03 nearby eligible riders and the customer are notified; offline, COD-overdue and far riders are not", async () => {
      await readyListOrder();
      for (const r of [f.R1, f.R2, R6]) expect(await notes(r.userId, "NEW_DELIVERY_REQUEST")).toBe(1);
      for (const r of [f.R3, f.R4, R5]) expect(await notes(r.userId, "NEW_DELIVERY_REQUEST")).toBe(0);
      expect(await notes(f.customerA.id, "RIDER_BIDDING_OPEN")).toBe(1);
      // the generic "a rider will be assigned soon" message is for cart orders
      expect(await notes(f.customerA.id, "ORDER_READY")).toBe(0);
    });

    it("G-16 a normal cart order marked ready opens no rider bidding and keeps today's message", async () => {
      const cart = await prisma.order.create({
        data: {
          orderNumber: "ORD-CART-1",
          customerId: f.customerA.id,
          subtotal: 500,
          deliveryFee: 120,
          grandTotal: 620,
          remainingAmount: 500,
          paymentMethod: "CASH_ON_DELIVERY",
          productPaymentStatus: "CASH_ON_DELIVERY",
          deliveryFeePaymentStatus: "PAID",
          orderStatus: "CONFIRMED",
          deliveryAddressSnapshot: { city: "Lahore", area: "Model Town" },
          items: { create: { storeId: f.S1.id, storeName: "TEST S1", productName: "Rice", sku: "R1", unit: "kg", quantity: 1, unitPrice: 500, finalPrice: 500 } },
          fulfillments: { create: { storeId: f.S1.id, status: "CONFIRMED", subtotal: 500, itemCount: 1, pickupAddress: {} } },
        },
      });
      expect(await markReady(cart.id)).toBeNull();
      const o = await prisma.order.findUniqueOrThrow({ where: { id: cart.id } });
      expect(o).toMatchObject({ orderStatus: "READY_FOR_DISPATCH", riderId: null });
      expect(Number(o.deliveryFee)).toBe(120);
      expect(await prisma.deliveryRequest.count()).toBe(0);
      expect(await notes(f.customerA.id, "ORDER_READY")).toBe(1);
      expect(await notes(f.R1.userId, "NEW_DELIVERY_REQUEST")).toBe(0);
      expect((await customerView("ORD-CART-1")).status).toBe(404);
    });
  });

  describe("riders", () => {
    it("G-04 a nearby rider sees pickup area, drop area and distance, never the customer's phone or house", async () => {
      const { req } = await readyListOrder();
      const { status, body } = await riderGet(f.R1.userId!);
      expect(status).toBe(200);
      expect(body.data.eligible).toBe(true);
      const mine = body.data.requests.find((r: { id: string }) => r.id === req.id);
      expect(mine).toMatchObject({ trigger: "POST_PACK", biddingOpen: true, myBid: null, summary: { pickup: ["Model Town, Lahore"], drop: { area: "Model Town", city: "Lahore" } } });
      expect(mine.pickupDistanceKm).toBeCloseTo(1, 0);
      const s = JSON.stringify(body);
      for (const secret of ["03001234567", "House 1", "Customer A", f.customerA.id]) expect(s).not.toContain(secret);
      // no position, same city → shown without a distance
      const r6 = (await riderGet(R6.userId!)).body.data.requests.find((r: { id: string }) => r.id === req.id);
      expect(r6.pickupDistanceKm).toBeNull();
    });

    it("G-05 a rider 30 km away doesn't see it; COD-overdue rider sees nothing", async () => {
      const { req } = await readyListOrder();
      expect((await riderGet(R5.userId!)).body.data.requests.map((r: { id: string }) => r.id)).not.toContain(req.id);
      const r4 = await riderGet(f.R4.userId!);
      expect(r4.body.data).toMatchObject({ eligible: false, reason: "COD_OVERDUE", requests: [] });
    });

    it("a rider's position can be sent with the list call or as a rider action", async () => {
      const { req } = await readyListOrder();
      // R5 drives in to 2 km from the store
      const lat = f.S1.latitude! + 2 * KM;
      const seen = await riderGet(R5.userId!, `?lat=${lat}&lng=${f.S1.longitude}`);
      expect(seen.body.data.requests.map((r: { id: string }) => r.id)).toContain(req.id);
      expect((await riderGet(R5.userId!, "?lat=abc&lng=1")).status).toBe(400);

      as(R6.userId!, "RIDER");
      const ok = await riderPatch(new Request("http://localhost/api/rider", { method: "PATCH", body: JSON.stringify({ action: "UPDATE_LOCATION", latitude: 24.86, longitude: 67.0 }) }));
      expect(ok.status).toBe(200);
      const r6 = await prisma.rider.findUniqueOrThrow({ where: { id: R6.id } });
      expect(r6.lastLatitude).toBeCloseTo(24.86);
      expect(r6.lastLocationAt).not.toBeNull();
      // now in Karachi: too far
      expect((await riderGet(R6.userId!)).body.data.requests.map((r: { id: string }) => r.id)).not.toContain(req.id);
      const bad = await riderPatch(new Request("http://localhost/api/rider", { method: "PATCH", body: JSON.stringify({ action: "UPDATE_LOCATION", latitude: 200, longitude: 1 }) }));
      expect(bad.status).toBe(400);
    });

    it("G-06 R1 bids Rs 150: PENDING and the customer is told", async () => {
      const { req } = await readyListOrder();
      const r = await riderBid(f.R1.userId!, req.id, 150, "Can pick up in 10 min");
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ amount: 150, status: "PENDING" });
      expect(await notes(f.customerA.id, "RIDER_BID_NEW")).toBe(1);
      const mine = (await riderGet(f.R1.userId!)).body.data.requests.find((x: { id: string }) => x.id === req.id);
      expect(mine.myBid).toMatchObject({ amount: 150, status: "PENDING" });
    });

    it("G-07 Rs 0, negative and above Rs 10,000 are refused", async () => {
      const { req } = await readyListOrder();
      for (const amount of [0, -5, 10001, "abc"]) {
        const r = await riderBid(f.R1.userId!, req.id, amount);
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("BAD_AMOUNT");
      }
      expect(await prisma.riderBid.count()).toBe(0);
    });

    it("G-08 COD-overdue, offline and far riders get 403", async () => {
      const { req } = await readyListOrder();
      const r4 = await riderBid(f.R4.userId!, req.id, 100);
      expect(r4).toMatchObject({ status: 403, body: { code: "INELIGIBLE" } });
      expect(r4.body.error).toMatch(/COD/);
      expect((await riderBid(f.R3.userId!, req.id, 100)).status).toBe(403);
      expect(await riderBid(R5.userId!, req.id, 100)).toMatchObject({ status: 403, body: { code: "TOO_FAR" } });
      expect(await prisma.riderBid.count()).toBe(0);
    });

    it("edit and withdraw while open; withdrawn bids are hidden from the customer", async () => {
      const { order, req } = await readyListOrder();
      await riderBid(f.R1.userId!, req.id, 150);
      const edit = await riderBid(f.R1.userId!, req.id, 140);
      expect(edit.body.data).toMatchObject({ amount: 140, status: "PENDING" });
      expect(await prisma.riderBid.count()).toBe(1);
      expect(await notes(f.customerA.id, "RIDER_BID_NEW")).toBe(1); // edits don't re-notify

      const w = await riderWithdraw(f.R1.userId!, req.id);
      expect(w).toMatchObject({ status: 200, body: { data: { status: "WITHDRAWN" } } });
      expect((await customerView(order.orderNumber)).body.data.bids).toEqual([]);
      expect((await riderWithdraw(f.R1.userId!, req.id)).status).toBe(404);
      expect((await riderWithdraw(f.R2.userId!, req.id)).status).toBe(404);

      // bidding again after withdrawing is fine
      expect((await riderBid(f.R1.userId!, req.id, 160)).body.data).toMatchObject({ amount: 160, status: "PENDING" });
    });

    it("a closed window takes no new bids, but a rider who already bid may still change it", async () => {
      const { req } = await readyListOrder();
      await riderBid(f.R1.userId!, req.id, 150);
      await prisma.deliveryRequest.update({ where: { id: req.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await riderBid(f.R2.userId!, req.id, 100)).toMatchObject({ status: 409, body: { code: "EXPIRED" } });
      expect((await riderBid(f.R1.userId!, req.id, 145)).status).toBe(200);
      // R1 still sees it (has a bid), R2 doesn't
      expect((await riderGet(f.R1.userId!)).body.data.requests.map((r: { id: string }) => r.id)).toContain(req.id);
      expect((await riderGet(f.R2.userId!)).body.data.requests.map((r: { id: string }) => r.id)).not.toContain(req.id);
    });
  });

  describe("customer", () => {
    it("G-09 the customer sees bids cheapest first with vehicle and deliveries, and no rider phone", async () => {
      const { order, req } = await readyListOrder();
      await riderBid(f.R1.userId!, req.id, 150);
      await riderBid(f.R2.userId!, req.id, 120);
      const { status, body } = await customerView(order.orderNumber);
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ orderStatus: "READY_FOR_DISPATCH", deliveryFee: null, assignedRider: null, request: { status: "OPEN", biddingOpen: true, needsAdmin: false } });
      expect(body.data.bids.map((b: { amount: number }) => b.amount)).toEqual([120, 150]);
      expect(body.data.bids[0].rider).toEqual({ name: "TEST R2", vehicleType: "Bike", photoUrl: null, completedDeliveries: 0, rating: null });
      const s = JSON.stringify(body);
      for (const secret of [f.R1.phone, f.R2.phone, f.R1.id, f.R2.id]) expect(s).not.toContain(secret);
    });

    it("K another customer gets 404 for the bids and for accepting", async () => {
      const { order, req } = await readyListOrder();
      const bid = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      expect((await customerView(order.orderNumber, f.customerB.id)).status).toBe(404);
      expect((await customerAccept(order.orderNumber, bid, { idempotencyKey: key() }, f.customerB.id)).status).toBe(404);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).riderId).toBeNull();
    });

    it("G-10 / G-17 accept R1: rider assigned, fee 150 in cash with products, ledger, notifications, audit", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      const b2 = (await riderBid(f.R2.userId!, req.id, 120)).body.data.bidId;

      const r = await customerAccept(order.orderNumber, b1, { idempotencyKey: key(), expectedAmount: 150 });
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({
        reused: false,
        orderStatus: "ASSIGNED_TO_RIDER",
        deliveryFee: 150,
        grandTotal: 1150,
        remainingAmount: 1150,
        deliveryFeePaymentStatus: "CASH_ON_DELIVERY",
        rider: { name: "TEST R1", phone: f.R1.phone },
      });

      const o = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, include: { delivery: true, fulfillments: true } });
      expect(o).toMatchObject({ orderStatus: "ASSIGNED_TO_RIDER", riderId: f.R1.id, deliveryFeePaymentStatus: "CASH_ON_DELIVERY", paymentMethod: "CASH_ON_DELIVERY" });
      expect([Number(o.deliveryFee), Number(o.grandTotal), Number(o.remainingAmount)]).toEqual([150, 1150, 1150]);
      expect(o.delivery).toMatchObject({ riderId: f.R1.id });
      expect(o.delivery!.assignedAt).not.toBeNull();
      expect(o.fulfillments.map((x) => x.status)).toEqual(["ASSIGNED_TO_RIDER"]);

      const dr = await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } });
      expect(dr).toMatchObject({ status: "ASSIGNED", acceptedBidId: b1, acceptedRiderId: f.R1.id });
      expect(Number(dr.acceptedFee)).toBe(150);
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b1 } })).status).toBe("ACCEPTED");
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b2 } })).status).toBe("REJECTED");

      const earning = await prisma.ledgerEntry.findMany({ where: { orderId: order.orderId, type: "RIDER_EARNING" } });
      expect(earning).toHaveLength(1);
      expect(earning[0]).toMatchObject({ riderId: f.R1.id, refType: "rider_bid", refId: b1 });
      expect(Number(earning[0].amount)).toBe(150);

      const ev = await prisma.orderStatusEvent.findFirst({ where: { orderId: order.orderId, status: "ASSIGNED_TO_RIDER" } });
      expect(ev).toMatchObject({ actorId: f.customerA.id, actorRole: "CUSTOMER" });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "RIDER_BID_ACCEPTED", entityId: order.orderId } });
      expect(audit.newValue).toMatchObject({ bidId: b1, riderId: f.R1.id, deliveryFee: 150, rejected: 1 });

      expect(await notes(f.R1.userId, "BID_ACCEPTED")).toBe(1);
      expect(await prisma.notification.count({ where: { userId: f.R1.userId!, type: "RIDER_ASSIGNED", channel: "IN_APP" } })).toBe(1);
      expect(await notes(f.R2.userId, "RIDER_BID_NOT_SELECTED")).toBe(1);
      expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "ORDER_STATUS", title: "Rider assigned" } })).toBe(1);
      expect(await notes(f.S1.ownerId, "RIDER_ASSIGNED_STORE")).toBe(1);

      // the customer now sees who's coming, with the phone
      const v = (await customerView(order.orderNumber)).body.data;
      expect(v).toMatchObject({ deliveryFee: 150, assignedRider: { name: "TEST R1", phone: f.R1.phone }, request: { status: "ASSIGNED" } });
      // R1 is now busy: no more bidding elsewhere
      expect((await riderGet(f.R1.userId!)).body.data).toMatchObject({ eligible: false, reason: "BUSY" });
    });

    it("idempotent: accepting the winning bid again returns the same result; another bid → 409", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      const b2 = (await riderBid(f.R2.userId!, req.id, 120)).body.data.bidId;
      const k = key();
      const first = await customerAccept(order.orderNumber, b1, { idempotencyKey: k });
      const again = await customerAccept(order.orderNumber, b1, { idempotencyKey: k });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ ...first.body.data, reused: true });
      const other = await customerAccept(order.orderNumber, b2);
      expect(other).toMatchObject({ status: 409, body: { code: "ALREADY_ASSIGNED" } });
      expect(await prisma.ledgerEntry.count({ where: { orderId: order.orderId, type: "RIDER_EARNING" } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "RIDER_BID_ACCEPTED" } })).toBe(1);
      expect((await customerAccept(order.orderNumber, b1, {})).status).toBe(400); // key required
    });

    it("G-11 two accepts at once on one order: one wins, the other 409", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      const b2 = (await riderBid(f.R2.userId!, req.id, 120)).body.data.bidId;
      const results = await Promise.allSettled([
        acceptPostPackBid({ id: f.customerA.id }, order.orderNumber, b1, { idempotencyKey: key() }),
        acceptPostPackBid({ id: f.customerA.id }, order.orderNumber, b2, { idempotencyKey: key() }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect(bad[0].reason).toMatchObject({ status: 409 });
      expect(await prisma.riderBid.count({ where: { status: "ACCEPTED" } })).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { orderId: order.orderId, type: "RIDER_EARNING" } })).toBe(1);
    });

    it("G-13 one rider accepted on two orders at the same moment wins only one", async () => {
      const a = await readyListOrder();
      const b = await readyListOrder();
      const bidA = (await riderBid(f.R1.userId!, a.req.id, 150)).body.data.bidId;
      const bidB = (await riderBid(f.R1.userId!, b.req.id, 130)).body.data.bidId;
      const results = await Promise.allSettled([
        acceptPostPackBid({ id: f.customerA.id }, a.order.orderNumber, bidA, { idempotencyKey: key() }),
        acceptPostPackBid({ id: f.customerA.id }, b.order.orderNumber, bidB, { idempotencyKey: key() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ status: 409, code: "RIDER_GONE" });
      expect(await prisma.order.count({ where: { riderId: f.R1.id } })).toBe(1);
    });

    it("G-12 rider went offline before the accept: 409 and the bid is EXPIRED", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      await prisma.rider.update({ where: { id: f.R1.id }, data: { status: "OFFLINE" } });
      const r = await customerAccept(order.orderNumber, b1);
      expect(r).toMatchObject({ status: 409, body: { code: "RIDER_GONE" } });
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b1 } })).status).toBe("EXPIRED");
      const o = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
      expect(o).toMatchObject({ orderStatus: "READY_FOR_DISPATCH", riderId: null });
      expect(Number(o.deliveryFee)).toBe(0);
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");
    });

    it("the bid amount changed since the customer looked → 409", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      await riderBid(f.R1.userId!, req.id, 190);
      expect(await customerAccept(order.orderNumber, b1, { idempotencyKey: key(), expectedAmount: 150 })).toMatchObject({ status: 409, body: { code: "BID_CHANGED" } });
      expect((await customerAccept(order.orderNumber, "nope", { idempotencyKey: key() })).status).toBe(404);
    });
  });

  describe("timers", () => {
    const expire = (id: string) => prisma.deliveryRequest.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    it("G-14 no bids: re-opened once with a wider radius, then handed to admin with customer and store told", async () => {
      const { order, req } = await readyListOrder();
      // R7 at 15 km: outside 10 km, inside the widened 20 km
      const R7 = await extraRider("r7", "03110000007", "Lahore");
      await placeRider(R7.id, 15);
      expect((await riderGet(R7.userId!)).body.data.requests).toHaveLength(0);

      await expire(req.id);
      // the customer opening the order runs the timer (lazy)
      const v = (await customerView(order.orderNumber)).body.data;
      expect(v.request).toMatchObject({ status: "OPEN", reopenCount: 1, biddingOpen: true });
      expect(await notes(f.R1.userId, "NEW_DELIVERY_REQUEST")).toBe(2);
      expect(await notes(R7.userId, "NEW_DELIVERY_REQUEST")).toBe(1);
      expect((await riderGet(R7.userId!)).body.data.requests.map((r: { id: string }) => r.id)).toEqual([req.id]);
      expect(await prisma.auditLog.count({ where: { action: "RIDER_BIDDING_REOPENED", entityId: req.id } })).toBe(1);

      await expire(req.id);
      expect(await tickPostPackRequest(req.id)).toBe("GAVE_UP");
      expect(await tickPostPackRequest(req.id)).toBe("CLOSED");
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("NO_BIDS");
      expect(await notes(f.customerA.id, "RIDER_BIDDING_NO_BIDS")).toBe(1);
      expect(await notes(f.S1.ownerId, "RIDER_BIDDING_NO_BIDS")).toBe(1);
      expect(await notes(f.admin.id, "ORDER_NEEDS_RIDER")).toBe(1);
      expect((await customerView(order.orderNumber)).body.data.request).toMatchObject({ status: "NO_BIDS", needsAdmin: true });
      // order is still ready, waiting for the admin's manual "Assign rider"
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).orderStatus).toBe("READY_FOR_DISPATCH");
      expect((await riderBid(f.R1.userId!, req.id, 150)).status).toBe(409);
    });

    it("the daily cron and the lists-tick cron run the same timer", async () => {
      const { req } = await readyListOrder();
      await expire(req.id);
      expect(await tickDuePostPackRequests()).toMatchObject({ checked: 1, REOPENED: 1 });
      await expire(req.id);
      vi.stubEnv("CRON_SECRET", "s3cret");
      const { GET } = await import("@/app/api/cron/lists-tick/route");
      const res = await GET(new NextRequest("http://x/api/cron/lists-tick", { headers: { authorization: "Bearer s3cret" } }));
      expect(res.status).toBe(200);
      expect((await res.json()).data.riderBids).toMatchObject({ checked: 1, GAVE_UP: 1 });
      const daily = await import("@/app/api/cron/expire-pending-payments/route");
      const d = await daily.GET(new NextRequest("http://x/api/cron/expire-pending-payments", { headers: { authorization: "Bearer s3cret" } }));
      expect((await d.json()).data.riderBids).toMatchObject({ checked: 0 });
    });

    it("bids waiting when the window ends: kept open for the customer to choose", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      await expire(req.id);
      expect(await tickPostPackRequest(req.id)).toBe("WAITING_FOR_CHOICE");
      expect((await customerAccept(order.orderNumber, b1)).status).toBe(201);
    });

    it("G-15 admin's manual Assign rider works as today and closes the open bids", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      as(f.admin.id, "SUPER_ADMIN");
      const res = await ordersPatch(
        new Request("http://localhost/api/orders", { method: "PATCH", body: JSON.stringify({ action: "ASSIGN_RIDER", orderId: order.orderId, riderId: f.R2.id }) })
      );
      expect(res.status).toBe(200);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).toMatchObject({ orderStatus: "ASSIGNED_TO_RIDER", riderId: f.R2.id });
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CANCELLED");
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b1 } })).status).toBe("REJECTED");
      expect((await customerAccept(order.orderNumber, b1)).status).toBe(409);
    });

    it("G-15 a rider assigned by admin (or a cancelled order) closes the open bids", async () => {
      const { order, req } = await readyListOrder();
      const b2 = (await riderBid(f.R2.userId!, req.id, 120)).body.data.bidId;
      await prisma.$transaction((tx) => closePostPackRequest(tx, order.orderId));
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CANCELLED");
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b2 } })).status).toBe("REJECTED");

      const other = await readyListOrder();
      await prisma.order.update({ where: { id: other.order.orderId }, data: { orderStatus: "CANCELLED" } });
      expect(await tickPostPackRequest(other.req.id)).toBe("CLOSED");
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: other.req.id } })).status).toBe("CANCELLED");
    });
  });
  describe("security review M1: checkout accept/cancel cannot touch after-packing requests", () => {
    const checkoutPatch = async (body: Record<string, unknown>) => {
      as(f.customerA.id, "CUSTOMER");
      return json(
        await checkoutRequestPatch(
          new Request("http://localhost/api/checkout/delivery-request", { method: "PATCH", body: JSON.stringify(body) })
        )
      );
    };

    it("M1 PATCH /api/checkout/delivery-request accept on a POST_PACK bid is NOT_FOUND and changes nothing", async () => {
      const { order, req } = await readyListOrder();
      const b1 = (await riderBid(f.R1.userId!, req.id, 150)).body.data.bidId;
      const res = await checkoutPatch({ action: "accept", bidId: b1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_FOUND");
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");
      expect((await prisma.riderBid.findUniqueOrThrow({ where: { id: b1 } })).status).toBe("PENDING");
      // the order's own accept flow still works afterwards
      expect((await customerAccept(order.orderNumber, b1)).status).toBe(201);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).riderId).toBe(f.R1.id);
    });

    it("M1 PATCH /api/checkout/delivery-request cancel leaves a POST_PACK request open", async () => {
      const { req } = await readyListOrder();
      const res = await checkoutPatch({ action: "cancel", requestId: req.id });
      expect(res.status).toBe(200);
      expect((await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");
    });
  });
});
