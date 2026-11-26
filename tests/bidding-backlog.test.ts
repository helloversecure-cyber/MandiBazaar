/**
 * Bidding backlog fixes:
 *   I-03  admin cancels an open item list (PATCH /api/admin/lists/[id]).
 *   Multi-store owner: the store-orders "View the customer's list" link carries the store.
 *   Store owners set a product's low-stock alert (lowStockThreshold) on create / update.
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
  const admin = async (permission?: string) => {
    const session = await need();
    const { hasPermission } = await import("@/lib/auth/permissions");
    if (session.user.role === "SUPER_ADMIN") return session;
    if (!["ADMIN", "ORDER_MANAGER", "INVENTORY_MANAGER", "DELIVERY_MANAGER"].includes(session.user.role)) throw new Error("FORBIDDEN");
    if (!permission || !hasPermission(session.user.role as never, permission as never)) throw new Error("FORBIDDEN");
    return session;
  };
  return { ...real, getSession: async () => auth.session, requireAuth: need, requireStorePortal: need, requireAdmin: admin };
});

import { storeListHref } from "@/lib/lists/store-ui";
import { productFieldRules, storeProductUpdateSchema } from "@/lib/validators/product-rules";
import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, listForStore, submitBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { GET as adminListGet, PATCH as adminListPatch } from "@/app/api/admin/lists/[id]/route";
import { GET as storeGet, PATCH as storePatch, POST as storePost } from "@/app/api/store/route";

describe("store list link (pure)", () => {
  it("adds the store when known", () => {
    expect(storeListHref("L1")).toBe("/store-portal/lists/L1");
    expect(storeListHref("L1", null)).toBe("/store-portal/lists/L1");
    expect(storeListHref("L1", "S 2")).toBe("/store-portal/lists/L1?storeId=S%202");
  });
});

describe("low-stock alert rule (pure)", () => {
  it("whole numbers 0–1000; blank / bad values rejected", () => {
    const r = productFieldRules.lowStockThreshold;
    expect(r.parse(0)).toBe(0);
    expect(r.parse("1000")).toBe(1000);
    for (const bad of [-1, 1001, 2.5, "abc", null]) expect(r.safeParse(bad).success).toBe(false);
    expect(storeProductUpdateSchema.safeParse({ lowStockThreshold: 7 }).success).toBe(true);
    expect(storeProductUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describeDb("bidding backlog (DB)", () => {
  let f: Fixtures;
  let n = 0;
  const key = () => `backlog-key-${++n}-${Date.now()}`;
  const as = (userId: string, role: string, email?: string | null) => (auth.session = { user: { id: userId, role, email } });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });

  async function openList() {
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    return createList(
      { id: f.customerA.id },
      createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Atta", quantity: 2, unit: "kg", categoryId: grocery.id }] })
    );
  }
  const bid = (ownerId: string, listId: string, lineId: string, unitPrice: number) =>
    submitBid({ id: ownerId }, listId, bidSchema.parse({ lines: [{ lineId, available: true, unitPrice }] }));

  const cancel = (id: string, body: unknown) =>
    adminListPatch(new Request(`http://localhost/api/admin/lists/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
      params: { id },
    });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
  });
  afterEach(() => {
    auth.session = null;
  });

  // ── I-03 ──────────────────────────────────────────────────────────────────

  it("I-03: admin cancels a BIDDING list — offers closed, customer and bidding stores told, audited", async () => {
    const l = await openList();
    await bid(f.S1.ownerId, l.id, l.lines[0].id, 500);
    await bid(f.S2.ownerId, l.id, l.lines[0].id, 520);
    const reason = "Duplicate list, customer asked by phone";

    // Who may cancel
    auth.session = null;
    expect((await cancel(l.id, { action: "CANCEL", reason })).status).toBe(401);
    as(f.customerA.id, "CUSTOMER");
    expect((await cancel(l.id, { action: "CANCEL", reason })).status).toBe(403);
    as(f.S1.ownerId, "STORE_OWNER");
    expect((await cancel(l.id, { action: "CANCEL", reason })).status).toBe(403);
    as(f.admin.id, "INVENTORY_MANAGER");
    expect((await cancel(l.id, { action: "CANCEL", reason })).status).toBe(403);

    // Validation
    as(f.admin.id, "ORDER_MANAGER");
    const noReason = await json(await cancel(l.id, { action: "CANCEL" }));
    expect(noReason.status).toBe(400);
    expect(noReason.body.fieldErrors.reason).toBeTruthy();
    expect((await json(await cancel(l.id, { action: "CANCEL", reason: "  no " }))).status).toBe(400);
    expect((await json(await cancel(l.id, { action: "DELETE", reason }))).status).toBe(400);
    const notJson = await adminListPatch(new Request("http://localhost", { method: "PATCH", body: "{" }), { params: { id: l.id } });
    expect(notJson.status).toBe(400);
    expect((await json(await cancel("nope", { action: "CANCEL", reason }))).status).toBe(404);
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("BIDDING");

    const res = await json(await cancel(l.id, { action: "CANCEL", reason }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: l.id, status: "CANCELLED" });
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.bids.map((b: { status: string }) => b.status)).toEqual(["NOT_SELECTED", "NOT_SELECTED"]);
    expect(res.body.data.history.map((h: { action: string }) => h.action)).toContain("LIST_CANCELLED_BY_ADMIN");

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "LIST_CANCELLED_BY_ADMIN", entityId: l.id } });
    expect(log).toMatchObject({
      userId: f.admin.id,
      entity: "ItemList",
      previousValue: { status: "BIDDING" },
      newValue: { status: "CANCELLED", reason, offersClosed: 2 },
    });

    const customerNote = await prisma.notification.findFirstOrThrow({ where: { userId: f.customerA.id, type: "LIST_CANCELLED" } });
    expect(customerNote.body).toContain(reason);
    expect(customerNote.metadata).toMatchObject({ listId: l.id, byAdmin: true });
    for (const s of [f.S1, f.S2]) {
      expect(await prisma.notification.count({ where: { userId: s.ownerId, type: "LIST_CANCELLED" } })).toBe(1);
    }
    // A store that got the list but didn't bid isn't told.
    expect(await prisma.notification.count({ where: { userId: f.S3.ownerId, type: "LIST_CANCELLED" } })).toBe(0);

    // Closed now: no new offers, a second cancel is refused, the detail shows it.
    await expect(bid(f.S1.ownerId, l.id, l.lines[0].id, 400)).rejects.toMatchObject({ status: 409 });
    const again = await json(await cancel(l.id, { action: "CANCEL", reason }));
    expect(again).toMatchObject({ status: 409, body: { code: "LIST_CLOSED" } });
    const d = await json(await adminListGet(new Request("http://localhost"), { params: { id: l.id } }));
    expect(d.body.data.status).toBe("CANCELLED");
  });

  it("I-03: a NO_STORES list can be cancelled; an accepted list (order placed) cannot", async () => {
    const lonely = await openList();
    await prisma.itemList.update({ where: { id: lonely.id }, data: { status: "NO_STORES" } });
    as(f.admin.id, "SUPER_ADMIN");
    const r = await json(await cancel(lonely.id, { action: "CANCEL", reason: "Area not served yet" }));
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("CANCELLED");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "LIST_CANCELLED_BY_ADMIN", entityId: lonely.id } })).previousValue).toEqual({
      status: "NO_STORES",
    });

    const l = await openList();
    const won = await bid(f.S1.ownerId, l.id, l.lines[0].id, 500);
    await acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      l.id,
      acceptOfferSchema.parse({ bidId: won.id, addressId: f.addressA.id, idempotencyKey: key() })
    );
    as(f.admin.id, "ORDER_MANAGER");
    const refused = await json(await cancel(l.id, { action: "CANCEL", reason: "Too late to cancel" }));
    expect(refused).toMatchObject({ status: 409, body: { code: "ORDER_PLACED" } });
    const after = await prisma.itemList.findUniqueOrThrow({ where: { id: l.id }, include: { bids: true } });
    expect(after.status).toBe("ACCEPTED");
    expect(after.bids[0].status).toBe("ACCEPTED");

    // Expired lists are closed too.
    const old = await openList();
    await prisma.itemList.update({ where: { id: old.id }, data: { status: "EXPIRED" } });
    expect((await json(await cancel(old.id, { action: "CANCEL", reason: "Cleaning up old" }))).body.code).toBe("LIST_CLOSED");
  });

  // ── Multi-store owner list link ───────────────────────────────────────────

  it("store orders carry the fulfilment's store, so a multi-store owner opens the list for the right store", async () => {
    const l = await openList();
    const won = await bid(f.S2.ownerId, l.id, l.lines[0].id, 500);
    const order = await acceptOffer(
      { id: f.customerA.id, email: f.customerA.email },
      l.id,
      acceptOfferSchema.parse({ bidId: won.id, addressId: f.addressA.id, idempotencyKey: key() })
    );
    // S1's owner now owns S2 as well; both stores got this list.
    await prisma.store.update({ where: { id: f.S2.id }, data: { ownerId: f.S1.ownerId } });
    as(f.S1.ownerId, "STORE_OWNER");

    const res = await json(await storeGet(new NextRequest("http://localhost/api/store?resource=orders")));
    expect(res.status).toBe(200);
    const row = res.body.data.items.find((x: { order: { orderNumber: string } }) => x.order.orderNumber === order.orderNumber);
    expect(row).toMatchObject({ storeId: f.S2.id, order: { isListOrder: true, itemListId: l.id } });
    const href = storeListHref(row.order.itemListId, row.storeId);
    expect(href).toBe(`/store-portal/lists/${l.id}?storeId=${f.S2.id}`);

    // Without the store the owner is asked which one; with it, the winning offer shows.
    await expect(listForStore({ id: f.S1.ownerId }, l.id)).rejects.toMatchObject({ code: "STORE_REQUIRED" });
    const storeId = new URL(href, "http://localhost").searchParams.get("storeId");
    const view = await listForStore({ id: f.S1.ownerId }, l.id, storeId);
    expect(view).toMatchObject({ storeId: f.S2.id, status: "ACCEPTED", myBid: { status: "ACCEPTED", orderNumber: order.orderNumber } });
  });

  // ── Low-stock threshold ───────────────────────────────────────────────────

  it("store owner sets the low-stock alert on create and edit (0–1000, applied at once)", async () => {
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const base = {
      storeId: f.S1.id,
      name: "Basmati Rice",
      description: "Long grain basmati rice",
      price: 400,
      stockQuantity: 50,
      unit: "1 kg",
      categoryId: grocery.id,
      imageUrls: ["/uploads/products/rice.jpg"],
    };
    const post = async (body: unknown) =>
      json(await storePost(new Request("http://localhost/api/store", { method: "POST", body: JSON.stringify(body) })));
    const patch = async (body: unknown) =>
      json(await storePatch(new Request("http://localhost/api/store", { method: "PATCH", body: JSON.stringify(body) })));

    as(f.S1.ownerId, "STORE_OWNER");
    for (const bad of [1001, -1, 2.5, "lots"]) {
      const r = await post({ ...base, lowStockThreshold: bad });
      expect(r.status).toBe(400);
      expect(r.body.fieldErrors.lowStockThreshold).toMatch(/0 to 1,000/);
    }
    const made = await post({ ...base, lowStockThreshold: 12 });
    expect(made.status).toBe(201);
    expect(made.body.data.lowStockThreshold).toBe(12);
    const plain = await post({ ...base, name: "Brown Rice", lowStockThreshold: "" });
    expect(plain.status).toBe(201);
    expect(plain.body.data.lowStockThreshold).toBe(5); // schema default

    // Approved product: the alert is not a reviewed field — it changes at once.
    await prisma.product.update({ where: { id: made.body.data.id }, data: { status: "ACTIVE" } });
    expect((await patch({ action: "UPDATE_PRODUCT", productId: made.body.data.id, lowStockThreshold: 1001 })).status).toBe(400);
    const upd = await patch({ action: "UPDATE_PRODUCT", productId: made.body.data.id, lowStockThreshold: "0" });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ lowStockThreshold: 0, pendingReview: false });
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: made.body.data.id } });
    expect(saved).toMatchObject({ lowStockThreshold: 0, status: "ACTIVE", pendingChanges: null });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "STORE_PRODUCT_UPDATED", entityId: saved.id } });
    expect(log).toMatchObject({ previousValue: { lowStockThreshold: 12 }, newValue: { lowStockThreshold: 0 } });

    // Shown back in the store's product list.
    const list = await json(await storeGet(new NextRequest("http://localhost/api/store?resource=products")));
    expect(list.body.data.items.find((p: { id: string }) => p.id === saved.id).lowStockThreshold).toBe(0);

    // Another store's owner can't change it.
    as(f.S2.ownerId, "STORE_OWNER");
    expect((await patch({ action: "UPDATE_PRODUCT", productId: saved.id, lowStockThreshold: 9 })).status).toBe(403);
  });
});
