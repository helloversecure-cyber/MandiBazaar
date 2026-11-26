/**
 * W13–W15 in the browser: store, rider and admin portals for item-list bidding.
 *
 * 1. A store bids from the web portal (per-line prices, "Don't have", live total,
 *    errors per line, list changed by the customer → reload with prices kept),
 *    the customer sees the offer, the store edits it, the customer accepts, and
 *    the store follows the link to its order ("From a customer list").
 * 2. The store marks the list order ready → a rider bids from the web rider
 *    portal → the customer chooses → the rider delivers with the 4-digit code.
 * 3. Admin switches list bidding off and on, and assigns a rider for a packed
 *    list order nobody bid on (Needs rider), then sees the history on the order.
 * 4. Responsive: the new pages at all 6 widths (L-01, L-06, L-08, L-09).
 *
 * Signed-in pages use NextAuth cookies minted for the seeded users; customer,
 * store and rider API calls use app tokens (e2e/list-bidding-helpers.ts).
 */
import { execFileSync } from "node:child_process";
import { expect as baseExpect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { addressIdA, ageCustomerLists, bearer, markReady, riderRequestId, seedRiders, sessionCookie, storeBid } from "./list-bidding-helpers";
import { findHorizontalOverflow, findSmallTapTargets, openPage } from "./responsive-audit";


// A cold `next dev` compiles each portal page on first visit; give UI checks room.
const expect = baseExpect.configure({ timeout: 15_000 });

const A = "customer.a@test.local";
const SHOTS = process.env.E2E_SCREENSHOTS || "test-results/screens";

async function signedIn(browser: Browser, email: string, info: { project: { use: { viewport?: { width: number; height: number } | null } } }) {
  const ctx = await browser.newContext({ viewport: info.project.use.viewport ?? undefined });
  await ctx.addCookies([{ name: "next-auth.session-token", value: sessionCookie(email), url: BASE_URL }]);
  return { ctx, page: await ctx.newPage() };
}

async function api(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
}


async function createList(request: APIRequestContext, note: string, lines: { name: string; quantity: number; unit: string }[]) {
  const send = async () =>
    request.post("/api/lists", { headers: bearer(A), data: { addressId: await addressIdA(request), note, lines } });
  let res = await send();
  if (res.status() === 429) {
    ageCustomerLists();
    res = await send();
  }
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data as { id: string; lines: { id: string; name: string; quantity: number; unit: string }[] };
}

async function accept(request: APIRequestContext, listId: string, bidId: string) {
  const res = await request.post(`/api/lists/${listId}/accept`, {
    headers: bearer(A),
    data: { bidId, addressId: await addressIdA(request), idempotencyKey: `e2e-portal-${Date.now()}-${Math.random()}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.orderNumber as string;
}

// Leave the lists-per-hour budget fresh for the specs that run after this one.
test.afterAll(() => ageCustomerLists());

const confirmDialog = (page: Page, name: string | RegExp) => page.getByRole("dialog").getByRole("button", { name }).click();

test.describe("store bids from the web portal", () => {
  test.beforeEach(({}, info) => {
    test.skip(!["w390", "w1280"].includes(info.project.name), "full flow at one phone and one desktop width");
  });

  test("store prices a list, the customer sees and accepts the offer, the store opens the order", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
    const request = await api(playwright);
    const phone = info.project.name === "w390";
    const list = await createList(request, `e2e store portal ${info.project.name}`, [
      { name: "Desi ghee", quantity: 1.5, unit: "kg" },
      { name: "Brown eggs", quantity: 2, unit: "dozen" },
    ]);
    const { ctx, page } = await signedIn(browser, "owner.s1@test.local", info);

    // Nav item with a badge (desktop sidebar; phones reach it from More).
    await page.goto("/store-portal");
    if (!phone) {
      const nav = page.locator("aside").getByRole("link", { name: /Incoming lists/ });
      await expect(nav).toBeVisible({ timeout: 30_000 });
      await expect(nav.locator("span[title]")).toHaveText(/\d+/);
      await nav.click();
    } else {
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("dialog").getByRole("link", { name: /Incoming lists/ }).click();
    }
    await expect(page).toHaveURL(/\/store-portal\/lists$/);
    const row = page.locator(`[data-testid=store-list-row][href*="${list.id}"]`);
    await expect(row).toContainText("Needs your offer");
    await expect(row).toContainText("2 items");
    await expect(row).toContainText(/left/);
    await row.click();

    await expect(page.getByRole("heading", { name: /2 items for a customer near you/ })).toBeVisible();
    await expect(page.getByText(/Model Town/).first()).toBeVisible();
    await expect(page.getByText("House 1")).toHaveCount(0); // never the house number (K-03)
    const lines = page.getByTestId("bid-line");
    await lines.nth(0).getByLabel(/Price per kg/).fill("1300");
    await expect(page.getByTestId("bid-total")).toHaveText(/1,950/); // 1.5 × 1300
    await lines.nth(1).getByLabel(/Price per dozen/).fill("0");
    await page.getByRole("button", { name: "Send offer" }).click();
    await expect(lines.nth(1).getByText(/Enter a price for Brown eggs/)).toBeVisible();

    // The customer edits the list while the store is typing → LIST_CHANGED, reload keeps the prices.
    const edit = await request.patch(`/api/lists/${list.id}`, {
      headers: bearer(A),
      data: {
        lines: [
          ...list.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, unit: l.unit })),
          { name: "Kinnow", quantity: 1, unit: "dozen" },
        ],
      },
    });
    expect(edit.ok(), await edit.text()).toBeTruthy();
    await lines.nth(1).getByLabel("Don't have").check();
    await page.getByRole("button", { name: "Send offer" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /customer changed this list/ })).toBeVisible();
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0).getByLabel(/Price per kg/)).toHaveValue("1300");
    await expect(lines.nth(1).getByLabel("Don't have")).toBeChecked();
    await page.getByRole("button", { name: "Send offer" }).click();
    await expect(lines.nth(2).getByText(/Enter a price for Kinnow/)).toBeVisible();
    await lines.nth(2).getByLabel(/Price per dozen/).fill("300");
    await page.getByLabel(/Discount/).fill("50");
    await page.getByLabel(/Preparation time/).fill("25");
    await expect(page.getByTestId("bid-total")).toHaveText(/2,200/); // 1950 + 300 − 50
    await page.getByRole("button", { name: "Send offer" }).click();
    await expect(page.getByTestId("my-offer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Offer sent").first()).toBeVisible();
    await expect(page.getByTestId("offer-total")).toHaveText(/2,200/);

    // The customer sees it.
    const cust = await signedIn(browser, A, info);
    await cust.page.goto(`/account/lists/${list.id}`);
    const card = cust.page.getByTestId("offer-card").filter({ hasText: "TEST S1" });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("offer-total")).toHaveText(/2,200/);
    await expect(card.getByText("2 of 3")).toBeVisible();

    // Edit: Kinnow 280 → total 2,180; the customer's page refreshes on its own.
    await page.getByRole("button", { name: "Edit offer" }).click();
    await lines.nth(2).getByLabel(/Price per dozen/).fill("280");
    await page.getByRole("button", { name: "Update offer" }).click();
    await expect(page.getByTestId("offer-total")).toHaveText(/2,180/, { timeout: 15_000 });
    await expect(card.getByTestId("offer-total")).toHaveText(/2,180/, { timeout: 25_000 });

    // Customer accepts → the store's list says so and links to the order.
    const view = await (await request.get(`/api/store/lists/${list.id}`, { headers: bearer("owner.s1@test.local") })).json();
    const orderNumber = await accept(request, list.id, view.data.myBid.id);
    await page.reload();
    const won = page.getByTestId("won-panel");
    await expect(won).toContainText(orderNumber);
    await won.getByRole("link", { name: `Open order ${orderNumber}` }).click();
    await expect(page).toHaveURL(new RegExp(`/store-portal/orders\\?tab=all&q=${orderNumber}`));
    await expect(page.getByText(orderNumber).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("From a customer list").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/store-order-from-list-${info.project.name}.png`, fullPage: true });

    // A second list: withdraw an offer, then "Can't supply".
    const other = await createList(request, `e2e withdraw ${info.project.name}`, [{ name: "Milk", quantity: 2, unit: "L" }]);
    await storeBid(request, "owner.s1@test.local", other.id, [230]);
    await page.goto(`/store-portal/lists/${other.id}`);
    await page.getByRole("button", { name: "Withdraw offer" }).click();
    await confirmDialog(page, "Withdraw offer");
    await expect(page.getByText("Offer withdrawn").first()).toBeVisible();
    await page.getByRole("button", { name: "Can't supply" }).click();
    await confirmDialog(page, "Can't supply");
    await expect(page.getByText("Can't supply").first()).toBeVisible();
    const after = await (await request.get(`/api/store/lists/${other.id}`, { headers: bearer("owner.s1@test.local") })).json();
    expect(after.data).toMatchObject({ declined: true, myBid: { status: "WITHDRAWN" } });

    await cust.ctx.close();
    await ctx.close();
    await request.dispose();
  });
});

