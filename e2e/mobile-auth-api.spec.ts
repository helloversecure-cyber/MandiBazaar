/**
 * W2 against the real Next.js server: an app access token works on existing API
 * routes (A-06) and role checks still apply (A-13). API behaviour doesn't depend
 * on screen width, so this runs in one project only.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "w390", "API test: one width is enough");
});

function tokenFor(email: string): string {
  return execFileSync("npx", ["tsx", "e2e/mint-token.ts", email], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
}

test("A-06 bearer token works on an existing customer route", async ({ request }) => {
  const token = tokenFor("customer.a@test.local");
  const res = await request.get("/api/account/orders", { headers: { authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(Array.isArray(body.data.items)).toBe(true);
});

test("A-06 no token is still 401 on that route", async ({ request }) => {
  const res = await request.get("/api/account/orders");
  expect(res.status()).toBe(401);
});

test("A-12 a garbage bearer token is 401", async ({ request }) => {
  const res = await request.get("/api/account/orders", { headers: { authorization: "Bearer abc.def.ghi" } });
  expect(res.status()).toBe(401);
});

test("A-13 a customer token can't use the store or rider API", async ({ request }) => {
  const token = tokenFor("customer.a@test.local");
  const store = await request.get("/api/store", { headers: { authorization: `Bearer ${token}` } });
  expect([401, 403]).toContain(store.status());
  const rider = await request.get("/api/rider", { headers: { authorization: `Bearer ${token}` } });
  expect([401, 403]).toContain(rider.status());
});

test("A-06 a store owner token works on the store API, a rider token on the rider API", async ({ request }) => {
  const owner = tokenFor("owner.s1@test.local");
  const s = await request.get("/api/store", { headers: { authorization: `Bearer ${owner}` } });
  expect(s.status()).toBe(200);
  const rider = tokenFor("rider.r1@test.local");
  const r = await request.get("/api/rider", { headers: { authorization: `Bearer ${rider}` } });
  expect(r.status()).toBe(200);
});

test("login endpoint validates input and blocks the admin portal", async ({ request }) => {
  const bad = await request.post("/api/mobile/auth/login", { data: { identifier: "", password: "" } });
  expect(bad.status()).toBe(401);
  const admin = await request.post("/api/mobile/auth/login", {
    data: { identifier: "admin@test.local", password: "x", portal: "admin" },
  });
  expect(admin.status()).toBe(403);
  const refresh = await request.post("/api/mobile/auth/refresh", { data: { refreshToken: "nope" } });
  expect(refresh.status()).toBe(401);
});
