import { beforeAll, expect, it } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";

describeDb("test database harness", () => {
  let f: Fixtures;

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });

  it("seeds the standard fixtures", async () => {
    expect(await prisma.store.count()).toBe(5);
    expect(await prisma.rider.count()).toBe(4);
    expect(f.S5.status).toBe("SUSPENDED");
    expect(f.R4.codRestrictedAt).not.toBeNull();
  });

  it("reset empties every table", async () => {
    await resetDb();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.store.count()).toBe(0);
  });
});
