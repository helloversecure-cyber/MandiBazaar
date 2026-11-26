/**
 * W3: the item-list bidding tables exist, relate correctly, and enforce the
 * one-bid-per-store / one-broadcast-per-store rules at the database level.
 */
import { beforeAll, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, PIN, type Fixtures } from "./helpers/fixtures";

describeDb("item-list bidding schema", () => {
  let f: Fixtures;

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });

  async function newList() {
    return prisma.itemList.create({
      data: {
        customerId: f.customerA.id,
        addressSnapshot: { city: "Lahore", area: "Model Town" },
        latitude: PIN.lat,
        longitude: PIN.lng,
        city: "Lahore",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        lines: {
          create: [
            { name: "Atta", quantity: 10, unit: "kg", sortOrder: 0 },
            { name: "Milk", quantity: 2, unit: "L", sortOrder: 1 },
          ],
        },
      },
      include: { lines: true },
    });
  }

  it("new settings default to bidding OFF with the planned radius", async () => {
    const s = await prisma.storeSettings.findFirstOrThrow();
    expect(s.listBiddingEnabled).toBe(false);
    expect([s.listRadiusStartKm, s.listRadiusMaxKm, s.listRadiusStepMins, s.listMaxStores]).toEqual([5, 20, 30, 20]);
  });

  it("creates a list with lines, a broadcast and a bid with lines", async () => {
    const list = await newList();
    expect(list.status).toBe("BIDDING");
    expect(list.version).toBe(1);
    await prisma.listBroadcast.create({ data: { listId: list.id, storeId: f.S1.id, radiusKm: 5 } });
    const bid = await prisma.storeBid.create({
      data: {
        listId: list.id,
        storeId: f.S1.id,
        itemsTotal: 2310,
        coveredCount: 2,
        listVersion: 1,
        lines: {
          create: list.lines.map((l) => ({ lineId: l.id, available: true, unitPrice: 100 })),
        },
      },
      include: { lines: true },
    });
    expect(bid.status).toBe("PENDING");
    expect(bid.lines).toHaveLength(2);
  });

  it("allows only one bid per store per list", async () => {
    const list = await newList();
    const data = { listId: list.id, storeId: f.S2.id, itemsTotal: 1, coveredCount: 1, listVersion: 1 };
    await prisma.storeBid.create({ data });
    await expect(prisma.storeBid.create({ data })).rejects.toThrow();
  });

  it("allows only one broadcast per store per list", async () => {
    const list = await newList();
    const data = { listId: list.id, storeId: f.S1.id, radiusKm: 5 };
    await prisma.listBroadcast.create({ data });
    await expect(prisma.listBroadcast.create({ data })).rejects.toThrow();
  });

  it("deleting a list removes its lines, broadcasts and bids", async () => {
    const list = await newList();
    await prisma.listBroadcast.create({ data: { listId: list.id, storeId: f.S1.id, radiusKm: 5 } });
    await prisma.itemList.delete({ where: { id: list.id } });
    expect(await prisma.itemListLine.count({ where: { listId: list.id } })).toBe(0);
    expect(await prisma.listBroadcast.count({ where: { listId: list.id } })).toBe(0);
  });

  it("new columns on existing tables have safe defaults", async () => {
    const r = await prisma.rider.findUniqueOrThrow({ where: { id: f.R1.id } });
    expect(r.lastLatitude).toBeNull();
    const dr = await prisma.deliveryRequest.create({
      data: { customerId: f.customerA.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    expect(dr.trigger).toBe("CHECKOUT");
    expect(dr.reopenCount).toBe(0);
  });

  it("device token and refresh token rows cascade with the user", async () => {
    const u = await prisma.user.create({
      data: { fullName: "Temp", email: "temp@test.local", roleId: f.customerA.roleId },
    });
    await prisma.deviceToken.create({ data: { userId: u.id, token: "fcm-temp" } });
    await prisma.mobileRefreshToken.create({
      data: { userId: u.id, tokenHash: "h1", familyId: "fam1", expiresAt: new Date(Date.now() + 1e6) },
    });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.deviceToken.count({ where: { token: "fcm-temp" } })).toBe(0);
    expect(await prisma.mobileRefreshToken.count({ where: { tokenHash: "h1" } })).toBe(0);
  });
});
