/**
 * W4: customer creates, views, edits and cancels an item list
 * (test cases B-01 … B-14 in docs/plans/test-cases.md). Calls the service layer;
 * the HTTP routes are covered in e2e/lists-api.spec.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import {
  cancelList,
  createList,
  getCustomerList,
  listCustomerLists,
  ListError,
  MAX_LISTS_PER_HOUR,
  updateList,
} from "@/lib/lists/service";
import { createListSchema, updateListSchema, firstIssue } from "@/lib/lists/validation";
import { isBetaTester } from "@/lib/lists/settings";

const line = (name: string, quantity: number | string = 1, unit = "kg") => ({ name, quantity, unit });

describe("list input validation", () => {
  const ok = { addressId: "a1", lines: [line("Atta", 10)] };
  const issue = (v: unknown) => {
    const r = createListSchema.safeParse(v);
    return r.success ? null : firstIssue(r.error);
  };

  it("B-02 an empty list is refused", () => {
    expect(issue({ addressId: "a1", lines: [] })?.message).toBe("Add at least one item");
    expect(issue({ addressId: "a1" })?.message).toBe("Add at least one item");
  });

  it("B-03 more than 100 lines is refused", () => {
    const lines = Array.from({ length: 101 }, (_, i) => line(`Item ${i}`));
    expect(issue({ addressId: "a1", lines })?.message).toBe("A list can have at most 100 items");
    expect(issue({ addressId: "a1", lines: lines.slice(0, 100) })).toBeNull();
  });

  it("B-04 zero, negative and non-numeric quantities are refused, per line", () => {
    expect(issue({ addressId: "a1", lines: [line("Atta", 0)] })).toEqual({
      message: "Quantity must be more than 0",
      field: "lines.0.quantity",
    });
    expect(issue({ addressId: "a1", lines: [line("Atta", 1), line("Milk", -2)] })?.field).toBe("lines.1.quantity");
    expect(issue({ addressId: "a1", lines: [line("Atta", "ten")] })?.field).toBe("lines.0.quantity");
    expect(issue({ addressId: "a1", lines: [line("Atta", "2.5")] })).toBeNull();
  });

  it("blank names and units are refused; extra spaces are cleaned", () => {
    expect(issue({ addressId: "a1", lines: [line("   ", 1)] })?.message).toBe("Item name is required");
    expect(issue({ addressId: "a1", lines: [line("Atta", 1, " ")] })?.message).toBe("Unit is required");
    const r = createListSchema.parse({ addressId: "a1", lines: [line("  Basmati   rice ", 1)] });
    expect(r.lines[0].name).toBe("Basmati rice");
  });

  it("B-13 Urdu item names are accepted as typed", () => {
    expect(createListSchema.parse({ addressId: "a1", lines: [line("آٹا", 10)] }).lines[0].name).toBe("آٹا");
  });

  it("a valid list passes; an update needs something to change", () => {
    expect(issue(ok)).toBeNull();
    expect(updateListSchema.safeParse({}).success).toBe(false);
    expect(updateListSchema.safeParse({ note: "Ring the bell" }).success).toBe(true);
  });

  it("beta testers are read from LIST_BIDDING_BETA_EMAILS", () => {
    vi.stubEnv("LIST_BIDDING_BETA_EMAILS", " Test+UAT@MandiBazaar.pk , other@x.pk");
    expect(isBetaTester("test+uat@mandibazaar.pk")).toBe(true);
    expect(isBetaTester("someone@else.pk")).toBe(false);
    expect(isBetaTester(null)).toBe(false);
    vi.unstubAllEnvs();
  });
});

describeDb("lists service", () => {
  let f: Fixtures;
  const A = () => ({ id: f.customerA.id, email: f.customerA.email });
  const B = () => ({ id: f.customerB.id, email: f.customerB.email });
  const create = (lines = [line("Atta", 10), line("Milk", 2, "L"), line("Daal", 1)]) =>
    createList(A(), createListSchema.parse({ addressId: f.addressA.id, lines }));

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });
  beforeEach(async () => {
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: true } });
    await prisma.itemList.deleteMany();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("B-01 creates a list in BIDDING with radius 5 and lines in order", async () => {
    const l = await create();
    expect(l.status).toBe("BIDDING");
    expect(l.radiusKm).toBe(5);
    expect(l.noPin).toBe(false);
    expect(l.lines.map((x) => [x.name, x.quantity, x.unit])).toEqual([
      ["Atta", 10, "kg"],
      ["Milk", 2, "L"],
      ["Daal", 1, "kg"],
    ]);
    expect(l.city).toBe("Lahore");
    const hours = (new Date(l.expiresAt).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("feature switch: off for the public, on for beta testers", async () => {
    await prisma.storeSettings.updateMany({ data: { listBiddingEnabled: false } });
    await expect(create()).rejects.toMatchObject({ code: "FEATURE_OFF", status: 403 });
    vi.stubEnv("LIST_BIDDING_BETA_EMAILS", f.customerA.email!);
    await expect(create()).resolves.toMatchObject({ status: "BIDDING" });
  });

  it("B-05 an address without a pin is accepted and flagged", async () => {
    const addr = await prisma.address.create({
      data: {
        userId: f.customerA.id,
        fullName: "A",
        phone: "03001234567",
        houseBuilding: "H2",
        area: "Johar Town",
        city: "Lahore",
        province: "Punjab",
      },
    });
    const l = await createList(A(), createListSchema.parse({ addressId: addr.id, lines: [line("Atta")] }));
    expect(l.noPin).toBe(true);
  });

  it("someone else's address is refused", async () => {
    await expect(
      createList(B(), createListSchema.parse({ addressId: f.addressA.id, lines: [line("Atta")] }))
    ).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND", status: 404 });
  });

  it("unknown categories or inactive products are refused", async () => {
    await expect(
      createList(A(), createListSchema.parse({ addressId: f.addressA.id, lines: [{ ...line("Atta"), categoryId: "nope" }] }))
    ).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    await expect(
      createList(A(), createListSchema.parse({ addressId: f.addressA.id, lines: [{ ...line("Atta"), productId: "nope" }] }))
    ).rejects.toMatchObject({ code: "BAD_PRODUCT" });
  });

  it("B-07 editing while bidding replaces lines, keeps ids, bumps the version and tells stores that bid", async () => {
    const l = await create();
    await prisma.storeBid.create({
      data: { listId: l.id, storeId: f.S1.id, itemsTotal: 100, coveredCount: 3, listVersion: 1 },
    });
    const [atta, , daal] = l.lines;
    const edited = await updateList(
      A(),
      l.id,
      updateListSchema.parse({
        lines: [
          { id: atta.id, name: "Atta", quantity: 20, unit: "kg" },
          { id: daal.id, name: "Daal", quantity: 1, unit: "kg" },
          { name: "Sugar", quantity: 2, unit: "kg" },
        ],
      })
    );
    expect(edited.version).toBe(2);
    expect(edited.lines.map((x) => x.name)).toEqual(["Atta", "Daal", "Sugar"]);
    expect(edited.lines[0].id).toBe(atta.id);
    expect(edited.lines[0].quantity).toBe(20);
    const notes = await prisma.notification.findMany({ where: { userId: f.S1.ownerId, type: "LIST_CHANGED" } });
    expect(notes).toHaveLength(1);
  });

  it("editing only the note doesn't bump the version", async () => {
    const l = await create();
    const e = await updateList(A(), l.id, updateListSchema.parse({ note: "Call before coming" }));
    expect(e.note).toBe("Call before coming");
    expect(e.version).toBe(1);
  });

  it("editing only the lines keeps the note; sending an empty note clears it", async () => {
    const l = await create();
    await updateList(A(), l.id, updateListSchema.parse({ note: "Call before coming" }));
    const e = await updateList(A(), l.id, updateListSchema.parse({ lines: [line("Atta")] }));
    expect(e.note).toBe("Call before coming");
    const cleared = await updateList(A(), l.id, updateListSchema.parse({ note: "" }));
    expect(cleared.note).toBeNull();
  });

  it("a line id from another list is refused", async () => {
    const l1 = await create();
    const l2 = await create();
    await expect(
      updateList(A(), l2.id, updateListSchema.parse({ lines: [{ id: l1.lines[0].id, name: "X", quantity: 1, unit: "kg" }] }))
    ).rejects.toMatchObject({ code: "BAD_LINE" });
  });

  it("B-08 / B-10 an accepted list can't be edited or cancelled", async () => {
    const l = await create();
    await prisma.itemList.update({ where: { id: l.id }, data: { status: "ACCEPTED" } });
    await expect(updateList(A(), l.id, updateListSchema.parse({ note: "x" }))).rejects.toMatchObject({
      code: "ORDER_PLACED",
      status: 409,
    });
    await expect(cancelList(A(), l.id)).rejects.toMatchObject({ code: "ORDER_PLACED", status: 409 });
  });

  it("B-09 cancelling closes pending offers and tells those stores", async () => {
    const l = await create();
    await prisma.storeBid.create({
      data: { listId: l.id, storeId: f.S2.id, itemsTotal: 100, coveredCount: 3, listVersion: 1 },
    });
    const c = await cancelList(A(), l.id);
    expect(c.status).toBe("CANCELLED");
    const bid = await prisma.storeBid.findFirstOrThrow({ where: { listId: l.id } });
    expect(bid.status).toBe("NOT_SELECTED");
    expect(await prisma.notification.count({ where: { userId: f.S2.ownerId, type: "LIST_CANCELLED" } })).toBe(1);
    await expect(cancelList(A(), l.id)).rejects.toMatchObject({ code: "LIST_CLOSED" });
  });

  it("B-11 another customer can't see, edit or cancel the list", async () => {
    const l = await create();
    await expect(getCustomerList(B(), l.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateList(B(), l.id, updateListSchema.parse({ note: "x" }))).rejects.toMatchObject({ status: 404 });
    await expect(cancelList(B(), l.id)).rejects.toMatchObject({ status: 404 });
    expect((await listCustomerLists(B(), { skip: 0, take: 10 })).total).toBe(0);
  });

  it("B-12 at most 10 lists per hour per customer", async () => {
    for (let i = 0; i < MAX_LISTS_PER_HOUR; i++) await create([line(`Item ${i}`)]);
    await expect(create()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("a list past its deadline shows as EXPIRED and can't be edited", async () => {
    const l = await create();
    await prisma.itemList.update({ where: { id: l.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getCustomerList(A(), l.id)).status).toBe("EXPIRED");
    await expect(updateList(A(), l.id, updateListSchema.parse({ note: "x" }))).rejects.toMatchObject({
      code: "LIST_CLOSED",
    });
  });

  it("B-14 create, edit and cancel are written to the audit log", async () => {
    await prisma.auditLog.deleteMany();
    const l = await create();
    await updateList(A(), l.id, updateListSchema.parse({ note: "x" }));
    await cancelList(A(), l.id);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: l.id }, orderBy: { createdAt: "asc" } })).map(
      (a) => a.action
    );
    expect(actions).toEqual(["LIST_CREATED", "LIST_EDITED", "LIST_CANCELLED"]);
  });

  it("two edits at the same moment both apply in order (row lock)", async () => {
    const l = await create();
    await Promise.all([
      updateList(A(), l.id, updateListSchema.parse({ lines: [line("A")] })),
      updateList(A(), l.id, updateListSchema.parse({ lines: [line("B"), line("C")] })),
    ]);
    const final = await getCustomerList(A(), l.id);
    expect(final.version).toBe(3);
    expect(["A", "B,C"]).toContain(final.lines.map((x) => x.name).join(","));
  });

  it("ListError is exported for routes", () => {
    expect(new ListError("X", "y", 418).status).toBe(418);
  });
});
