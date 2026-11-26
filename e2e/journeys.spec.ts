/**
 * W18: end-to-end journeys that no other spec covers. The rest of the full flow
 * is already tested end to end and is not repeated here:
 *
 *   - send a list → store offers → accept → pack → rider bids → customer chooses:
 *     e2e/send-list.spec.ts (customer side, 390 + 1280)
 *   - store bids from the web portal, rider bids and delivers with the 4-digit code,
 *     admin switch / assign rider: e2e/bidding-portals.spec.ts
 *   - account deletion (M1-12, P-04) at every width: e2e/account-delete.spec.ts
 *   - app API role checks (K-01, K-02): e2e/lists-api.spec.ts, e2e/store-bids-api.spec.ts,
 *     e2e/mobile-auth-api.spec.ts and the vitest API suites
 *
 * Here:
 *   1. The normal cart checkout with cash on delivery, unchanged by list bidding:
 *      product page → cart → 4 checkout steps → confirmation → My orders, and the
 *      store sees the order in its portal. Every width (the phone layout has sticky bars).
 *   2. Portal role guards in the browser (K-02): signed out → the portal's sign-in page;
 *      a signed-in user with the wrong role → the access-denied page.
 */
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { sessionCookie } from "./list-bidding-helpers";

// A cold `next dev` compiles each page on first visit; give UI checks room.
const expect = baseExpect.configure({ timeout: 20_000 });

/** The visible one of several matching controls (phones repeat the main button in a sticky bar). */
const visible = (page: Page, role: "button" | "link", name: RegExp) =>
  page.getByRole(role, { name }).filter({ visible: true }).first();

test("normal cart checkout with cash on delivery, then the store sees the order", async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  const email = `journey.${info.project.name}@test.local`;
  await context.addCookies([{ name: "next-auth.session-token", value: sessionCookie(email), url: BASE_URL }]);

  // Product page → cart (Milk 1L keeps the order under the full-COD limit).
  await page.goto("/products/milk-1l");
  await visible(page, "button", /^add to cart$/i).click();
  await expect.poll(async () => ((await (await page.request.get("/api/cart")).json()).data?.items ?? []).length).toBe(1);

  await page.goto("/cart");
  await expect(page.getByText("Milk 1L").first()).toBeVisible();
  await visible(page, "link", /^proceed to checkout$/i)
    .or(visible(page, "button", /^proceed to checkout$/i))
    .first()
    .click();
  await expect(page).toHaveURL(/\/checkout$/);

  // 1 contact (prefilled from the account) → 2 saved address → 3 summary → 4 payment.
  await expect(page.locator("#co-name")).toHaveValue("Journey Tester");
  await visible(page, "button", /^continue$/i).click();
  await expect(page.getByText("House 1").first()).toBeVisible();
  await visible(page, "button", /^continue$/i).click();
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
  await expect(page.getByText(/Milk 1L × 1/)).toBeVisible();
  await visible(page, "button", /^continue to payment$/i).click();

  await page.getByRole("radio", { name: /Pay everything in cash to the rider/ }).check();
  await visible(page, "button", /^confirm order$/i).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\?order=/, { timeout: 45_000 });
  const orderNumber = new URL(page.url()).searchParams.get("order")!;
  expect(orderNumber).toMatch(/^ORD-\d{8}-\d+$/);
  await expect(page.getByText(orderNumber).first()).toBeVisible();

  // The order is a normal cart order paid in cash: nothing online, no list.
  const res = await page.request.get(`/api/orders/${orderNumber}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const order = (await res.json()).data;
  expect(order.paymentMethod).toBe("CASH_ON_DELIVERY");
  expect(Number(order.grandTotal)).toBeGreaterThan(230);
  expect(((await (await page.request.get("/api/cart")).json()).data?.items ?? []).length, "cart emptied").toBe(0);

  await page.goto("/account/orders");
  await expect(page.getByText(orderNumber).first()).toBeVisible();

  // The store sees it in its portal.
  const store = await browser.newContext({ viewport: page.viewportSize() });
  await store.addCookies([{ name: "next-auth.session-token", value: sessionCookie("owner.s1@test.local"), url: BASE_URL }]);
  const sp = await store.newPage();
  await sp.goto(`/store-portal/orders?tab=all&q=${orderNumber}`);
  await expect(sp.getByText(orderNumber).first()).toBeVisible({ timeout: 45_000 });
  await sp.getByRole("button", { name: "View order" }).first().click();
  await expect(sp.getByText("Milk 1L").first()).toBeVisible();
  await store.close();
});

test.describe("K-02 portal guards in the browser", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "w390", "role checks: one width is enough");
    test.setTimeout(90_000);
  });

  for (const [path, login, area] of [
    ["/admin", /\/login\?portal=admin/, "admin"],
    ["/store-portal", /\/store\?tab=login/, "store"],
    ["/rider-portal", /\/login\?portal=rider/, "rider"],
  ] as const) {
    test(`signed out: ${path} → sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(login, { timeout: 45_000 });
    });

    test(`customer: ${path} → access denied`, async ({ page, context }) => {
      await context.addCookies([
        { name: "next-auth.session-token", value: sessionCookie("customer.b@test.local"), url: BASE_URL },
      ]);
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/access-denied\\?area=${area}`), { timeout: 45_000 });
    });
  }

  test("a rider can't open the store or admin portal", async ({ page, context }) => {
    await context.addCookies([{ name: "next-auth.session-token", value: sessionCookie("rider.r2@test.local"), url: BASE_URL }]);
    for (const [path, area] of [
      ["/store-portal", "store"],
      ["/admin", "admin"],
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/access-denied\\?area=${area}`), { timeout: 45_000 });
    }
  });
});
