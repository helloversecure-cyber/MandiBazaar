/**
 * Store APIs the Android app needs: list/rider-bidding info on store order rows,
 * the winning store's order number on its bid, and stale-version / line-order checks on bids.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, listForStore, listsForStore, submitBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { GET as storeGetRoute } from "@/app/api/store/route";
import { PUT as bidPutRoute } from "@/app/api/store/lists/[id]/bid/route";
import { NextRequest } from "next/server";

describeDb("store API list info", () => {
  let f: Fixtures;
  let listId: string;
  let lineIds: string[];
  const owner = (s: { ownerId: string }) => ({ id: s.ownerId });
  const full = (prices = [180, 230, 400], extra: Record<string, unknown> = {}) =>
    bidSchema.parse({ lines: lineIds.map((lineId, i) => ({ lineId, available: true, unitPrice: prices[i] })), ...extra });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({
        addressId: f.addressA.id,
        lines: [
          { name: "Atta", quantity: 10, unit: "kg" },
          { name: "Milk", quantity: 2, unit: "L" },
          { name: "Daal", quantity: 1.5, unit: "kg" },
        ],
      })
    );
    listId = l.id;
    lineIds = l.lines.map((x) => x.id);
  });

  afterEach(() => {
    auth.session = null;
  });

  async function acceptS1() {
    const s1 = await submitBid(owner(f.S1), listId, full());
    await submitBid(owner(f.S2), listId, full([170, 220, 390]));
    return acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      listId,
      acceptOfferSchema.parse({ bidId: s1.id, addressId: f.addressA.id, idempotencyKey: `k-${Date.now()}-${Math.random()}` })
    );
  }

  it("store order rows say whether the order came from a list and show the post-pack rider request", async () => {
    const r = await acceptS1();
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.orderNumber } });
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await prisma.deliveryRequest.create({
      data: { customerId: f.customerA.id, orderId: order.id, trigger: "POST_PACK", status: "OPEN", expiresAt, city: "Lahore" },
    });
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
        orderStatus: "CONFIRMED",
        deliveryAddressSnapshot: { city: "Lahore", area: "Model Town" },
        items: { create: { storeId: f.S1.id, storeName: "TEST S1", productName: "Rice", sku: "R1", unit: "kg", quantity: 1, unitPrice: 500, finalPrice: 500 } },
        fulfillments: { create: { storeId: f.S1.id, status: "CONFIRMED", subtotal: 500, itemCount: 1, pickupAddress: {} } },
      },
    });
    // A checkout-time rider auction is not the post-pack one.
    await prisma.deliveryRequest.create({
      data: { customerId: f.customerA.id, orderId: cart.id, trigger: "CHECKOUT", status: "ASSIGNED", expiresAt },
    });

    auth.session = { user: { id: f.S1.ownerId, role: "STORE_OWNER" } };
    const body = await (await storeGetRoute(new NextRequest("http://localhost/api/store?resource=orders"))).json();
    type Row = { order: Record<string, unknown> & { orderNumber: string } };
    const byNumber = new Map<string, Row["order"]>(body.data.items.map((x: Row) => [x.order.orderNumber, x.order]));
    expect(byNumber.get(r.orderNumber)).toMatchObject({
      isListOrder: true,
      itemListId: listId,
      postPackRequest: { status: "OPEN", expiresAt: expiresAt.toISOString() },
    });
    expect(byNumber.get("ORD-CART-1")).toMatchObject({ isListOrder: false, itemListId: null, postPackRequest: null });
    // No raw relations or extra request details leak into the row.
    for (const o of Array.from(byNumber.values())) {
      expect(o).not.toHaveProperty("itemList");
      expect(o).not.toHaveProperty("deliveryRequest");
    }
  });

  it("myBid carries the order number for the winning store only", async () => {
    const r = await acceptS1();
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.orderNumber } });

    const s1Detail = await listForStore(owner(f.S1), listId);
    expect(s1Detail.myBid).toMatchObject({ status: "ACCEPTED", orderId: order.id, orderNumber: r.orderNumber });
    const s1Inbox = await listsForStore(owner(f.S1), { filter: "all", skip: 0, take: 10 });
    expect(s1Inbox.items[0].myBid).toMatchObject({ orderId: order.id, orderNumber: r.orderNumber });

    const s2Detail = await listForStore(owner(f.S2), listId);
    expect(s2Detail.myBid?.status).toBe("NOT_SELECTED");
    expect(s2Detail.myBid).not.toHaveProperty("orderNumber");
    expect(s2Detail.myBid).not.toHaveProperty("orderId");
    const s2Inbox = await listsForStore(owner(f.S2), { filter: "all", skip: 0, take: 10 });
    expect(s2Inbox.items[0].myBid).not.toHaveProperty("orderNumber");
    expect(JSON.stringify(s2Inbox)).not.toContain(r.orderNumber);
  });

  it("no order fields on a pending bid", async () => {
    await submitBid(owner(f.S1), listId, full());
    expect((await listForStore(owner(f.S1), listId)).myBid).not.toHaveProperty("orderNumber");
  });

  it("a stale listVersion is refused with 409 LIST_CHANGED; matching or missing version is fine", async () => {
    await prisma.itemList.update({ where: { id: listId }, data: { version: 2 } });
    await expect(submitBid(owner(f.S1), listId, full(undefined, { listVersion: 1 }))).rejects.toMatchObject({ code: "LIST_CHANGED", status: 409 });
    expect(await prisma.storeBid.count({ where: { listId } })).toBe(0);

    auth.session = { user: { id: f.S1.ownerId, role: "STORE_OWNER" } };
    const put = (body: Record<string, unknown>) =>
      bidPutRoute(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }), { params: { id: listId } });
    const lines = lineIds.map((lineId, i) => ({ lineId, available: true, unitPrice: [180, 230, 400][i] }));
    const stale = await put({ lines, listVersion: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ success: false, code: "LIST_CHANGED" });

    const ok = await put({ lines, listVersion: 2 });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ status: "PENDING", needsUpdate: false });
    const legacy = await put({ lines });
    expect(legacy.status).toBe(200);
  });

  it("per-line error index matches the order the detail endpoint shows", async () => {
    // Reverse the display order: Daal, Milk, Atta.
    await prisma.itemListLine.update({ where: { id: lineIds[0] }, data: { sortOrder: 2 } });
    await prisma.itemListLine.update({ where: { id: lineIds[2] }, data: { sortOrder: 0 } });
    const detail = await listForStore(owner(f.S1), listId);
    expect(detail.lines.map((l) => l.name)).toEqual(["Daal", "Milk", "Atta"]);

    const answers = detail.lines.map((l) => ({ lineId: l.id, available: true, unitPrice: l.name === "Atta" ? 0 : 100 }));
    const atta = detail.lines.findIndex((l) => l.name === "Atta");
    await expect(submitBid(owner(f.S1), listId, bidSchema.parse({ lines: answers }))).rejects.toMatchObject({
      code: "BAD_PRICE",
      field: `lines.${atta}.unitPrice`,
    });
    const daal = detail.lines.map((l) => ({ lineId: l.id, available: true, unitPrice: l.name === "Daal" ? -1 : 100 }));
    await expect(submitBid(owner(f.S1), listId, bidSchema.parse({ lines: daal }))).rejects.toMatchObject({ field: "lines.0.unitPrice" });
  });
});