test.describe("store ready → rider bids on the web → customer chooses → rider delivers with the code", () => {
  test.beforeEach(({}, info) => {
    test.skip(!["w390", "w1280"].includes(info.project.name), "full flow at one phone and one desktop width");
  });

  test("full rider flow from the portals", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
    const request = await api(playwright);
    const key = `p${info.project.name}`;
    seedRiders(key);
    const riderEmail = `rider.${key}@test.local`;
    const list = await createList(request, `e2e rider portal ${info.project.name}`, [{ name: "Atta", quantity: 2, unit: "kg" }]);
    const bid = await storeBid(request, "owner.s2@test.local", list.id, [500], { prepMinutes: 20 });
    const orderNumber = await accept(request, list.id, bid.id);

    // Store marks it ready from the orders page.
    const store = await signedIn(browser, "owner.s2@test.local", info);
    await store.page.goto(`/store-portal/orders?tab=all&q=${orderNumber}`);
    await expect(store.page.getByText("From a customer list").first()).toBeVisible({ timeout: 30_000 });
    await store.page.getByRole("button", { name: /Mark ready for pickup|Ready for pickup/ }).first().click();
    await store.page.getByRole("dialog").getByRole("button").last().click();
    await expect(store.page.getByTestId("rider-stage")).toContainText("Riders are bidding", { timeout: 20_000 });

    // Rider bids from the web rider portal.
    const rider = await signedIn(browser, riderEmail, info);
    await rider.page.goto("/rider-portal/bids");
    const reqId = await riderRequestId(request, orderNumber);
    const card = rider.page.locator(`[data-testid=rider-request][data-request-id="${reqId}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Packed order");
    await expect(card).toContainText("TEST S2");
    await expect(card).toContainText("Model Town");
    await expect(card).not.toContainText("House 1");
    await card.getByLabel("Your delivery fee in rupees").fill("0");
    await card.getByRole("button", { name: "Place bid" }).click();
    await expect(card.getByRole("alert")).toContainText("Enter your delivery fee");
    await card.getByLabel("Your delivery fee in rupees").fill("250");
    await card.getByRole("button", { name: "Place bid" }).click();
    await expect(card.getByTestId("my-bid")).toContainText(/Rs\s?250/, { timeout: 15_000 });
    await card.getByLabel("Your delivery fee in rupees").fill("230");
    await card.getByRole("button", { name: "Change bid" }).click();
    await expect(card.getByTestId("my-bid")).toContainText(/Rs\s?230/, { timeout: 15_000 });

    // Customer chooses the rider.
    const cust = await signedIn(browser, A, info);
    await cust.page.goto(`/account/orders/${orderNumber}`);
    const bids = cust.page.getByTestId("rider-bid").filter({ hasText: `Rider ${key.toUpperCase()}` });
    await expect(bids).toBeVisible({ timeout: 30_000 });
    await bids.getByRole("button", { name: "Choose rider" }).click();
    await cust.page.getByRole("dialog").getByRole("button", { name: "Choose rider" }).click();
    await expect(cust.page.getByTestId("assigned-rider")).toContainText(`Rider ${key.toUpperCase()}`, { timeout: 20_000 });

    // Store sees the rider; rider sees the won job and goes to deliveries.
    await store.page.reload();
    await expect(store.page.getByTestId("rider-stage")).toContainText(`Rider assigned: Rider ${key.toUpperCase()}`, { timeout: 20_000 });
    await rider.page.reload();
    const wonJobs = rider.page.getByTestId("won-jobs");
    await expect(wonJobs).toContainText(orderNumber, { timeout: 20_000 });
    await wonJobs.getByRole("link", { name: "Open my deliveries" }).click();
    await expect(rider.page).toHaveURL(/\/rider-portal\/deliveries/);
    const job = rider.page.locator("div.rounded-2xl, div.rounded-3xl").filter({ hasText: orderNumber }).filter({ has: rider.page.getByTestId("code-hint") }).first();
    await expect(job.getByTestId("code-hint")).toBeVisible({ timeout: 20_000 });
    await job.getByRole("button", { name: /Picked up/ }).click();
    const codeBox = rider.page.getByLabel("Customer's delivery code");
    await expect(codeBox).toBeVisible({ timeout: 20_000 });

    // Wrong code first, then the customer's code.
    const code = (await (await request.get(`/api/orders/${orderNumber}`, { headers: bearer(A) })).json()).data.deliveryCode.code as string;
    expect(code).toMatch(/^\d{4}$/);
    const wrong = code === "0000" ? "1111" : "0000";
    await codeBox.fill(wrong);
    await rider.page.getByRole("button", { name: /mark delivered/i }).click();
    await rider.page.getByRole("dialog").getByRole("button").last().click();
    await expect(rider.page.getByText(/Wrong delivery code\. 4 tries left/).first()).toBeVisible({ timeout: 15_000 });
    await codeBox.fill(code);
    await rider.page.getByRole("button", { name: /mark delivered/i }).click();
    await rider.page.getByRole("dialog").getByRole("button").last().click();
    await expect
      .poll(async () => (await (await request.get(`/api/orders/${orderNumber}`, { headers: bearer(A) })).json()).data.orderStatus, {
        timeout: 20_000,
      })
      .toBe("DELIVERED");
    await rider.page.screenshot({ path: `${SHOTS}/rider-delivered-${info.project.name}.png`, fullPage: true });

    for (const c of [store, rider, cust]) await c.ctx.close();
    await request.dispose();
  });
});

test.describe("admin", () => {
  test.beforeEach(({}, info) => {
    test.skip(!["w390", "w1280"].includes(info.project.name), "one phone and one desktop width");
  });

  test("switch list bidding off and on", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
    const request = await api(playwright);
    const admin = await signedIn(browser, "admin@test.local", info);
    const page = admin.page;
    const flagFor = async (email: string) =>
      (await (await request.get("/api/app/config", { headers: { cookie: `next-auth.session-token=${sessionCookie(email)}` } })).json()).data
        .features.listBidding as boolean;

    await page.goto("/admin/bidding/settings");
    const state = page.getByTestId("bidding-state");
    await expect(state).toHaveText(/ON|OFF/, { timeout: 30_000 });
    await expect(page.getByTestId("beta-emails")).toContainText(A);
    if ((await state.textContent()) === "ON") {
      await page.getByRole("button", { name: "Switch off" }).click();
      await confirmDialog(page, "Switch off");
      await expect(state).toHaveText("OFF");
    }
    expect(await flagFor("customer.b@test.local")).toBe(false);
    expect(await flagFor(A)).toBe(true); // beta tester keeps access

    await page.getByRole("button", { name: "Switch on" }).click();
    await confirmDialog(page, "Switch on");
    await expect(state).toHaveText("ON");
    expect(await flagFor("customer.b@test.local")).toBe(true);

    // A bad number shows next to its field.
    await page.getByLabel(/Starting radius/).fill("0");
    await page.getByLabel(/Starting radius/).press("Enter");
    await expect(page.getByText("At least 1 km").first()).toBeVisible();
    await page.getByLabel(/Starting radius/).fill("5");
    await page.getByLabel(/Starting radius/).press("Enter");
    await expect(page.getByText(/Settings saved|Nothing changed/).first()).toBeVisible();

    await page.getByRole("button", { name: "Switch off" }).click();
    await confirmDialog(page, "Switch off");
    await expect(state).toHaveText("OFF");
    expect(await flagFor("customer.b@test.local")).toBe(false);
    await page.screenshot({ path: `${SHOTS}/admin-settings-${info.project.name}.png`, fullPage: true });
    await admin.ctx.close();
    await request.dispose();
  });

  test("assign a rider for a list order nobody bid on", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
    const request = await api(playwright);
    const key = `n${info.project.name}`;
    seedRiders(key);
    const list = await createList(request, `e2e needs rider ${info.project.name}`, [{ name: "Rice", quantity: 5, unit: "kg" }]);
    const bid = await storeBid(request, "owner.s1@test.local", list.id, [300]);
    const orderNumber = await accept(request, list.id, bid.id);
    await markReady(request, "owner.s1@test.local", orderNumber);
    execFileSync("npx", ["tsx", "e2e/expire-post-pack.ts", orderNumber], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      stdio: "inherit",
    });

    const admin = await signedIn(browser, "admin@test.local", info);
    const page = admin.page;
    await page.goto("/admin/bidding/needs-rider");
    const item = page.getByTestId("needs-rider").getByTestId("queue-item").filter({ hasText: orderNumber });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(item).toContainText("Needs rider");
    await expect(item).toContainText("TEST S1");
    const select = item.getByLabel(`Rider for ${orderNumber}`);
    const riderId = await select.locator("option", { hasText: `Rider ${key.toUpperCase()}` }).getAttribute("value");
    await select.selectOption(riderId!);
    await item.getByRole("button", { name: "Assign rider" }).click();
    await confirmDialog(page, "Assign rider");
    await expect(page.getByText(new RegExp(`assigned to ${orderNumber}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("needs-rider").getByTestId("queue-item").filter({ hasText: orderNumber })).toHaveCount(0, {
      timeout: 15_000,
    });

    // Order page: list, offers and rider bidding history; delivery code tries.
    await page.goto(`/admin/orders/${orderNumber}`);
    const hist = page.getByTestId("order-bidding");
    await expect(hist).toContainText("From an item list", { timeout: 30_000 });
    await expect(hist).toContainText("TEST S1");
    await expect(hist).toContainText("Accepted");
    await expect(hist).toContainText("Rider bidding after packing");
    await expect(hist.getByTestId("code-attempts")).toContainText("0 wrong tries");
    await expect(page.getByRole("button", { name: "Reset delivery code" })).toBeVisible();
    await hist.getByRole("link", { name: "Open the list" }).click();
    await expect(page.getByTestId("admin-offer")).toHaveCount(1);
    await expect(page.getByTestId("list-history")).toContainText(/List offer accepted/i);

    // Lists overview links the order.
    await page.goto("/admin/bidding/lists");
    await expect(page.locator(`text=${orderNumber} >> visible=true`).first()).toBeVisible({ timeout: 30_000 });
    await admin.ctx.close();
    await request.dispose();
  });
});

