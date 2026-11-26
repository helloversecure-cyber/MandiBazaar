/**
 * GET /api/stores?lat=&lng=&radiusKm= — nearby stores for the app home.
 * Fixture stores sit north of PIN: S1 2 km, S4 3 km, S2 4 km, S3 8 km, S5 2 km (suspended).
 */
import { beforeAll, expect, it, vi } from "vitest";

// Signed-out visitor: no cookie session, no bearer header.
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => null),
}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));

import { NextRequest } from "next/server";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { PIN, seedStandardFixtures } from "./helpers/fixtures";
import { GET } from "@/app/api/stores/route";

type Item = { name: string; distanceKm: number } & Record<string, unknown>;

async function nearby(query: string) {
  const res = await GET(new NextRequest(`http://x/api/stores?${query}`));
  return { status: res.status, body: await res.json() };
}

describeDb("nearby stores", () => {
  beforeAll(async () => {
    await resetDb();
    await seedStandardFixtures();
    // A virtual (online-only) store at the pin must never show up as "near you".
    const s1 = await prisma.store.findFirstOrThrow({ where: { name: "TEST S1" } });
    await prisma.store.create({
      data: {
        name: "TEST VIRTUAL", slug: "test-virtual", status: "APPROVED", isVirtual: true,
        addressLine: "-", area: "-", city: "Lahore", province: "Punjab",
        latitude: PIN.lat, longitude: PIN.lng, ownerId: s1.ownerId, approvedAt: new Date(),
      },
    });
  });

  it("returns approved, non-virtual stores within the radius, nearest first", async () => {
    const { status, body } = await nearby(`lat=${PIN.lat}&lng=${PIN.lng}&radiusKm=5`);
    expect(status).toBe(200);
    const items = body.data.items as Item[];
    expect(items.map((s) => s.name)).toEqual(["TEST S1", "TEST S4", "TEST S2"]);
    expect(items.map((s) => s.distanceKm)).toEqual([2, 3, 4]);
    expect(body.data.pagination).toMatchObject({ page: 1, total: 3, totalPages: 1 });
    expect(body.data.radiusKm).toBe(5);
  });

  it("never returns the store's own coordinates or private fields", async () => {
    const { body } = await nearby(`lat=${PIN.lat}&lng=${PIN.lng}`);
    for (const s of body.data.items as Item[]) {
      for (const k of ["latitude", "longitude", "addressLine", "ownerId", "owner", "cnicNumber", "bankIban"]) {
        expect(s).not.toHaveProperty(k);
      }
    }
  });

  it("defaults to 10 km, caps at 50 km, and pages", async () => {
    expect(((await nearby(`lat=${PIN.lat}&lng=${PIN.lng}`)).body.data.items as Item[]).length).toBe(4);
    expect((await nearby(`lat=${PIN.lat}&lng=${PIN.lng}&radiusKm=999`)).body.data.radiusKm).toBe(50);
    const p2 = await nearby(`lat=${PIN.lat}&lng=${PIN.lng}&limit=2&page=2`);
    expect((p2.body.data.items as Item[]).map((s) => s.name)).toEqual(["TEST S2", "TEST S3"]);
  });

  it("rejects missing or invalid coordinates", async () => {
    for (const q of ["lat=31.5", "lng=74.3", "lat=abc&lng=74.3", "lat=91&lng=74.3", "lat=31.5&lng=181"]) {
      expect((await nearby(q)).status).toBe(400);
    }
  });

  it("leaves the normal public store list unchanged", async () => {
    const { status, body } = await nearby("page=1&limit=50");
    expect(status).toBe(200);
    expect((body.data.items as Item[]).some((s) => s.name === "TEST VIRTUAL")).toBe(true);
    expect((body.data.items as Item[])[0]).not.toHaveProperty("distanceKm");
  });
});
