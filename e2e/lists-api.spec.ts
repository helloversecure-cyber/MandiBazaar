/** W4 over HTTP on the real server: /api/lists and /api/lists/:id (B-01 … B-11). */
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import { ageCustomerLists } from "./list-bidding-helpers";

// Fresh lists-per-hour budget for Customer A (W18: the full suite at 6 widths shares one server).
test.beforeAll(() => ageCustomerLists());

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "w390", "API test: one width is enough");
});

const tokens: Record<string, string> = {};
function auth(email: string) {
  tokens[email] ??= execFileSync("npx", ["tsx", "e2e/mint-token.ts", email], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
  return { authorization: `Bearer ${tokens[email]}` };
}

async function addressId(request: APIRequestContext, email: string) {
  const res = await request.get("/api/addresses", { headers: auth(email) });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const list = Array.isArray(body.data) ? body.data : body.data.items ?? body.data.addresses;
  return list[0].id as string;
}

test("B-01..B-11 create, read, edit and cancel a list over HTTP", async ({ request }) => {
  const A = auth("customer.a@test.local");
  const addr = await addressId(request, "customer.a@test.local");

  // 401 without sign-in
  expect((await request.post("/api/lists", { data: {} })).status()).toBe(401);

  // 400 with a per-field message
  const bad = await request.post("/api/lists", { headers: A, data: { addressId: addr, lines: [{ name: "Atta", quantity: 0, unit: "kg" }] } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toMatchObject({ error: "Quantity must be more than 0", fieldErrors: { "lines.0.quantity": "Quantity must be more than 0" } });

  // 201 create
  const created = await request.post("/api/lists", {
    headers: A,
    data: { addressId: addr, note: "Ring the bell", lines: [{ name: "Atta", quantity: 10, unit: "kg" }, { name: "دودھ", quantity: 2, unit: "L" }] },
  });
  expect(created.status()).toBe(201);
  const list = (await created.json()).data;
  expect(list).toMatchObject({ status: "BIDDING", radiusKm: 5, note: "Ring the bell", offerCount: 0 });
  expect(list.lines[1].name).toBe("دودھ");

  // read + my lists
  expect((await (await request.get(`/api/lists/${list.id}`, { headers: A })).json()).data.id).toBe(list.id);
  const mine = (await (await request.get("/api/lists", { headers: A })).json()).data;
  expect(mine.items.map((l: { id: string }) => l.id)).toContain(list.id);
  expect(mine.pagination).toMatchObject({ page: 1, total: mine.items.length });

  // B-11 another customer gets 404
  const B = auth("customer.b@test.local");
  expect((await request.get(`/api/lists/${list.id}`, { headers: B })).status()).toBe(404);
  expect((await request.delete(`/api/lists/${list.id}`, { headers: B })).status()).toBe(404);

  // B-07 edit
  const edited = await request.patch(`/api/lists/${list.id}`, {
    headers: A,
    data: { lines: [{ id: list.lines[0].id, name: "Atta", quantity: 20, unit: "kg" }] },
  });
  expect(edited.status()).toBe(200);
  expect((await edited.json()).data).toMatchObject({ version: 2, note: "Ring the bell", lines: [{ quantity: 20 }] });

  // B-09 cancel, then B-10 can't cancel again
  expect((await (await request.delete(`/api/lists/${list.id}`, { headers: A })).json()).data.status).toBe("CANCELLED");
  const again = await request.delete(`/api/lists/${list.id}`, { headers: A });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("LIST_CLOSED");
});

test("feature switch: a customer who isn't a beta tester gets 403 while it's off", async ({ request }) => {
  const B = auth("customer.b@test.local");
  const res = await request.post("/api/lists", {
    headers: B,
    data: { addressId: "whatever", lines: [{ name: "Atta", quantity: 1, unit: "kg" }] },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe("FEATURE_OFF");
});
