/**
 * W5: sending a list to nearby stores and widening the radius (C-01 … C-12).
 * Fixtures: S1 2 km Grocery, S2 4 km Grocery, S3 8 km Grocery, S4 3 km Pharmacy,
 * S5 2 km Grocery SUSPENDED; customer A's pin in Model Town.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { PIN, seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { createList, getCustomerList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";
import { tickDueLists, tickList } from "@/lib/lists/broadcast";

const KM = 1 / 111;
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

describeDb("list broadcast", () => {
  let f: Fixtures;
  let grocery: string;
  const A = () => ({ id: f.customerA.id, email: f.customerA.email });

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    grocery = (await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  const groceryList = (addressId = f.addressA.id) =>
    createList(
      A(),
      createListSchema.parse({
        addressId,
        lines: [
          { name: "Atta", quantity: 10, unit: "kg", categoryId: grocery },
          { name: "Milk", quantity: 2, unit: "L" },
        ],
      })
    );
  const sentTo = async (listId: string) =>
    (await prisma.listBroadcast.findMany({ where: { listId }, include: { store: true }, orderBy: { distanceKm: "asc" } })).map(
      (b) => b.store.name
    );

  it("C-01/C-02/C-03 first circle: only approved grocery stores within 5 km, nearest first", async () => {
    const l = await groceryList();
    expect(l.radiusKm).toBe(5);
    expect(await sentTo(l.id)).toEqual(["TEST S1", "TEST S2"]); // not S3 (8 km), S4 (pharmacy), S5 (suspended)
    const b = await prisma.listBroadcast.findFirstOrThrow({ where: { listId: l.id, storeId: f.S1.id } });
    expect(Number(b.distanceKm)).toBeCloseTo(2, 0);
    expect(b.radiusKm).toBe(5);
  });

  it("C-02 a pharmacy that also has an active grocery product does get it", async () => {
    await prisma.product.create({
      data: { storeId: f.S4.id, categoryId: grocery, name: "Sugar", slug: "sugar", sku: "SUG", price: 150, unit: "kg", status: "ACTIVE" },
    });
    const l = await groceryList();
    expect(await sentTo(l.id)).toEqual(["TEST S1", "TEST S4", "TEST S2"]);
  });

  it("a list with no categories goes to every approved store in range", async () => {
    const l = await createList(A(), createListSchema.parse({ addressId: f.addressA.id, lines: [{ name: "Eggs", quantity: 12, unit: "pcs" }] }));
    expect(await sentTo(l.id)).toEqual(["TEST S1", "TEST S4", "TEST S2"]);
  });

  it("C-04 at most 20 stores per step, the nearest ones", async () => {
    const owner = f.S1.ownerId;
    for (let i = 0; i < 30; i++) {
      await prisma.store.create({
        data: {
          name: `Extra ${String(i).padStart(2, "0")}`,
          slug: `extra-${i}`,
          status: "APPROVED",
          addressLine: "x",
          city: "Lahore",
          province: "Punjab",
          latitude: PIN.lat + (0.1 + i * 0.1) * KM,
          longitude: PIN.lng,
          requestedCategories: ["Grocery"],
          ownerId: owner,
        },
      });
    }
    const l = await groceryList();
    const names = await sentTo(l.id);
    expect(names).toHaveLength(20);
    expect(names[0]).toBe("Extra 00");
    expect(names).not.toContain("TEST S2"); // 4 km is farther than the 20 nearest extras (0.1-2.0 km)
  });

  it("C-05 after 30 minutes with no offer the radius grows to 10 km and S3 gets it, S1/S2 aren't sent again", async () => {
    const l = await groceryList();
    expect(await tickList(l.id, minutes(29))).toBe("UNCHANGED");
    expect(await tickList(l.id, minutes(31))).toBe("WIDENED");
    const fresh = await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } });
    expect(fresh.radiusKm).toBe(10);
    expect(await sentTo(l.id)).toEqual(["TEST S1", "TEST S2", "TEST S3"]);
    const notes = await prisma.notification.count({ where: { userId: f.S1.ownerId, type: "NEW_LIST" } });
    expect(notes).toBe(1);
  });

  it("C-06 no widening once a store has made an offer", async () => {
    const l = await groceryList();
    await prisma.storeBid.create({ data: { listId: l.id, storeId: f.S1.id, itemsTotal: 100, coveredCount: 2, listVersion: 1 } });
    expect(await tickList(l.id, minutes(45))).toBe("UNCHANGED");
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } })).radiusKm).toBe(5);
  });

  it("C-07 widens right away when every store that got it says it can't supply", async () => {
    const l = await groceryList();
    await prisma.listBroadcast.updateMany({ where: { listId: l.id }, data: { declinedAt: new Date() } });
    expect(await tickList(l.id)).toBe("WIDENED");
    expect(await sentTo(l.id)).toContain("TEST S3");
  });

  it("C-08 nothing at 20 km and no offer: NO_STORES and the customer is told", async () => {
    const l = await groceryList();
    expect(await tickList(l.id, minutes(31))).toBe("WIDENED"); // → 10 km, S3
    // Nothing new at 15 or 20 km → straight to NO_STORES.
    expect(await tickList(l.id, minutes(62))).toBe("NO_STORES");
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("NO_STORES");
    expect(await prisma.notification.count({ where: { userId: f.customerA.id, type: "LIST_NO_STORES" } })).toBe(1);
  });

  it("C-08 a list with no store anywhere ends as NO_STORES as soon as it's sent", async () => {
    await prisma.store.updateMany({ data: { status: "SUSPENDED" } });
    const l = await groceryList();
    expect(l.status).toBe("NO_STORES");
    expect(l.radiusKm).toBe(20);
  });

  it("an empty first circle widens immediately at creation", async () => {
    await prisma.store.updateMany({ where: { id: { in: [f.S1.id, f.S2.id] } }, data: { status: "SUSPENDED" } });
    const l = await groceryList();
    expect(l.radiusKm).toBe(10);
    expect(await sentTo(l.id)).toEqual(["TEST S3"]);
  });

  it("C-09 opening the list advances it when due (no scheduler needed)", async () => {
    const l = await groceryList();
    await prisma.itemList.update({ where: { id: l.id }, data: { lastWidenedAt: minutes(-31) } });
    const seen = await getCustomerList(A(), l.id);
    expect(seen.radiusKm).toBe(10);
  });

  it("C-10 the cron sweep advances due lists and the endpoint needs the secret", async () => {
    const l = await groceryList();
    await prisma.itemList.update({ where: { id: l.id }, data: { lastWidenedAt: minutes(-31) } });
    const r = await tickDueLists();
    expect(r).toMatchObject({ checked: 1, WIDENED: 1 });

    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET } = await import("@/app/api/cron/lists-tick/route");
    const { NextRequest } = await import("next/server");
    expect((await GET(new NextRequest("http://x/api/cron/lists-tick"))).status).toBe(401);
    const ok = await GET(new NextRequest("http://x/api/cron/lists-tick", { headers: { authorization: "Bearer s3cret" } }));
    expect(ok.status).toBe(200);
  });

  it("an expired list is closed by the tick", async () => {
    const l = await groceryList();
    await prisma.itemList.update({ where: { id: l.id }, data: { expiresAt: minutes(-1) } });
    expect(await tickList(l.id)).toBe("EXPIRED");
  });

  it("C-11 a same-city store without a pin is included after pinned stores", async () => {
    await prisma.store.update({ where: { id: f.S3.id }, data: { latitude: null, longitude: null } });
    const l = await groceryList();
    expect(await sentTo(l.id)).toEqual(["TEST S1", "TEST S2", "TEST S3"]);
    expect((await prisma.listBroadcast.findFirstOrThrow({ where: { listId: l.id, storeId: f.S3.id } })).distanceKm).toBeNull();
  });

  it("B-05 a list without a pin goes to stores in the same city", async () => {
    const addr = await prisma.address.create({
      data: { userId: f.customerA.id, fullName: "A", phone: "03001234567", houseBuilding: "H", area: "Gulberg", city: "lahore", province: "Punjab" },
    });
    const l = await groceryList(addr.id);
    expect((await sentTo(l.id)).sort()).toEqual(["TEST S1", "TEST S2", "TEST S3"]);
  });

  it("C-12 each store owner gets a 'New list near you' notification with the list id", async () => {
    const l = await groceryList();
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: f.S1.ownerId, type: "NEW_LIST" } });
    expect(n.title).toBe("New list near you");
    expect(n.body).toMatch(/2\.\d km away in Model Town, Lahore needs 2 items/);
    expect((n.metadata as { listId: string }).listId).toBe(l.id);
  });

  it("two parallel ticks widen only once", async () => {
    const l = await groceryList();
    const res = await Promise.all([tickList(l.id, minutes(31)), tickList(l.id, minutes(31))]);
    expect(res.sort()).toEqual(["UNCHANGED", "WIDENED"]);
    expect((await prisma.itemList.findUniqueOrThrow({ where: { id: l.id } })).radiusKm).toBe(10);
  });
});
