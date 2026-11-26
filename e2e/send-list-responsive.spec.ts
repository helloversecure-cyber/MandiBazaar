/**
 * W12 responsive checks (test cases L-01, L-04, L-05, L-09) for the new customer
 * pages at all 6 widths: send list, my lists, a list with offers, and a list
 * order with rider bids. Seeds (once, reused by every width): one open list
 * with 2 store offers, and one accepted list whose order has 2 rider bids.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { CUSTOMER_STATE } from "./global-setup";
import { addressIdA, bearer, markReady, riderBid, riderRequestId, seedRiders, storeBid } from "./list-bidding-helpers";
import { findHorizontalOverflow, findSmallTapTargets, openPage } from "./responsive-audit";

test.describe.configure({ timeout: 90_000 });
test.use({ storageState: CUSTOMER_STATE });

const OPEN_NOTE = "e2e responsive: open list";
const ORDER_NOTE = "e2e responsive: list order";

type ListRow = { id: string; status: string; note: string | null; offerCount: number; orderNumber: string | null };

async function myLists(request: APIRequestContext): Promise<ListRow[]> {
  const res = await request.get("/api/lists?limit=50", { headers: bearer("customer.a@test.local") });
  return (await res.json()).data.items;
}

async function createList(request: APIRequestContext, note: string) {
  const res = await request.post("/api/lists", {
    headers: bearer("customer.a@test.local"),
    data: {
      addressId: await addressIdA(request),
      note,
      lines: [
        { name: "Basmati rice (long grain, aged two years)", quantity: 5, unit: "kg" },
        { name: "Cooking oil", quantity: 3, unit: "L" },
        { name: "دیسی گھی خالص", quantity: 1.25, unit: "kg" },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data as ListRow;
}

/** One open list with 2 offers (reused across widths). */
async function openListWithOffers(request: APIRequestContext) {
  const found = (await myLists(request)).find((l) => l.note === OPEN_NOTE && l.status === "BIDDING" && l.offerCount >= 2);
  if (found) return found.id;
  const l = await createList(request, OPEN_NOTE);
  await storeBid(request, "owner.s1@test.local", l.id, [310, 540, 2400], { prepMinutes: 40, note: "Fresh stock today" });
  await storeBid(request, "owner.s2@test.local", l.id, [295, null, 2350], { prepMinutes: 25, discount: 100 });
  return l.id;
}

/** One accepted list whose order is packed and has 2 rider bids (reused across widths). */
async function listOrderWithRiderBids(request: APIRequestContext) {
  const found = (await myLists(request)).find((l) => l.note === ORDER_NOTE && l.orderNumber);
  if (found?.orderNumber) return found.orderNumber;
  const l = await createList(request, ORDER_NOTE);
  const bid = await storeBid(request, "owner.s1@test.local", l.id, [300, 500, 2300], { prepMinutes: 30 });
  const acc = await request.post(`/api/lists/${l.id}/accept`, {
    headers: bearer("customer.a@test.local"),
    data: { bidId: bid.bidId ?? bid.id, addressId: await addressIdA(request), idempotencyKey: `e2e-resp-${Date.now()}` },
  });
  expect(acc.status(), await acc.text()).toBe(201);
  const orderNumber = (await acc.json()).data.orderNumber as string;
  await markReady(request, "owner.s1@test.local", orderNumber);
  seedRiders("respa", "respb");
  const reqId = await riderRequestId(request, orderNumber);
  await riderBid(request, "rider.respa@test.local", reqId, 280);
  await riderBid(request, "rider.respb@test.local", reqId, 240);
  return orderNumber;
}

async function expectFits(page: Page) {
  expect(await findHorizontalOverflow(page), "L-01 nothing past the window edge").toEqual([]);
  if (page.viewportSize()!.width < 768) {
    expect(await findSmallTapTargets(page), "L-09 tap targets smaller than 44×44").toEqual([]);
  }
}

test("L-01/L-04/L-09 send list page", async ({ page }) => {
  await openPage(page, "/lists/new");
  await expect(page.getByRole("heading", { name: "Send a list to stores" })).toBeVisible();
  // Two more lines with long text so wrapping is exercised.
  await page.getByRole("button", { name: "Add item" }).click();
  const lines = page.getByTestId("list-line");
  await lines.nth(0).getByLabel(/Item name/).fill("Extra long item name to check the line wraps at 360 px wide");
  await lines.nth(1).getByLabel(/Item name/).fill("خالص چکی والا گندم کا آٹا");
  await lines.nth(1).getByRole("button", { name: "+ Add a note" }).click();
  await expectFits(page);
  const w = page.viewportSize()!.width;
  // L-04: line fields stay editable; on phones the send bar stays in view while typing.
  await lines.nth(1).getByLabel(/Quantity/).fill("2.5");
  await expect(lines.nth(1).getByLabel(/Quantity/)).toHaveValue("2.5");
  if (w < 1024) {
    const bar = page.locator("button:visible", { hasText: "Send to stores" });
    await expect(bar).toBeInViewport();
  }
  await expect(page.getByRole("button", { name: "Add item" })).toBeEnabled();
});

test("L-01/L-09 my lists", async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  await openListWithOffers(request);
  await openPage(page, "/account/lists");
  await expect(page.getByRole("heading", { name: "My lists" })).toBeVisible();
  await expect(page.locator('a[href^="/account/lists/"]').first()).toBeVisible();
  await expectFits(page);
});

test("L-01/L-05/L-09 offers on a list", async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const id = await openListWithOffers(request);
  await openPage(page, `/account/lists/${id}`);
  const cards = page.getByTestId("offer-card");
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByText("Item prices").click();
  await expectFits(page);
  const w = page.viewportSize()!.width;
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  if (w >= 1024) expect(Math.abs(a!.y - b!.y), "L-05 side by side from 1024 px").toBeLessThan(2);
  if (w < 768) expect(Math.abs(a!.x - b!.x), "L-05 stacked cards on phones").toBeLessThan(2);
  if (w < 1024) {
    await expect(page.getByTestId("accept-bar"), "sticky accept bar on phones/tablets").toBeInViewport();
  } else {
    await expect(page.getByTestId("accept-bar")).toBeHidden();
  }
  // The accept dialog fits too, with its buttons on screen.
  if (w < 1024) await page.getByTestId("accept-bar").getByRole("button", { name: "Accept offer" }).click();
  else await cards.nth(0).getByRole("button", { name: "Accept offer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Accept and place order" })).toBeInViewport();
  await expectFits(page);
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog).toBeHidden();
});

test("L-01/L-09 list order with rider bids", async ({ page, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const orderNumber = await listOrderWithRiderBids(request);
  await openPage(page, `/account/orders/${orderNumber}`);
  await expect(page.getByTestId("rider-bid")).toHaveCount(2);
  await expectFits(page);
});
