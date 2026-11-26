/**
 * Transactions must not need a second pool connection.
 *
 * Inside `prisma.$transaction(async (tx) => …)` the transaction holds one pool
 * connection. A query on the global `prisma` there (directly or in a helper)
 * waits for another connection. With a small pool (Neon pooled URL, 2-vCPU CI
 * runners: connection_limit = 5) a few such transactions at once hold every
 * connection and each waits for one more: requests stall until pool_timeout,
 * and every other request (session, orders, lists) queues behind them.
 *
 * This file runs the app with ONE pool connection, so any transaction that
 * reaches for the global client times out here instead of passing by luck.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const sep = url.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = `${url}${sep}connection_limit=1&pool_timeout=3`;
  }
});

import { afterEach, beforeEach, expect, it } from "vitest";
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
  return { ...real, getSession: async () => auth.session, requireAuth: need, requireStorePortal: need, requireRider: rider };
});

import { writeAuditLog } from "@/lib/audit";
import { getListSettings } from "@/lib/lists/settings";
import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, submitBid as submitStoreBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { PATCH as storePatch } from "@/app/api/store/route";
import { POST as riderBidsPost } from "@/app/api/rider/bids/route";
import { GET as orderBidsGet } from "@/app/api/orders/[orderNumber]/rider-bids/route";

const KM = 1 / 111;

describeDb("one pool connection: transactions use their own client", () => {
  let f: Fixtures;
  const as = (userId: string, role: string) => (auth.session = { user: { id: userId, role } });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    await prisma.rider.update({
      where: { id: f.R1.id },
      data: { lastLatitude: f.S1.latitude! + KM, lastLongitude: f.S1.longitude!, lastLocationAt: new Date() },
    });
  });

  afterEach(() => {
    auth.session = null;
  });

  it("settings and audit helpers run on the transaction client", async () => {
    const out = await prisma.$transaction(async (tx) => {
      const s = await getListSettings(tx);
      await writeAuditLog({ action: "POOL_TEST", entity: "Test", entityId: "x" }, tx);
      return s;
    });
    expect(out.enabled).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "POOL_TEST" } })).toBe(1);
  });

  it(
    "store marks a list order ready, a rider bids, the customer sees the bid",
    async () => {
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
      const order = await acceptOffer(
        { id: f.customerA.id, email: f.customerA.email },
        l.id,
        acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: `pool-${Date.now()}` })
      );

      // Ready → opens the after-packing request inside the store's transaction.
      const ful = await prisma.storeFulfillment.findFirstOrThrow({ where: { orderId: order.orderId } });
      as(f.S1.ownerId, "STORE_OWNER");
      const ready = await storePatch(
        new Request("http://localhost/api/store", {
          method: "PATCH",
          body: JSON.stringify({ action: "FULFILLMENT_STATUS", fulfillmentId: ful.id, status: "READY_FOR_DISPATCH" }),
        })
      );
      expect(ready.status, await ready.clone().text()).toBe(200);
      const req = await prisma.deliveryRequest.findUniqueOrThrow({ where: { orderId: order.orderId } });

      // Rider bid → eligibility + distance check inside the bid transaction.
      as(f.R1.userId!, "RIDER");
      const res = await riderBidsPost(
        new Request("http://localhost/api/rider/bids", { method: "POST", body: JSON.stringify({ requestId: req.id, amount: 250 }) })
      );
      expect(res.status, await res.clone().text()).toBe(200);

      as(f.customerA.id, "CUSTOMER");
      const view = await orderBidsGet(new Request("http://localhost"), { params: { orderNumber: order.orderNumber } });
      expect(view.status).toBe(200);
      expect((await view.json()).data.bids).toHaveLength(1);
    },
    30_000
  );
});