// ── Responsive (L-01, L-06, L-08, L-09) ─────────────────────────────────────

const OPEN_NOTE = "e2e portals responsive: open";
const ORDER_NOTE = "e2e portals responsive: order";

/** One open list (S1 sees the bid form) and one packed list order with riders bidding; reused by every width. */
async function responsiveData(request: APIRequestContext) {
  const mine = (await (await request.get("/api/lists?limit=50", { headers: bearer(A) })).json()).data.items as {
    id: string;
    note: string | null;
    status: string;
    orderNumber: string | null;
  }[];
  let open = mine.find((l) => l.note === OPEN_NOTE && l.status === "BIDDING")?.id;
  if (!open) {
    open = (
      await createList(request, OPEN_NOTE, [
        { name: "Basmati rice (long grain, aged two years, premium)", quantity: 5, unit: "kg" },
        { name: "Cooking oil", quantity: 3, unit: "L" },
        { name: "دیسی گھی خالص", quantity: 1.25, unit: "kg" },
      ])
    ).id;
  }
  // Reuse the packed order only while riders can still bid on it (the window is a few minutes).
  let orderNumber: string | null = null;
  for (const l of mine.filter((x) => x.note === ORDER_NOTE && x.orderNumber)) {
    const v = await request.get(`/api/orders/${l.orderNumber}/rider-bids`, { headers: bearer(A) });
    if (v.ok() && (await v.json()).data.request?.biddingOpen) orderNumber = l.orderNumber;
  }
  if (!orderNumber) {
    const l = await createList(request, ORDER_NOTE, [{ name: "Sugar", quantity: 2, unit: "kg" }]);
    const bid = await storeBid(request, "owner.s1@test.local", l.id, [160]);
    orderNumber = await accept(request, l.id, bid.id);
    await markReady(request, "owner.s1@test.local", orderNumber);
  }
  return { open, orderNumber };
}

