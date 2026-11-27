/** W6 over HTTP: a store sees a list, bids, edits, and the customer gets the offer. */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import { ageCustomerLists } from "./list-bidding-helpers";

// Fresh lists-per-hour budget for Customer A (W18: the full suite at 6 widths shares one server).
test.beforeAll(() => ageCustomerLists());

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "w390", "API test: one width is enough");
});

const tokens: Record<string, string> = {};
const auth = (email: string) => {
  tokens[email] ??= execFileSync("npx", ["tsx", "e2e/mint-token.ts", email], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
  return { authorization: `Bearer ${tokens[email]}` };
};

test("D-01..D-13 store inbox, bid, edit, withdraw over HTTP", async ({ request }) => {
  const A = auth("customer.a@test.local");
  const S1 = auth("owner.s1@test.local");
  const S3 = auth("owner.s3@test.local");

  const addr = (await (await request.get("/api/addresses", { headers: A })).json()).data;
  const addressId = (Array.isArray(addr) ? addr : addr.items ?? addr.addresses)[0].id;
  const list = (await (await request.post("/api/lists", {
    headers: A,
    data: { addressId, lines: [{ name: "Atta", quantity: 10, unit: "kg" }, { name: "Milk", quantity: 2, unit: "L" }] },
  })).json()).data;

  // customers can't use store routes
  expect((await request.get("/api/store/lists", { headers: A })).status()).toBe(403);

  // S1's inbox has it; S3 (8 km) doesn't
  const inbox = (await (await request.get("/api/store/lists", { headers: S1 })).json()).data;
  expect(inbox.items.map((i: { listId: string }) => i.listId)).toContain(list.id);
  expect((await request.get(`/api/store/lists/${list.id}`, { headers: S3 })).status()).toBe(404);

  const view = (await (await request.get(`/api/store/lists/${list.id}`, { headers: S1 })).json()).data;
  expect(JSON.stringify(view)).not.toContain("03001234567");

  // bad price → 400 with field
  const bad = await request.put(`/api/store/lists/${list.id}/bid`, {
    headers: S1,
    data: { lines: view.lines.map((l: { id: string }) => ({ lineId: l.id, available: true, unitPrice: 0 })) },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).fieldErrors).toHaveProperty(["lines.0.unitPrice"]);

  // good bid
  const ok = await request.put(`/api/store/lists/${list.id}/bid`, {
    headers: S1,
    data: { lines: view.lines.map((l: { id: string }, i: number) => ({ lineId: l.id, available: true, unitPrice: [180, 230][i] })), prepMinutes: 30 },
  });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).data).toMatchObject({ itemsTotal: 2260, total: 2260, coveredCount: 2 });
  expect((await (await request.get(`/api/lists/${list.id}`, { headers: A })).json()).data.offerCount).toBe(1);

  // withdraw, then decline
  expect((await request.delete(`/api/store/lists/${list.id}/bid`, { headers: S1 })).status()).toBe(200);
  expect((await request.post(`/api/store/lists/${list.id}/decline`, { headers: S1, data: {} })).status()).toBe(200);

  // customer cancels → store can't bid any more
  await request.delete(`/api/lists/${list.id}`, { headers: A });
  const closed = await request.put(`/api/store/lists/${list.id}/bid`, {
    headers: S1,
    data: { lines: view.lines.map((l: { id: string }) => ({ lineId: l.id, available: true, unitPrice: 10 })) },
  });
  expect(closed.status()).toBe(409);
});
