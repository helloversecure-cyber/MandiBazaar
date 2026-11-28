/** W6: stores bid on lists (D-01 … D-17). S1 and S2 get the standard grocery list; S3 does not (8 km). */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { createList, getCustomerList, updateList } from "@/lib/lists/service";
import { createListSchema, updateListSchema } from "@/lib/lists/validation";
import { OFFER_NOTIFY_THROTTLE_MS, bidSchema, declineList, listForStore, listsForStore, submitBid, withdrawBid } from "@/lib/lists/store-bids";
import { storeFacingDistanceKm } from "@/lib/lists/broadcast";
import { listItemsTotal, listLineTotal } from "@/lib/lists/line-total";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { offersForList } from "@/lib/lists/offers";

describeDb("store bids", () => {
  let f: Fixtures;
  let listId: string;
  let lineIds: string[];
  const owner = (s: { ownerId: string }) => ({ id: s.ownerId });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const l = await createList(
      { id: f.customerA.id },
      createListSchema.parse({
        addressId: f.addressA.id,
        note: "Fresh milk please",
        lines: [
          { name: "Atta", quantity: 10, unit: "kg", categoryId: grocery.id },
          { name: "Milk", quantity: 2, unit: "L" },
          { name: "Daal", quantity: 1.5, unit: "kg" },
        ],
      })
    );
    listId = l.id;
    lineIds = l.lines.map((x) => x.id);
  });

  const full = (prices = [180, 230, 400], extra: Record<string, unknown> = {}) =>
    bidSchema.parse({ lines: lineIds.map((lineId, i) => ({ lineId, available: true, unitPrice: prices[i] })), ...extra });

  it("D-01 a store sees the list's items and area, never the customer's name, phone or house", async () => {
    const v = await listForStore(owner(f.S1), listId);
    expect(v).toMatchObject({ area: "Model Town", city: "Lahore", note: "Fresh milk please", status: "BIDDING" });
    expect(v.lines.map((l) => [l.name, l.quantity, l.unit])).toEqual([["Atta", 10, "kg"], ["Milk", 2, "L"], ["Daal", 1.5, "kg"]]);
    expect(v.lines[0].category).toBe("Grocery");
    const json = JSON.stringify(v);
    for (const secret of ["Customer A", "03001234567", "House 1", f.customerA.id]) expect(json).not.toContain(secret);
    const inbox = await listsForStore(owner(f.S1), { skip: 0, take: 10 });
    expect(inbox.items).toHaveLength(1);
    expect(JSON.stringify(inbox)).not.toContain("03001234567");
    // opening it marks it seen
    expect(inbox.items[0].seen).toBe(true);
  });

  it("D-02 a store the list wasn't sent to gets 404", async () => {
    await expect(listForStore(owner(f.S3), listId)).rejects.toMatchObject({ status: 404 });
    await expect(submitBid(owner(f.S3), listId, full())).rejects.toMatchObject({ status: 404 });
  });

  it("D-03 a full bid: total = sum(qty x price) - discount, all 3 covered, customer notified", async () => {
    const b = await submitBid(owner(f.S1), listId, full([180, 230, 400], { discount: 60, prepMinutes: 30, note: "Fresh stock" }));
    expect(b).toMatchObject({ status: "PENDING", itemsTotal: 1800 + 460 + 600, discount: 60, total: 2800, coveredCount: 3, prepMinutes: 30, needsUpdate: false });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: f.customerA.id, type: "NEW_OFFER" } });
    expect(n.body).toContain("3 items");
    expect((await getCustomerList({ id: f.customerA.id }, listId)).offerCount).toBe(1);
  });

  it("D-04 a partial bid counts only the available items", async () => {
    const b = await submitBid(
      owner(f.S2),
      listId,
      bidSchema.parse({ lines: [
        { lineId: lineIds[0], available: true, unitPrice: 175 },
        { lineId: lineIds[1], available: false },
        { lineId: lineIds[2], available: true, unitPrice: 390 },
      ] })
    );
    expect(b).toMatchObject({ coveredCount: 2, itemsTotal: 1750 + 585 });
    expect(b.lines.find((l) => l.lineId === lineIds[1])).toMatchObject({ available: false, unitPrice: null });
  });

  it("D-05 nothing available → use Can't supply", async () => {
    const none = bidSchema.parse({ lines: lineIds.map((lineId) => ({ lineId, available: false })) });
    await expect(submitBid(owner(f.S1), listId, none)).rejects.toMatchObject({ code: "NOTHING_AVAILABLE" });
  });

  it("D-06 missing, zero, negative or huge prices are refused for the right line", async () => {
    await expect(submitBid(owner(f.S1), listId, full([180, 0, 400]))).rejects.toMatchObject({ code: "BAD_PRICE", field: "lines.1.unitPrice" });
    await expect(submitBid(owner(f.S1), listId, full([-5, 230, 400]))).rejects.toMatchObject({ field: "lines.0.unitPrice" });
    await expect(submitBid(owner(f.S1), listId, full([180, 230, 2_000_000]))).rejects.toMatchObject({ field: "lines.2.unitPrice" });
    const missing = bidSchema.parse({ lines: lineIds.map((lineId) => ({ lineId, available: true })) });
    await expect(submitBid(owner(f.S1), listId, missing)).rejects.toMatchObject({ code: "BAD_PRICE" });
  });

  it("D-07 a discount as big as the total is refused", async () => {
    await expect(submitBid(owner(f.S1), listId, full([1, 1, 1], { discount: 13.5 }))).rejects.toMatchObject({ code: "BAD_DISCOUNT" });
    expect(bidSchema.safeParse({ lines: [{ lineId: "x", available: false }], discount: -1 }).success).toBe(false);
  });

  it("every line must be answered exactly once", async () => {
    const twoOnly = bidSchema.parse({ lines: lineIds.slice(0, 2).map((lineId) => ({ lineId, available: true, unitPrice: 10 })) });
    await expect(submitBid(owner(f.S1), listId, twoOnly)).rejects.toMatchObject({ code: "LIST_CHANGED" });
  });

  it("D-08 editing a bid updates the same row and tells the customer", async () => {
    const first = await submitBid(owner(f.S1), listId, full());
    const second = await submitBid(owner(f.S1), listId, full([170, 230, 400]));
    expect(second.id).toBe(first.id);
    expect(second.itemsTotal).toBe(1700 + 460 + 600);
    expect(await prisma.storeBid.count({ where: { listId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "OFFER_UPDATED" } })).toBe(1);
  });

  it("D-09 two bids from the same store at the same moment still leave one row", async () => {
    await Promise.all([submitBid(owner(f.S1), listId, full()), submitBid(owner(f.S1), listId, full([1, 2, 3]))]);
    expect(await prisma.storeBid.count({ where: { listId, storeId: f.S1.id } })).toBe(1);
  });

  it("D-10 / D-11 no bids once the list is accepted or cancelled", async () => {
    await prisma.itemList.update({ where: { id: listId }, data: { status: "ACCEPTED" } });
    await expect(submitBid(owner(f.S2), listId, full())).rejects.toMatchObject({ code: "LIST_CLOSED", status: 409 });
    await prisma.itemList.update({ where: { id: listId }, data: { status: "CANCELLED" } });
    await expect(submitBid(owner(f.S2), listId, full())).rejects.toMatchObject({ code: "LIST_CLOSED" });
  });

  it("D-12 can't supply: recorded, customer not told, and if everyone declines the list widens", async () => {
    await declineList(owner(f.S1), listId);
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: listId } })).radiusKm).toBe(5);
    await declineList(owner(f.S2), listId);
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: listId } })).radiusKm).toBe(10);
    expect(await prisma.listBroadcast.count({ where: { listId, storeId: f.S3.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: { in: ["NEW_OFFER", "OFFER_DECLINED"] } } })).toBe(0);
  });

  it("can't decline with an open offer; offering after declining undoes the decline", async () => {
    await submitBid(owner(f.S1), listId, full());
    await expect(declineList(owner(f.S1), listId)).rejects.toMatchObject({ code: "HAS_OFFER" });
    await declineList(owner(f.S2), listId);
    await submitBid(owner(f.S2), listId, full());
    expect((await prisma.listBroadcast.findFirstOrThrow({ where: { listId, storeId: f.S2.id } })).declinedAt).toBeNull();
  });

  it("D-13 withdraw hides the offer from the customer", async () => {
    await submitBid(owner(f.S1), listId, full());
    await withdrawBid(owner(f.S1), listId);
    expect((await prisma.storeBid.findFirstOrThrow({ where: { listId } })).status).toBe("WITHDRAWN");
    expect((await getCustomerList({ id: f.customerA.id }, listId)).offerCount).toBe(0);
    await expect(withdrawBid(owner(f.S1), listId)).rejects.toMatchObject({ code: "NO_OFFER" });
  });

  it("D-14 an active manager can bid; staff can't", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "STORE_OWNER" } });
    const mk = (email: string) => prisma.user.create({ data: { fullName: email, email, roleId: role.id } });
    const manager = await mk("mgr@test.local");
    const staff = await mk("staff@test.local");
    await prisma.storeMember.createMany({ data: [
      { storeId: f.S1.id, userId: manager.id, role: "MANAGER" },
      { storeId: f.S1.id, userId: staff.id, role: "STAFF" },
    ] });
    await expect(submitBid({ id: manager.id }, listId, full())).resolves.toMatchObject({ status: "PENDING" });
    await expect(submitBid({ id: staff.id }, listId, full())).rejects.toMatchObject({ status: 403 });
  });

  it("D-15 a store suspended after the broadcast can't bid", async () => {
    await prisma.store.update({ where: { id: f.S2.id }, data: { status: "SUSPENDED" } });
    await expect(submitBid(owner(f.S2), listId, full())).rejects.toMatchObject({ status: 403 });
  });

  it("D-16 a store never sees another store's prices", async () => {
    await submitBid(owner(f.S1), listId, full([123.45, 230, 400]));
    const s2view = JSON.stringify(await listForStore(owner(f.S2), listId));
    expect(s2view).not.toContain("123.45");
    expect(JSON.stringify(await listsForStore(owner(f.S2), { skip: 0, take: 10 }))).not.toContain("123.45");
  });

  it("D-17 after the customer edits the list, the old offer needs an update", async () => {
    await submitBid(owner(f.S1), listId, full());
    const l = await updateList({ id: f.customerA.id }, listId, updateListSchema.parse({
      lines: [{ id: lineIds[0], name: "Atta", quantity: 20, unit: "kg" }, { name: "Sugar", quantity: 1, unit: "kg" }],
    }));
    const view = await listForStore(owner(f.S1), listId);
    expect(view.myBid?.needsUpdate).toBe(true);
    // answering the new lines brings it up to date
    const upd = await submitBid(owner(f.S1), listId, bidSchema.parse({ lines: l.lines.map((x) => ({ lineId: x.id, available: true, unitPrice: 100 })) }));
    expect(upd.needsUpdate).toBe(false);
    expect(upd.itemsTotal).toBe(2100);
  });

  it("a store owner with two stores that both got the list must say which", async () => {
    await prisma.store.update({ where: { id: f.S2.id }, data: { ownerId: f.S1.ownerId } });
    await expect(submitBid(owner(f.S1), listId, full())).rejects.toMatchObject({ code: "STORE_REQUIRED" });
    await expect(submitBid(owner(f.S1), listId, { ...full(), storeId: f.S2.id })).resolves.toMatchObject({ status: "PENDING" });
    await expect(submitBid(owner(f.S1), listId, { ...full(), storeId: f.S3.id })).rejects.toMatchObject({ code: "NOT_YOUR_STORE" });
  });
  describe("security review", () => {
    it("M2 stores see the customer's distance rounded to 0.5 km (never the exact metre)", async () => {
      const set = (km: number) =>
        prisma.listBroadcast.update({ where: { listId_storeId: { listId, storeId: f.S1.id } }, data: { distanceKm: km } });
      for (const [exact, shown] of [[2.137, 2], [2.26, 2.5], [0.12, 0.5], [7.749, 7.5]] as const) {
        await set(exact);
        expect((await listForStore(owner(f.S1), listId)).distanceKm).toBe(shown);
        const inbox = await listsForStore(owner(f.S1), { skip: 0, take: 10 });
        expect(inbox.items[0].distanceKm).toBe(shown);
        // No number in the reply carries the exact distance. (Checking the
        // whole JSON text failed at random: a timestamp like "…:52.26…Z"
        // contains "2.26".)
        const numbers: number[] = [];
        JSON.stringify(inbox, (_k, v) => {
          if (typeof v === "number") numbers.push(v);
          return v;
        });
        expect(numbers).not.toContain(exact);
      }
      // the stored (internal) value keeps full precision
      const b = await prisma.listBroadcast.findUniqueOrThrow({ where: { listId_storeId: { listId, storeId: f.S1.id } } });
      expect(Number(b.distanceKm)).toBe(7.749);
      // the "new list" push to stores is coarse too
      const note = await prisma.notification.findFirstOrThrow({ where: { userId: f.S1.ownerId, type: "NEW_LIST" } });
      expect(note.body).toMatch(/about \d+\.[05] km away/);
    });

    it("M2 storeFacingDistanceKm rounds to 0.5 km with a 0.5 km floor", () => {
      expect(storeFacingDistanceKm(null)).toBeNull();
      expect(storeFacingDistanceKm(0)).toBe(0.5);
      expect(storeFacingDistanceKm(0.74)).toBe(0.5);
      expect(storeFacingDistanceKm(0.76)).toBe(1);
      expect(storeFacingDistanceKm(3.249)).toBe(3);
      expect(storeFacingDistanceKm(3.25)).toBe(3.5);
    });

    it("L1 bid total and accept agree: 2 lines of Rs 33.33 x 1.5 = Rs 100.00 and the offer can be accepted", async () => {
      expect(listLineTotal(33.33, 1.5)).toBe(50);
      expect(listItemsTotal([{ unitPrice: 33.33, quantity: 1.5 }, { unitPrice: 33.33, quantity: 1.5 }])).toBe(100);
      await prisma.storeSettings.updateMany({ data: { minimumOrderAmount: 0 } });
      const l = await createList(
        { id: f.customerA.id },
        createListSchema.parse({
          addressId: f.addressA.id,
          lines: [
            { name: "Daal", quantity: 1.5, unit: "kg" },
            { name: "Chana", quantity: 1.5, unit: "kg" },
          ],
        })
      );
      const bid = await submitBid(
        owner(f.S1),
        l.id,
        bidSchema.parse({ lines: l.lines.map((x) => ({ lineId: x.id, available: true, unitPrice: 33.33 })) })
      );
      expect(bid.itemsTotal).toBe(100);
      const offer = (await offersForList(l.id)).find((o) => o.store.id === f.S1.id)!;
      expect(offer.total).toBe(100);
      expect(offer.lines.map((x) => x.lineTotal)).toEqual([50, 50]);
      const order = await acceptOffer(
        { id: f.customerA.id, email: f.customerA.email },
        l.id,
        acceptOfferSchema.parse({ bidId: bid.id, addressId: f.addressA.id, idempotencyKey: `l1-${Date.now()}`, expectedTotal: offer.total })
      );
      expect(order.productTotal).toBe(100);
    });

    it("L4 re-saving an unchanged offer doesn't notify; real changes notify at most once per 10 minutes", async () => {
      const count = (type: string) => prisma.notification.count({ where: { userId: f.customerA.id, type } });
      await submitBid(owner(f.S1), listId, full());
      expect(await count("NEW_OFFER")).toBe(1);
      // same prices again (and only the note changes): silent
      await submitBid(owner(f.S1), listId, full());
      await submitBid(owner(f.S1), listId, full([180, 230, 400], { note: "Fresh" }));
      expect(await count("OFFER_UPDATED")).toBe(0);
      // a price change notifies once
      await submitBid(owner(f.S1), listId, full([170, 230, 400]));
      expect(await count("OFFER_UPDATED")).toBe(1);
      // more changes inside the window stay quiet
      await submitBid(owner(f.S1), listId, full([160, 230, 400]));
      await submitBid(owner(f.S1), listId, full([160, 230, 400], { discount: 10 }));
      expect(await count("OFFER_UPDATED")).toBe(1);
      // withdraw + offer again inside the window doesn't re-announce it
      await withdrawBid(owner(f.S1), listId);
      await submitBid(owner(f.S1), listId, full([150, 230, 400]));
      expect(await count("NEW_OFFER")).toBe(1);
      // once the window has passed, the next change notifies again
      await prisma.notification.updateMany({
        where: { userId: f.customerA.id },
        data: { createdAt: new Date(Date.now() - OFFER_NOTIFY_THROTTLE_MS - 1000) },
      });
      await submitBid(owner(f.S1), listId, full([140, 230, 400]));
      expect(await count("OFFER_UPDATED")).toBe(2);
      // another store's offer is its own conversation
      await submitBid(owner(f.S2), listId, full());
      expect(await count("NEW_OFFER")).toBe(2);
    });
  });
});