async function expectFits(page: Page, name: string, tapRoot = "main") {
  expect(await findHorizontalOverflow(page), `${name}: L-01 nothing past the window edge`).toEqual([]);
  if (page.viewportSize()!.width < 768) {
    expect(await findSmallTapTargets(page, tapRoot), `${name}: L-09 tap targets smaller than 44×44`).toEqual([]);
  }
}

test("L-01/L-06/L-09 store portal pages", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
  const request = await api(playwright);
  const { open, orderNumber } = await responsiveData(request);
  const { ctx, page } = await signedIn(browser, "owner.s1@test.local", info);
  const w = info.project.name;
  await openPage(page, "/store-portal/lists");
  await expect(page.getByTestId("store-list-row").first()).toBeVisible({ timeout: 30_000 });
  await expectFits(page, "lists");
  await page.screenshot({ path: `${SHOTS}/store-lists-${w}.png`, fullPage: true });

  await openPage(page, `/store-portal/lists/${open}`);
  await expect(page.getByTestId("bid-line").first()).toBeVisible({ timeout: 30_000 });
  await expectFits(page, "bid form");
  // L-06: "Don't have" and the price field sit in the line's own row at 360 px.
  const line = page.getByTestId("bid-line").first();
  const box = (await line.boundingBox())!;
  for (const el of [line.getByLabel("Don't have"), line.getByLabel(/Price per/)]) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await page.screenshot({ path: `${SHOTS}/store-bid-form-${w}.png`, fullPage: true });

  await openPage(page, `/store-portal/orders?tab=all&q=${orderNumber}`);
  await expect(page.getByText("From a customer list").first()).toBeVisible({ timeout: 30_000 });
  await expectFits(page, "orders", "[data-testid=rider-stage]");
  await page.screenshot({ path: `${SHOTS}/store-orders-${w}.png`, fullPage: true });
  await ctx.close();
  await request.dispose();
});

