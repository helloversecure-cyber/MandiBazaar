/** W11 in the browser: account deletion (M1-12, P-04) at every width. */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, E2E_SECRET } from "../playwright.config";

const cookieFor = (email: string) =>
  execFileSync("npx", ["tsx", "e2e/mint-token.ts", email, "--cookie"], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();

async function noSideScroll(page: Page) {
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(sw, `page is ${sw}px wide in a ${w}px window`).toBeLessThanOrEqual(w);
}

test("P-04 the public delete-account page explains the steps", async ({ page }) => {
  const res = await page.goto("/delete-account", { waitUntil: "networkidle" });
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Delete your account" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Delete account/ }).first()).toHaveAttribute("href", "/account/delete");
  await noSideScroll(page);
});

test("M1-12 a customer deletes their account from the website", async ({ page, context }, info) => {
  const email = `delete.${info.project.name}@test.local`;
  await context.addCookies([{ name: "next-auth.session-token", value: cookieFor(email), url: BASE_URL }]);

  await page.goto("/account/security", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Delete account" }).last().click();
  await expect(page).toHaveURL(/\/account\/delete$/);
  await noSideScroll(page);

  await page.getByLabel("Type DELETE to confirm").fill("delete");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Type DELETE in capital letters" })).toBeVisible();

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/account=closed/, { timeout: 20_000 });

  // The closed account can't use the API any more with a fresh app token either.
  const token = execFileSync("npx", ["tsx", "e2e/mint-token.ts", email], {
    env: { ...process.env, NEXTAUTH_SECRET: E2E_SECRET },
    encoding: "utf8",
  }).trim();
  const api = await page.request.get("/api/account/orders", { headers: { authorization: `Bearer ${token}` } });
  expect(api.status()).toBe(401);
});

test("app config is public JSON", async ({ request }, info) => {
  test.skip(info.project.name !== "w390", "API test: one width is enough");
  const res = await request.get("/api/app/config");
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toMatchObject({ minAppVersion: expect.any(String), features: { listBidding: false } });
});
