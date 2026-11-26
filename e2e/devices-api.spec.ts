/** W10 over HTTP: register / remove an app install for push (J-01). */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "w390", "API test: one width is enough");
});

test("J-01 /api/devices registers and removes a push token", async ({ request }) => {
  const token = execFileSync("npx", ["tsx", "e2e/mint-token.ts", "customer.a@test.local"], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
  const headers = { authorization: `Bearer ${token}` };
  const fcm = "e2e-fcm-token-".padEnd(60, "z");

  expect((await request.post("/api/devices", { data: { token: fcm } })).status()).toBe(401);
  expect((await request.post("/api/devices", { headers, data: { token: "short" } })).status()).toBe(400);
  expect((await request.post("/api/devices", { headers, data: { token: fcm, platform: "ios" } })).status()).toBe(400);
  const ok = await request.post("/api/devices", { headers, data: { token: fcm } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).data).toEqual({ registered: true });
  expect((await request.delete("/api/devices", { headers, data: { token: fcm } })).status()).toBe(200);
});