test("L-01/L-09 rider requests page", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
  const request = await api(playwright);
  await responsiveData(request);
  const key = `r${info.project.name}`;
  seedRiders(key);
  const { ctx, page } = await signedIn(browser, `rider.${key}@test.local`, info);
  await openPage(page, "/rider-portal/bids");
  await expect(page.getByTestId("rider-request").first()).toBeVisible({ timeout: 30_000 });
  await expectFits(page, "rider bids");
  await page.screenshot({ path: `${SHOTS}/rider-bids-${info.project.name}.png`, fullPage: true });
  await ctx.close();
  await request.dispose();
});

test("L-01/L-08/L-09 admin bidding pages", async ({ browser, playwright }, info) => {
    test.setTimeout(150_000);
  const request = await api(playwright);
  const { open, orderNumber } = await responsiveData(request);
  const { ctx, page } = await signedIn(browser, "admin@test.local", info);
  const w = info.project.name;
  const pages: [string, string, string?][] = [
    ["/admin/bidding/lists", "admin-lists"],
    [`/admin/bidding/lists/${open}`, "admin-list-detail"],
    ["/admin/bidding/needs-rider", "admin-needs-rider"],
    ["/admin/bidding/settings", "admin-settings"],
    [`/admin/orders/${orderNumber}`, "admin-order", "[data-testid=order-bidding]"],
  ];
  for (const [path, name, root] of pages) {
    await openPage(page, path);
    await page.waitForTimeout(300);
    if (name === "admin-lists") {
      // L-08: cards below 768 px, a table from 768 px.
      await expect(page.getByTestId(info.project.use.viewport!.width < 768 ? "lists-cards" : "lists-table")).toBeVisible({ timeout: 30_000 });
    }
    if (name === "admin-order") await expect(page.getByTestId("order-bidding")).toBeVisible({ timeout: 30_000 });
    await expectFits(page, name, root ?? "main");
    await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
  }
  await ctx.close();
  await request.dispose();
});
