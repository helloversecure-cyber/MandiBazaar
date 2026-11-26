/**
 * W7: the customer compares store offers and accepts one → a normal order
 * (test cases E-01 … E-12, E-14 API part, F-01 regression for list orders).
 * S1 and S2 get the standard 3-line grocery list; S1 bids on everything, S2 on 2 of 3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return { ...real, getSession: async () => auth.session, requireAuth: need, requireStorePortal: need };
});

import { createList, getCustomerList, updateList } from "@/lib/lists/service";
import { createListSchema, updateListSchema } from "@/lib/lists/validation";
import { bidSchema, submitBid, withdrawBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { compareOffers, tagOffers, type CustomerOffer } from "@/lib/lists/offers";
import { POST as acceptRoute } from "@/app/api/lists/[id]/accept/route";
import { GET as listGetRoute } from "@/app/api/lists/[id]/route";
import { GET as storeGetRoute } from "@/app/api/store/route";
import { NextRequest } from "next/server";

describe("offer tags and order (pure)", () => {
  const offer = (p: Partial<CustomerOffer>): CustomerOffer =>
    ({ status: "PENDING", acceptable: true, coveredCount: 3, total: 1000, prepMinutes: 30, submittedAt: new Date(0), tags: [], ...p }) as CustomerOffer;

  it("E-02 900 / 30 min is Fastest, 850 / 60 min is Lowest price", () => {
    const [a, b] = tagOffers([offer({ total: 900, prepMinutes: 30 }), offer({ total: 850, prepMinutes: 60 })]);
    expect(a.tags).toEqual(["FASTEST"]);
    expect(b.tags).toEqual(["LOWEST_PRICE"]);
  });

  it("no tags with a single offer; offers needing an update get none", () => {
    expect(tagOffers([offer({})])[0].tags).toEqual([]);
    const r = tagOffers([offer({ total: 10, acceptable: false }), offer({ total: 20 }), offer({ total: 30, prepMinutes: 10 })]);
    expect(r[0].tags).toEqual([]);
    expect(r[1].tags).toEqual(["LOWEST_PRICE"]);
    expect(r[2].tags).toEqual(["FASTEST"]);
  });

  it("sort: acceptable before outdated, full coverage first, then cheapest", () => {
    const list = [
      offer({ total: 500, coveredCount: 2 }),
      offer({ total: 100, acceptable: false }),
      offer({ total: 900, coveredCount: 3 }),
      offer({ total: 800, coveredCount: 3 }),
    ].sort(compareOffers);
    expect(list.map((o) => o.total)).toEqual([800, 900, 500, 100]);
  });

  it("accept input needs an offer, an address and a request key", () => {
    expect(acceptOfferSchema.safeParse({ bidId: "b", addressId: "a" }).success).toBe(false);
    expect(acceptOfferSchema.safeParse({ bidId: "b", addressId: "a", idempotencyKey: "k-123456" }).success).toBe(true);
  });
});

describeDb("accept a store offer", () => {
  let f: Fixtures;
  let listId: string;
  let lineIds: string[];
  let s1Bid: string;
  let s2Bid: string;
  const owner = (s: { ownerId: string }) => ({ id: s.ownerId });
  const A = () => ({ id: f.customerA.id, email: f.customerA.email });
  let keyN = 0;
  const key = () => `test-key-${++keyN}-${Date.now()}`;
  const accept = (bidId: string, extra: Record<string, unknown> = {}) =>
    acceptOffer(A(), listId, acceptOfferSchema.parse({ bidId, addressId: f.addressA.id, idempotencyKey: key(), ...extra }));

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({
        addressId: f.addressA.id,
        note: "Ring the bell",
        lines: [
          { name: "Atta", quantity: 10, unit: "kg", categoryId: grocery.id },
          { name: "Milk", quantity: 2, unit: "L" },
          { name: "Daal", quantity: 1.5, unit: "kg" },
        ],
      })
    );
    listId = l.id;
    lineIds = l.lines.map((x) => x.id);
    s1Bid = (
      await submitBid(
        owner(f.S1),
        listId,
        bidSchema.parse({
          lines: lineIds.map((lineId, i) => ({ lineId, available: true, unitPrice: [180, 230, 400][i] })),
          discount: 60,
          prepMinutes: 30,
          note: "Fresh stock",
        })
      )
    ).id;
    s2Bid = (
      await submitBid(
        owner(f.S2),
        listId,
        bidSchema.parse({
          lines: [
            { lineId: lineIds[0], available: true, unitPrice: 175 },
            { lineId: lineIds[1], available: false },
            { lineId: lineIds[2], available: true, unitPrice: 390 },
          ],
          prepMinutes: 20,
        })
      )
    ).id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    auth.session = null;
  });

  it("E-01 the owner sees both offers with totals, coverage, missing items, prep time, fee estimate and rating", async () => {
    const old = await prisma.order.create({
      data: {
        orderNumber: "ORD-OLD-1",
        customerId: f.customerB.id,
        subtotal: 1,
        deliveryFee: 0,
        grandTotal: 1,
        remainingAmount: 0,
        paymentMethod: "CASH_ON_DELIVERY",
        deliveryAddressSnapshot: {},
      },
    });
    await prisma.storeReview.create({ data: { storeId: f.S1.id, userId: f.customerB.id, rating: 4, orderId: old.id } });
    const v = await getCustomerList(A(), listId);
    expect(v.offers).toHaveLength(2);
    const [first, second] = v.offers;
    // full coverage first
    expect(first).toMatchObject({
      bidId: s1Bid,
      acceptable: true,
      coveredCount: 3,
      lineCount: 3,
      fullCoverage: true,
      itemsTotal: 2860,
      discount: 60,
      total: 2800,
      prepMinutes: 30,
      note: "Fresh stock",
      missingItems: [],
      store: { name: "TEST S1", rating: 4, ratingCount: 1 },
    });
    expect(first.estimatedDeliveryFee).toBeGreaterThan(0);
    expect(first.distanceKm).toBeCloseTo(2, 0);
    expect(second).toMatchObject({ bidId: s2Bid, coveredCount: 2, total: 2335, missingItems: ["Milk"], fullCoverage: false });
    expect(second.lines[1]).toMatchObject({ name: "Milk", available: false, unitPrice: null, lineTotal: null });
    expect(second.lines[2]).toMatchObject({ name: "Daal", available: true, unitPrice: 390, lineTotal: 585 });
    expect(second.tags).toEqual(expect.arrayContaining(["LOWEST_PRICE", "FASTEST"]));
  });

  it("offers hide store-private fields and withdrawn offers", async () => {
    await prisma.store.update({
      where: { id: f.S1.id },
      data: { phone: "03211112222", bankAccountNumber: "PK00SECRET1234", commissionOverride: 3 },
    });
    await withdrawBid(owner(f.S2), listId);
    const v = await getCustomerList(A(), listId);
    expect(v.offers.map((o) => o.bidId)).toEqual([s1Bid]);
    const json = JSON.stringify(v.offers);
    for (const secret of ["03211112222", "PK00SECRET1234", f.S1.ownerId, "commission", "listVersion", "Main Market"]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(v.offers[0].store).sort()).toEqual(["area", "city", "id", "logoUrl", "name", "rating", "ratingCount", "slug"]);
  });

  it("E-06 / K-04 another customer can't see the offers or accept them", async () => {
    await expect(getCustomerList({ id: f.customerB.id }, listId)).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptOffer({ id: f.customerB.id }, listId, acceptOfferSchema.parse({ bidId: s1Bid, addressId: f.addressA.id, idempotencyKey: key() }))
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("E-03 accept S1: one order, items at S1's prices, COD, no delivery fee yet, bids and list closed", async () => {
    const r = await accept(s1Bid);
    expect(r).toMatchObject({
      reused: false,
      listId,
      orderStatus: "CONFIRMED",
      storeId: f.S1.id,
      storeName: "TEST S1",
      subtotal: 2860,
      discount: 60,
      productTotal: 2800,
      deliveryFee: null,
      deliveryFeePending: true,
      paymentMethod: "CASH_ON_DELIVERY",
      productPaymentStatus: "CASH_ON_DELIVERY",
      itemCount: 3,
      droppedItems: [],
    });
    expect(r.orderNumber).toMatch(/^ORD-\d{8}-\d{6}$/); // E-08 same generator as checkout

    const o = await prisma.order.findUniqueOrThrow({
      where: { id: r.orderId },
      include: { items: { orderBy: { createdAt: "asc" } }, fulfillments: true, itemList: true, statusEvents: true },
    });
    expect(o).toMatchObject({ customerId: f.customerA.id, orderStatus: "CONFIRMED", deliveryFeePaymentStatus: "PENDING", productPaymentStatus: "CASH_ON_DELIVERY", riderId: null, notes: "Ring the bell" });
    expect(Number(o.deliveryFee)).toBe(0);
    expect(Number(o.grandTotal)).toBe(2800);
    expect(Number(o.remainingAmount)).toBe(2800);
    expect(o.itemList?.id).toBe(listId);
    expect((o.deliveryAddressSnapshot as { houseBuilding: string }).houseBuilding).toBe("House 1");

    const items = o.items.map((i) => [i.productName, i.quantity, i.unit, Number(i.unitPrice), Number(i.finalPrice), i.storeId]);
    expect(items.map((x) => x.slice(0, 4))).toEqual([
      ["Atta", 10, "kg", 180],
      ["Milk", 2, "L", 230],
      ["Daal", 1, "1.5 kg", 600], // fractional quantity → 1 × "1.5 kg" at the line price
    ]);
    expect(o.items.every((i) => i.storeId === f.S1.id && i.productId === null)).toBe(true);
    // the store's discount is spread over the items; finalPrice is what the store is paid
    expect(o.items.reduce((s, i) => s + Number(i.discount), 0)).toBeCloseTo(60, 2);
    expect(o.items.reduce((s, i) => s + Number(i.finalPrice), 0)).toBeCloseTo(2800, 2);

    expect(o.fulfillments).toHaveLength(1);
    expect(o.fulfillments[0]).toMatchObject({ storeId: f.S1.id, status: "CONFIRMED" });
    expect(Number(o.fulfillments[0].subtotal)).toBe(2800);

    // E-11 status history
    expect(o.statusEvents).toHaveLength(1);
    expect(o.statusEvents[0]).toMatchObject({ status: "CONFIRMED", actorId: f.customerA.id, actorRole: "CUSTOMER", note: "Accepted bid from TEST S1" });

    const list = await prisma.itemList.findUniqueOrThrow({ where: { id: listId } });
    expect(list).toMatchObject({ status: "ACCEPTED", acceptedBidId: s1Bid, orderId: r.orderId });
    const bids = await prisma.storeBid.findMany({ where: { listId } });
    expect(Object.fromEntries(bids.map((b) => [b.id, b.status]))).toEqual({ [s1Bid]: "ACCEPTED", [s2Bid]: "NOT_SELECTED" });

    // E-09 ledger snapshot like a COD cart order (5% commission on what the store is paid), no rider yet
    const ledger = await prisma.ledgerEntry.findMany({ where: { orderId: r.orderId } });
    const byType = Object.fromEntries(ledger.map((e) => [e.type, Number(e.amount)]));
    expect(byType).toEqual({ SALE: 2800, COMMISSION: -140, STORE_EARNING: 2660 });

    // the list view now shows the order and the accepted offer first
    const v = await getCustomerList(A(), listId);
    expect(v.orderNumber).toBe(r.orderNumber);
    expect(v.offers[0]).toMatchObject({ bidId: s1Bid, status: "ACCEPTED", acceptable: false });
    expect(v.offers[1]).toMatchObject({ status: "NOT_SELECTED", acceptable: false });
  });

  it("E-10 notifications: winner, the store not chosen, and the customer; E-11 audit row", async () => {
    const r = await accept(s1Bid);
    const won = await prisma.notification.findFirstOrThrow({ where: { userId: f.S1.ownerId, type: "BID_ACCEPTED" } });
    expect(won).toMatchObject({ title: "Customer accepted your bid", orderId: r.orderId, status: "SENT" });
    expect(won.body).toContain(r.orderNumber);
    const lost = await prisma.notification.findFirstOrThrow({ where: { userId: f.S2.ownerId, type: "BID_NOT_SELECTED" } });
    expect(lost.title).toBe("Your offer wasn't chosen");
    expect(lost.body).not.toContain("2800");
    const cust = await prisma.notification.findFirstOrThrow({ where: { userId: f.customerA.id, type: "ORDER_CONFIRMED", orderId: r.orderId } });
    expect(cust.title).toBe("Order placed");
    expect(cust.body).toContain(r.orderNumber);
    // the store also gets the usual "New order" message like any order
    expect(await prisma.notification.count({ where: { userId: f.S1.ownerId, type: "STORE_NEW_ORDER", orderId: r.orderId } })).toBe(1);
    // S3 never bid → nothing
    expect(await prisma.notification.count({ where: { userId: f.S3.ownerId, type: { in: ["BID_ACCEPTED", "BID_NOT_SELECTED"] } } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "LIST_OFFER_ACCEPTED", entityId: listId } });
    expect(audit.userId).toBe(f.customerA.id);
    expect(audit.newValue).toMatchObject({ bidId: s1Bid, storeId: f.S1.id, orderId: r.orderId, orderNumber: r.orderNumber, productTotal: 2800, notSelected: 1 });
  });

  it("E-04 accept S2 (2 of 3): the missing item is dropped", async () => {
    const r = await accept(s2Bid);
    expect(r).toMatchObject({ itemCount: 2, droppedItems: ["Milk"], subtotal: 2335, discount: 0, productTotal: 2335 });
    const items = await prisma.orderItem.findMany({ where: { orderId: r.orderId } });
    expect(items.map((i) => i.productName).sort()).toEqual(["Atta", "Daal"]);
    expect(items.every((i) => i.storeId === f.S2.id)).toBe(true);
  });

  it("same idempotency key → same order, nothing created twice", async () => {
    const k = key();
    const body = acceptOfferSchema.parse({ bidId: s1Bid, addressId: f.addressA.id, idempotencyKey: k });
    const a = await acceptOffer(A(), listId, body);
    const b = await acceptOffer(A(), listId, body);
    expect(b).toMatchObject({ reused: true, orderId: a.orderId, orderNumber: a.orderNumber, itemCount: 3, droppedItems: [] });
    // parallel retries with one key also give one order
    const [c, d] = await Promise.all([acceptOffer(A(), listId, body), acceptOffer(A(), listId, body)]);
    expect([c.orderId, d.orderId]).toEqual([a.orderId, a.orderId]);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.notification.count({ where: { type: "BID_ACCEPTED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "LIST_OFFER_ACCEPTED" } })).toBe(1);
  });

  it("same key with a different first attempt: the second request is told the list already became an order", async () => {
    await accept(s1Bid);
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "ORDER_PLACED", status: 409 });
  });

  it("E-05 two accepts for different bids at the same moment: exactly one order, the other 409", async () => {
    const results = await Promise.allSettled([accept(s1Bid), accept(s2Bid), accept(s1Bid)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const fl of failed) expect(fl.reason).toMatchObject({ status: 409 });
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.storeFulfillment.count()).toBe(1);
    expect(await prisma.storeBid.count({ where: { listId, status: "ACCEPTED" } })).toBe(1);
  });

  it("E-07 an offer made before the customer edited the list can't be accepted", async () => {
    await updateList(A(), listId, updateListSchema.parse({ lines: [{ id: lineIds[0], name: "Atta", quantity: 20, unit: "kg" }] }));
    const v = await getCustomerList(A(), listId);
    expect(v.offers.every((o) => o.needsUpdate && !o.acceptable)).toBe(true);
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "OFFER_OUTDATED", status: 409, message: expect.stringContaining("Store is updating this offer") });
    expect(await prisma.order.count()).toBe(0);
  });

  it("a stale listVersion or a changed offer total is refused", async () => {
    await expect(accept(s1Bid, { listVersion: 99 })).rejects.toMatchObject({ code: "LIST_CHANGED", status: 409 });
    await expect(accept(s1Bid, { expectedTotal: 2700 })).rejects.toMatchObject({ code: "OFFER_CHANGED", status: 409 });
    await expect(accept(s1Bid, { listVersion: 1, expectedTotal: 2800 })).resolves.toMatchObject({ productTotal: 2800 });
  });

  it("withdrawn offers and offers from another list are refused", async () => {
    await withdrawBid(owner(f.S2), listId);
    await expect(accept(s2Bid)).rejects.toMatchObject({ code: "OFFER_UNAVAILABLE", status: 409 });
    await expect(accept("not-a-bid")).rejects.toMatchObject({ code: "OFFER_NOT_FOUND", status: 404 });
  });

  it("a store suspended after bidding can't be chosen", async () => {
    await prisma.store.update({ where: { id: f.S1.id }, data: { status: "SUSPENDED" } });
    expect((await getCustomerList(A(), listId)).offers.find((o) => o.bidId === s1Bid)?.acceptable).toBe(false);
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "STORE_UNAVAILABLE", status: 409 });
  });

  it("a list that isn't bidding any more is refused (cancelled, expired)", async () => {
    await prisma.itemList.update({ where: { id: listId }, data: { status: "CANCELLED" } });
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "LIST_CLOSED", status: 409 });
    await prisma.itemList.update({ where: { id: listId }, data: { status: "BIDDING", expiresAt: new Date(Date.now() - 1000) } });
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "LIST_CLOSED", status: 409 });
    expect(await prisma.order.count()).toBe(0);
  });

  it("an address that isn't the customer's is refused", async () => {
    const other = await prisma.address.create({
      data: { userId: f.customerB.id, fullName: "B", phone: "03007654321", houseBuilding: "House 9", area: "Gulberg", city: "Lahore", province: "Punjab" },
    });
    await expect(accept(s1Bid, { addressId: other.id })).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND", status: 404 });
    expect(await prisma.order.count()).toBe(0);
  });

  it("E-12 below the minimum order: 400 with checkout's message", async () => {
    await prisma.storeSettings.updateMany({ data: { minimumOrderAmount: 5000 } });
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "MIN_ORDER", status: 400, message: "Minimum order is Rs 5,000 — add Rs 2,140 more" });
  });

  it("feature switched off (and not a beta tester) → refused", async () => {
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: false } });
    await expect(accept(s1Bid)).rejects.toMatchObject({ code: "FEATURE_OFF", status: 403 });
    vi.stubEnv("LIST_BIDDING_BETA_EMAILS", f.customerA.email!);
    await expect(accept(s1Bid)).resolves.toMatchObject({ orderStatus: "CONFIRMED" });
  });

  it("a catalog line that is the winning store's own product keeps the link and reserves stock", async () => {
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const sugar = await prisma.product.create({
      data: { storeId: f.S1.id, categoryId: grocery.id, name: "Sugar", slug: "sugar", sku: "SUG-1", price: 150, unit: "kg", status: "ACTIVE", stockQuantity: 5 },
    });
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Sugar", quantity: 2, unit: "kg", productId: sugar.id }, { name: "Eggs", quantity: 12, unit: "pcs" }] })
    );
    const bid = await submitBid(
      owner(f.S1),
      l.id,
      bidSchema.parse({ lines: l.lines.map((x, i) => ({ lineId: x.id, available: true, unitPrice: [140, 25][i] })) })
    );
    const r = await acceptOffer(A(), l.id, acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: key() }));
    const items = await prisma.orderItem.findMany({ where: { orderId: r.orderId }, orderBy: { productName: "asc" } });
    expect(items.map((i) => [i.productName, i.productId, Number(i.unitPrice)])).toEqual([
      ["Eggs", null, 25],
      ["Sugar", sugar.id, 140], // bid price, not the catalog price
    ]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: sugar.id } })).reservedStock).toBe(2);
  });

  describe("HTTP routes", () => {
    const req = (body: unknown) =>
      new Request(`http://localhost/api/lists/${listId}/accept`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

    it("K-01 accept needs sign-in", async () => {
      const res = await acceptRoute(req({ bidId: s1Bid, addressId: f.addressA.id, idempotencyKey: key() }), { params: { id: listId } });
      expect(res.status).toBe(401);
    });

    it("400 on bad input, 201 then 200 (reused) for the same key, 409 for a second offer", async () => {
      auth.session = { user: { id: f.customerA.id, email: f.customerA.email, role: "CUSTOMER" } };
      const bad = await acceptRoute(req({ bidId: s1Bid }), { params: { id: listId } });
      expect(bad.status).toBe(400);
      const k = key();
      const first = await acceptRoute(req({ bidId: s1Bid, addressId: f.addressA.id, idempotencyKey: k }), { params: { id: listId } });
      expect(first.status).toBe(201);
      const firstBody = await first.json();
      expect(firstBody).toMatchObject({ success: true, data: { reused: false, orderStatus: "CONFIRMED", deliveryFeePending: true } });
      const again = await acceptRoute(req({ bidId: s1Bid, addressId: f.addressA.id, idempotencyKey: k }), { params: { id: listId } });
      expect(again.status).toBe(200);
      expect((await again.json()).data.orderId).toBe(firstBody.data.orderId);
      const other = await acceptRoute(req({ bidId: s2Bid, addressId: f.addressA.id, idempotencyKey: key() }), { params: { id: listId } });
      expect(other.status).toBe(409);
      expect(await other.json()).toMatchObject({ success: false, code: "ORDER_PLACED" });
    });

    it("GET /api/lists/:id returns the offers to the owner only", async () => {
      auth.session = { user: { id: f.customerA.id, role: "CUSTOMER" } };
      const res = await listGetRoute(new Request("http://localhost"), { params: { id: listId } });
      expect(res.status).toBe(200);
      expect((await res.json()).data.offers).toHaveLength(2);
      auth.session = { user: { id: f.customerB.id, role: "CUSTOMER" } };
      expect((await listGetRoute(new Request("http://localhost"), { params: { id: listId } })).status).toBe(404);
    });

    it("E-14 / F-01 the accepted list shows up in the store's normal orders view, ready to prepare", async () => {
      const r = await accept(s1Bid);
      auth.session = { user: { id: f.S1.ownerId, role: "STORE_OWNER" } };
      for (const tab of ["all", "prepare"]) {
        const res = await storeGetRoute(new NextRequest(`http://localhost/api/store?resource=orders&tab=${tab}`));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.items.map((x: { order: { orderNumber: string } }) => x.order.orderNumber)).toEqual([r.orderNumber]);
        expect(body.data.items[0].order.items).toHaveLength(3);
      }
      // S2 (not chosen) sees nothing
      auth.session = { user: { id: f.S2.ownerId, role: "STORE_OWNER" } };
      const s2 = await (await storeGetRoute(new NextRequest("http://localhost/api/store?resource=orders"))).json();
      expect(s2.data.items).toHaveLength(0);
    });
  });
});
