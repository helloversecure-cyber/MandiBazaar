/**
 * Owner rule: a list's offer window is 48 h. If the customer hasn't accepted an
 * offer by then, the round's pending offers expire (kept) and the list restarts
 * for a new round; the customer is reminded ~6 h before a round ends. Stops on
 * accept or cancel; `maxRounds` (0 = unlimited) ends it as EXPIRED.
 * Fixtures: S1 2 km, S2 4 km, S3 8 km Grocery; customer A in Model Town.
 */
import { beforeEach, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { cancelList, createList, getCustomerList, listCustomerLists } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { bidSchema, listForStore, listsForStore, submitBid } from "@/lib/lists/store-bids";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { tickDueLists, tickList } from "@/lib/lists/broadcast";
import { adminCancelList, listSettingsSchema, saveListSettings } from "@/lib/lists/admin";
import { getListSettings } from "@/lib/lists/settings";
import { storeListState } from "@/lib/lists/store-ui";

const HOUR = 3600_000;

describeDb("list rounds: 48 h window, automatic restart", () => {
  let f: Fixtures;
  let listId: string;
  let lineIds: string[];
  const owner = (s: { ownerId: string }) => ({ id: s.ownerId });
  const A = () => ({ id: f.customerA.id, email: f.customerA.email });
  let keyN = 0;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
    const l = await createList(
      A(),
      createListSchema.parse({
        addressId: f.addressA.id,
        lines: [
          { name: "Atta", quantity: 10, unit: "kg", categoryId: grocery.id },
          { name: "Milk", quantity: 2, unit: "L" },
        ],
      })
    );
    listId = l.id;
    lineIds = l.lines.map((x) => x.id);
  });

  const bid = (s: { ownerId: string }, prices = [180, 230]) =>
    submitBid(owner(s), listId, bidSchema.parse({ lines: lineIds.map((lineId, i) => ({ lineId, available: true, unitPrice: prices[i] })) }));
  const endWindow = () => prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const notes = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });
  const list = () => prisma.itemList.findUniqueOrThrow({ where: { id: listId } });

  it("new lists get a 48 h window in round 1 (default setting)", async () => {
    expect((await getListSettings()).expiryHours).toBe(48);
    expect((await getListSettings()).maxRounds).toBe(0);
    const v = await getCustomerList(A(), listId);
    expect(v.round).toBe(1);
    const hours = (new Date(v.roundEndsAt).getTime() - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);
  });

  it("window ends without an accept → offers EXPIRED (kept), round 2, fresh 48 h, re-sent, everyone told", async () => {
    const b1 = await bid(f.S1);
    await endWindow();

    expect(await tickList(listId)).toBe("RESTARTED");
    const l = await list();
    expect(l).toMatchObject({ status: "BIDDING", round: 2, radiusKm: 5, reminderSentAt: null });
    expect((l.expiresAt.getTime() - Date.now()) / HOUR).toBeGreaterThan(47.9);
    expect(l.roundStartedAt).not.toBeNull();

    // Round 1's offer is kept as a record.
    expect(await prisma.storeBid.findUniqueOrThrow({ where: { id: b1.id } })).toMatchObject({ status: "EXPIRED", round: 1 });

    // Re-sent from the first circle: S1 (last round's bidder) and S2, both in round 2.
    const bc = await prisma.listBroadcast.findMany({ where: { listId }, orderBy: { distanceKm: "asc" } });
    expect(bc.map((b) => [b.storeId, b.round])).toEqual([
      [f.S1.id, 2],
      [f.S2.id, 2],
    ]);

    expect(await notes(f.customerA.id, "LIST_RESTARTED")).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: f.customerA.id, type: "LIST_RESTARTED" } });
    expect(n.title).toBe("Your list restarted — round 2");
    expect(await notes(f.S1.ownerId, "LIST_RESTARTED")).toBe(1);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: f.S1.ownerId, type: "LIST_RESTARTED" } })).title).toBe(
      "List restarted, bid again"
    );
    expect(await notes(f.S2.ownerId, "NEW_LIST")).toBe(2); // round 1 and round 2
    expect(await prisma.auditLog.count({ where: { entityId: listId, action: "LIST_RESTARTED" } })).toBe(1);

    // Customer sees round 2 with no offers yet; store sees round 2 and must bid again.
    const v = await getCustomerList(A(), listId);
    expect(v).toMatchObject({ status: "BIDDING", round: 2, offerCount: 0, offers: [] });
    const sv = await listForStore(owner(f.S1), listId);
    expect(sv).toMatchObject({ round: 2, myBid: null, status: "BIDDING" });
    expect(new Date(sv.roundEndsAt).getTime()).toBe(l.expiresAt.getTime());
    const inbox = await listsForStore(owner(f.S1), { skip: 0, take: 10 });
    expect(inbox.items[0]).toMatchObject({ listId, round: 2, myBid: null });
    const state = storeListState({ ...inbox.items[0], expiresAt: inbox.items[0].expiresAt.toISOString() });
    expect(state.key).toBe("NEW");
    expect(state.help).toContain("round 2");

    // A new offer in round 2 is a new record; round 1's stays.
    const b2 = await bid(f.S1, [170, 220]);
    expect(b2.id).not.toBe(b1.id);
    expect(b2.round).toBe(2);
    expect(await prisma.storeBid.count({ where: { listId, storeId: f.S1.id } })).toBe(2);
    const v2 = await getCustomerList(A(), listId);
    expect(v2.offers.map((o) => [o.bidId, o.round, o.status])).toEqual([[b2.id, 2, "PENDING"]]);
  });

  it("an old round's offer can't be accepted; the new round's can, and that stops the restarts", async () => {
    const b1 = await bid(f.S1);
    await endWindow();
    await tickList(listId);
    const accept = (bidId: string) =>
      acceptOffer(A(), listId, acceptOfferSchema.parse({ bidId, addressId: f.addressA.id, idempotencyKey: `k-rounds-${++keyN}-${Date.now()}` }));
    await expect(accept(b1.id)).rejects.toMatchObject({ code: "OFFER_UNAVAILABLE", status: 409 });

    const b2 = await bid(f.S2);
    await accept(b2.id);
    expect((await list()).status).toBe("ACCEPTED");

    await endWindow();
    expect(await tickList(listId)).toBe("CLOSED");
    expect(await tickDueLists()).toMatchObject({ RESTARTED: 0 });
    expect(await list()).toMatchObject({ status: "ACCEPTED", round: 2 });
  });

  it("accepting during the window: no restart afterwards", async () => {
    const b1 = await bid(f.S1);
    await acceptOffer(A(), listId, acceptOfferSchema.parse({ bidId: b1.id, addressId: f.addressA.id, idempotencyKey: `k-r-${Date.now()}` }));
    await endWindow();
    expect(await tickList(listId)).toBe("CLOSED");
    expect(await list()).toMatchObject({ status: "ACCEPTED", round: 1 });
    expect(await notes(f.customerA.id, "LIST_RESTARTED")).toBe(0);
  });

  it("customer cancel stops it — also right after the window ended, before any tick", async () => {
    await bid(f.S1);
    await cancelList(A(), listId);
    await endWindow();
    expect(await tickList(listId)).toBe("CLOSED");
    expect(await list()).toMatchObject({ status: "CANCELLED", round: 1 });
  });

  it("a cancel just after a round ended restarts first, then cancels (not 'closed')", async () => {
    await bid(f.S1);
    await endWindow();
    const c = await cancelList(A(), listId);
    expect(c.status).toBe("CANCELLED");
    expect(c.round).toBe(2);
    expect(await tickList(listId)).toBe("CLOSED");
  });

  it("admin cancel stops it", async () => {
    await bid(f.S1);
    await adminCancelList({ id: f.admin.id }, listId, "Customer asked by phone");
    await endWindow();
    expect(await tickList(listId)).toBe("CLOSED");
    expect(await tickDueLists()).toMatchObject({ RESTARTED: 0 });
    expect((await list()).status).toBe("CANCELLED");
  });

  it("repeats every round until max rounds, then ends as EXPIRED", async () => {
    await prisma.storeSettings.updateMany({ data: { listMaxRounds: 3 } });
    for (const round of [1, 2]) {
      await bid(f.S1);
      await endWindow();
      expect(await tickList(listId)).toBe("RESTARTED");
      expect((await list()).round).toBe(round + 1);
    }
    await bid(f.S1);
    await endWindow();
    expect(await tickList(listId)).toBe("EXPIRED");
    expect(await list()).toMatchObject({ status: "EXPIRED", round: 3 });
    const bids = await prisma.storeBid.findMany({ where: { listId }, orderBy: { round: "asc" } });
    expect(bids.map((b) => [b.round, b.status])).toEqual([
      [1, "EXPIRED"],
      [2, "EXPIRED"],
      [3, "EXPIRED"],
    ]);
    expect(await notes(f.customerA.id, "LIST_RESTARTED")).toBe(2);
    expect(await tickList(listId)).toBe("CLOSED");
    expect((await getCustomerList(A(), listId)).status).toBe("EXPIRED");
  });

  it("unlimited rounds (0): a list with no offers at all also restarts", async () => {
    for (let i = 0; i < 4; i++) {
      await endWindow();
      expect(await tickList(listId)).toBe("RESTARTED");
    }
    expect(await list()).toMatchObject({ status: "BIDDING", round: 5 });
  });

  it("my lists restarts a round that ended, so it shows as open in the new round", async () => {
    await bid(f.S1);
    await endWindow();
    const mine = await listCustomerLists(A(), { skip: 0, take: 10 });
    expect(mine.items[0]).toMatchObject({ id: listId, status: "BIDDING", round: 2, offerCount: 0 });
  });

  it("reminds the customer once per round about 6 h before the end (only with offers)", async () => {
    // No offers → no reminder.
    await prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() + 5 * HOUR) } });
    expect(await tickList(listId)).not.toBe("REMINDED");
    expect(await notes(f.customerA.id, "LIST_OFFERS_EXPIRING")).toBe(0);

    await bid(f.S1);
    // Too early (7 h left) → nothing.
    await prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() + 7 * HOUR) } });
    expect(await tickList(listId)).toBe("UNCHANGED");
    await prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() + 6 * HOUR - 60_000) } });
    expect(await tickList(listId)).toBe("REMINDED");
    expect(await tickList(listId)).toBe("UNCHANGED");
    expect(await tickDueLists()).toMatchObject({ REMINDED: 0 });
    expect(await notes(f.customerA.id, "LIST_OFFERS_EXPIRING")).toBe(1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: f.customerA.id, type: "LIST_OFFERS_EXPIRING" } });
    expect(n.title).toBe("Your offers expire in 6 hours — choose one");

    // Next round gets its own reminder.
    await endWindow();
    expect(await tickList(listId)).toBe("RESTARTED");
    await bid(f.S2);
    await prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() + 2 * HOUR) } });
    expect(await tickDueLists()).toMatchObject({ REMINDED: 1 });
    expect(await notes(f.customerA.id, "LIST_OFFERS_EXPIRING")).toBe(2);
  });

  it("parallel ticks restart once and notify once", async () => {
    await bid(f.S1);
    await bid(f.S2);
    await endWindow();
    const results = await Promise.all([
      tickList(listId),
      tickList(listId),
      tickList(listId),
      tickList(listId),
      tickDueLists(),
      getCustomerList(A(), listId),
    ]);
    expect(results.slice(0, 4).filter((r) => r === "RESTARTED").length).toBeLessThanOrEqual(1);
    const l = await list();
    expect(l.round).toBe(2);
    expect(await notes(f.customerA.id, "LIST_RESTARTED")).toBe(1);
    expect(await notes(f.S1.ownerId, "LIST_RESTARTED")).toBe(1);
    expect(await notes(f.S2.ownerId, "LIST_RESTARTED")).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: listId, action: "LIST_RESTARTED" } })).toBe(1);
    expect(await prisma.storeBid.count({ where: { listId, status: "EXPIRED" } })).toBe(2);
    expect(await prisma.listBroadcast.count({ where: { listId } })).toBe(2);
  });

  it("parallel ticks send the reminder once", async () => {
    await bid(f.S1);
    await prisma.itemList.update({ where: { id: listId }, data: { expiresAt: new Date(Date.now() + 3 * HOUR) } });
    await Promise.all([tickList(listId), tickList(listId), tickList(listId), tickDueLists(), tickDueLists()]);
    expect(await notes(f.customerA.id, "LIST_OFFERS_EXPIRING")).toBe(1);
  });

  it("admin settings: window hours and max rounds saved; leaving max rounds out keeps it", async () => {
    const base = (await getListSettings()) as unknown as Record<string, unknown>;
    const input = listSettingsSchema.parse({ ...base, expiryHours: 36, maxRounds: 4 });
    const saved = await saveListSettings({ id: f.admin.id }, input);
    expect(saved).toMatchObject({ expiryHours: 36, maxRounds: 4 });
    const { maxRounds: _omit, ...older } = saved;
    void _omit;
    const again = await saveListSettings({ id: f.admin.id }, listSettingsSchema.parse({ ...older, expiryHours: 40 }));
    expect(again).toMatchObject({ expiryHours: 40, maxRounds: 4 });
    expect(again.changed).toEqual(["expiryHours"]);
    expect(listSettingsSchema.safeParse({ ...base, maxRounds: -1 }).success).toBe(false);

    // The next restart uses the new window.
    await endWindow();
    await tickList(listId);
    expect(((await list()).expiresAt.getTime() - Date.now()) / HOUR).toBeCloseTo(40, 1);
  });
});
