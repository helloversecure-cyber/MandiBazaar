/**
 * W12 in the browser: Customer A (a beta tester via LIST_BIDDING_BETA_EMAILS) sends
 * a list, stores bid (seeded over the store API), A compares and accepts an offer,
 * the store packs, riders bid, A chooses a rider. Test cases B-06, E-14, L-04, L-05.
 *
 * The full flow runs at one phone width (sticky accept bar) and one desktop width
 * (side-by-side offers); responsive checks for the new pages are in
 * send-list-responsive.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { CUSTOMER_STATE } from "./global-setup";
import { markReady, riderBid, riderRequestId, seedRiders, sessionCookie, storeBid } from "./list-bidding-helpers";
import { ensureCartItems } from "./responsive-audit";

test.describe.configure({ timeout: 120_000 });

const visibleButton = (page: Page, name: string | RegExp) =>
  page.locator("button:visible", { hasText: name });

test.describe("send a list → offers → accept → rider", () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeEach(({}, info) => {
    test.skip(!["w390", "w1280"].includes(info.project.name), "full flow at one phone and one desktop width");
  });

  test("customer sends a list, accepts an offer and chooses a rider", async ({ page, playwright }, info) => {
    // Cookie-free API client: stores and riders call with their own app tokens.
    const request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const phone = info.project.name === "w390";
    const riderA = `${info.project.name}a`;
    const riderB = `${info.project.name}b`;
    seedRiders(riderA, riderB);

    // Entry point on the home page (hidden unless the feature is on for this customer).
    await page.goto("/");
    // The home page card (the header has its own link on desktop, the menu drawer on phones).
    const entry = page.locator('main a[href="/lists/new"]', { hasText: "Send a list" });
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
    await expect(page).toHaveURL(/\/lists\/new$/);
    await expect(page.getByRole("heading", { name: "Send a list to stores" })).toBeVisible();

    // Compose: 3 lines, one with a bad quantity first.
    const lines = page.getByTestId("list-line");
    await lines.nth(0).getByLabel(/Item name/).fill("Desi ghee");
    await lines.nth(0).getByLabel(/Quantity/).fill("1.5");
    await lines.nth(0).getByLabel(/Unit/).fill("kg");
    await page.getByRole("button", { name: "Add item" }).click();
    await lines.nth(1).getByLabel(/Item name/).fill("Brown eggs");
    await lines.nth(1).getByLabel(/Quantity/).fill("0");
    await lines.nth(1).getByLabel(/Unit/).fill("dozen");
    await page.getByRole("button", { name: "Add item" }).click();
    await lines.nth(2).getByLabel(/Item name/).fill("Kinnow");
    await lines.nth(2).getByLabel(/Quantity/).fill("2");
    await lines.nth(2).getByLabel(/Unit/).fill("dozen");
    // L-04: the add button and the send button are reachable at phone width.
    await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
    await visibleButton(page, "Send to stores").click();
    await expect(lines.nth(1).getByText("Quantity must be more than 0")).toBeVisible();
    await expect(page).toHaveURL(/\/lists\/new$/);
    await lines.nth(1).getByLabel(/Quantity/).fill("1");
    await expect(page.getByText(/Model Town/).first()).toBeVisible(); // saved address picked
    await visibleButton(page, "Send to stores").click();

    await expect(page).toHaveURL(/\/account\/lists\/[^/?]+/, { timeout: 30_000 });
    const listId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByText("Waiting for offers…")).toBeVisible();
    await expect(page.getByText(/sent to stores near you/)).toBeVisible();

    // Two stores bid: S1 has everything (slower), S2 lacks eggs (cheaper, faster).
    await storeBid(request, "owner.s1@test.local", listId, [1400, 380, 300], { prepMinutes: 45 });
    await storeBid(request, "owner.s2@test.local", listId, [1300, null, 280], { prepMinutes: 20, discount: 50 });

    // Auto-refresh (~10 s) brings the offers in without a reload.
    const cards = page.getByTestId("offer-card");
    await expect(cards).toHaveCount(2, { timeout: 25_000 });
    const s1 = cards.filter({ hasText: "TEST S1" });
    const s2 = cards.filter({ hasText: "TEST S2" });
    await expect(s1.getByText("3 of 3")).toBeVisible();
    await expect(s2.getByText("2 of 3")).toBeVisible();
    await expect(s2.getByText("Lowest price")).toBeVisible();
    await expect(s2.getByText("Fastest")).toBeVisible();
    await expect(s2.getByText(/Doesn.t have:/).locator("..")).toContainText("Brown eggs");
    // 1.5 × 1300 + 2 × 280 − 50 = 2460
    await expect(s2.getByTestId("offer-total")).toHaveText(/2,460/);
    await s2.getByText("Item prices").click();
    await expect(s2.getByText("Not available")).toBeVisible();

    // L-05: cards stack on phones, sit side by side on desktop.
    const [b1, b2] = [await s1.boundingBox(), await s2.boundingBox()];
    if (phone) expect(Math.abs(b1!.x - b2!.x)).toBeLessThan(2);
    else expect(Math.abs(b1!.y - b2!.y)).toBeLessThan(2);

    // Accept S2: phones select + sticky bar, desktop the card's own button.
    if (phone) {
      await s2.getByRole("button", { name: /Select this offer|Selected/ }).click();
      const bar = page.getByTestId("accept-bar");
      await expect(bar).toContainText("TEST S2");
      await bar.getByRole("button", { name: "Accept offer" }).click();
    } else {
      await s2.getByRole("button", { name: "Accept offer" }).click();
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("These items will be left out")).toBeVisible();
    await expect(dialog.getByText("Brown eggs")).toBeVisible();
    await expect(dialog.getByText(/Delivery fee is set later by rider bidding/)).toBeVisible();
    await expect(dialog.getByText(/Cash on delivery/)).toBeVisible();
    await expect(dialog.getByTestId("accept-total")).toHaveText(/2,460/);
    await dialog.getByRole("button", { name: "Accept and place order" }).click();

    // E-14: a confirmed cash-on-delivery order.
    await expect(page).toHaveURL(/\/account\/orders\/[^/?]+\?from=list/, { timeout: 30_000 });
    const orderNumber = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByText(/Order placed\. The store is preparing it/)).toBeVisible();
    const riders = page.getByTestId("rider-bids");
    await expect(riders.getByText(/When the store has packed your order/)).toBeVisible();
    await expect(page.getByText("Set by rider bidding")).toBeVisible();

    // Store packs → riders bid (cheapest first) → the page refreshes on its own.
    await markReady(request, "owner.s2@test.local", orderNumber);
    const reqId = await riderRequestId(request, orderNumber);
    await riderBid(request, `rider.${riderA}@test.local`, reqId, 320);
    await riderBid(request, `rider.${riderB}@test.local`, reqId, 260);
    const bids = page.getByTestId("rider-bid");
    await expect(bids).toHaveCount(2, { timeout: 25_000 });
    await expect(bids.nth(0)).toContainText(`Rider ${riderB.toUpperCase()}`);
    await expect(bids.nth(0)).toContainText("Cheapest");
    await expect(bids.nth(0)).toContainText(/Rs\s?260/);
    await expect(bids.nth(1)).toContainText(/Rs\s?320/);

    await bids.nth(0).getByRole("button", { name: "Choose rider" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Choose rider" }).click();
    const assigned = page.getByTestId("assigned-rider");
    await expect(assigned).toContainText(`Rider ${riderB.toUpperCase()} is delivering your order`, { timeout: 20_000 });
    await expect(assigned).toContainText(/Delivery fee Rs\s?260/);
    // Products 2,460 + delivery 260 in cash.
    await expect(assigned).toContainText("2,720");

    // My lists shows the list as an order.
    await page.goto("/account/lists");
    const row = page.locator(`a[href="/account/lists/${listId}"]`);
    await expect(row).toContainText("Order placed");
    await expect(row).toContainText(orderNumber);
  });

  test("B-06: cart items go into the list with their products, plus a custom item", async ({ page, playwright }, info) => {
    test.skip(info.project.name !== "w390", "one width is enough");
    await ensureCartItems(playwright);
    await page.goto("/cart");
    await page.getByRole("link", { name: /Add custom items and let stores bid/ }).click();
    await expect(page).toHaveURL(/\/lists\/new\?from=cart/);
    const lines = page.getByTestId("list-line");
    await expect(lines).toHaveCount(3); // 2 from the cart + 1 empty
    await expect(lines.nth(0)).toContainText("from catalogue");
    await lines.nth(2).getByLabel(/Item name/).fill("Fresh mint");
    await lines.nth(2).getByLabel(/Quantity/).fill("2");
    await lines.nth(2).getByLabel(/Unit/).fill("bunch");
    await visibleButton(page, "Send to stores").click();
    await expect(page).toHaveURL(/\/account\/lists\/[^/?]+/, { timeout: 30_000 });
    const listId = new URL(page.url()).pathname.split("/").pop()!;
    const res = await page.request.get(`/api/lists/${listId}`);
    const list = (await res.json()).data as { lines: { name: string; productId: string | null }[] };
    expect(list.lines).toHaveLength(3);
    expect(list.lines.filter((l) => l.productId)).toHaveLength(2);
    expect(list.lines[2]).toMatchObject({ name: "Fresh mint", productId: null });

    // Edit while bidding, then cancel.
    await page.getByRole("button", { name: "Edit list" }).click();
    await page.getByTestId("list-line").nth(2).getByLabel(/Quantity/).fill("3.5");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/List updated/)).toBeVisible();
    await expect(page.getByText("3.5 bunch")).toBeVisible();
    await page.getByRole("button", { name: "Cancel list" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel list" }).click();
    await expect(page.getByText("Cancelled").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit list" })).toHaveCount(0);
  });
});

test("feature off: a customer who isn't a beta tester sees no entry points", async ({ browser }, info) => {
  test.skip(info.project.name !== "w1280", "one width is enough");
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "next-auth.session-token", value: sessionCookie("customer.b@test.local"), url: BASE_URL },
  ]);
  const page = await ctx.newPage();
  const config = page.waitForResponse((r) => r.url().includes("/api/app/config"), { timeout: 30_000 });
  await page.goto("/");
  const flags = await (await config).json();
  expect(flags.data.features.listBidding).toBe(false);
  await expect(page.getByRole("link", { name: "All products" }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('a[href="/lists/new"]')).toHaveCount(0);
  await page.goto("/lists/new");
  await expect(page.getByText("Sending a list isn't available yet")).toBeVisible({ timeout: 30_000 });
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Profile" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "My lists" })).toHaveCount(0);
  await ctx.close();
});
