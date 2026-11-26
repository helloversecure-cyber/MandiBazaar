/**
 * A-11: the website's cookie session still works after getSession() learned to
 * read app bearer tokens. Runs at every width (it renders a real page).
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { BASE_URL, E2E_SECRET } from "../playwright.config";

function cookieFor(email: string): string {
  return execFileSync("npx", ["tsx", "e2e/mint-token.ts", email, "--cookie"], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
}

test("A-11 signed-in customer sees their account pages, signed-out is sent to login", async ({ page, context }) => {
  await page.goto("/account/orders");
  await expect(page).toHaveURL(/\/login/);

  await context.addCookies([
    { name: "next-auth.session-token", value: cookieFor("customer.a@test.local"), url: BASE_URL },
  ]);
  const res = await page.goto("/account/orders", { waitUntil: "networkidle" });
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/account\/orders/);
  const api = await page.request.get("/api/account/orders");
  expect(api.status()).toBe(200);

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
