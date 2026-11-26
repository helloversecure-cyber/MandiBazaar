/**
 * W17: every store-portal, rider-portal and admin page at the 6 widths of
 * docs/plans/test-cases.md §L (one Playwright project per width), signed in as
 * the right role with the e2e/seed.ts data. Unlike the W13–W15 checks in
 * bidding-portals.spec.ts these include the shared shell (header, bottom nav).
 *
 *   L-01  no horizontal scroll, nothing past the window edge
 *   L-07  sidebar from 1024 px; below that a bottom bar + "More" sheet
 *   L-08  wide tables never widen the page (they scroll inside their own box)
 *   L-09  tap targets at least 44 × 44 px below 768 px (whole page, shell included)
 *         sticky bars: the bottom bar never covers the end of the page
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { sessionCookie } from "./list-bidding-helpers";
import { findHorizontalOverflow, findSmallTapTargets, openPage } from "./responsive-audit";

test.describe.configure({ timeout: 90_000 });

const STORE_PAGES = [
  "/store-portal",
  "/store-portal/products",
  "/store-portal/deals",
  "/store-portal/orders",
  "/store-portal/orders?tab=all",
  "/store-portal/lists",
  "/store-portal/finance",
  "/store-portal/payouts",
  "/store-portal/settings",
];

const RIDER_PAGES = [
  "/rider-portal",
  "/rider-portal/bids",
  "/rider-portal/deliveries",
  "/rider-portal/remittances",
  "/rider-portal/earnings",
  "/rider-portal/profile",
];

const ADMIN_PAGES = [
  "/admin",
  "/admin/reports",
  "/admin/stores",
  "/admin/products",
  "/admin/categories",
  "/admin/inventory",
  "/admin/carousel",
  "/admin/orders",
  "/admin/orders/MB-E2E-0002",
  "/admin/riders",
  "/admin/bidding",
  "/admin/bidding/lists",
  "/admin/bidding/needs-rider",
  "/admin/bidding/settings",
  "/admin/payments",
  "/admin/payouts",
  "/admin/cash-collection",
  "/admin/finance",
  "/admin/refunds",
  "/admin/coupons",
  "/admin/customers",
  "/admin/staff",
  "/admin/reviews",
  "/admin/settings",
  "/admin/audit-logs",
];

const PORTALS = [
  { name: "store", email: "owner.s1@test.local", pages: STORE_PAGES },
  // R3 is offline and carries the seeded delivered + out-for-delivery orders.
  { name: "rider", email: "rider.r3@test.local", pages: RIDER_PAGES },
  { name: "admin", email: "admin@test.local", pages: ADMIN_PAGES },
];

const cookies = new Map<string, string>();
async function signIn(context: BrowserContext, email: string) {
  if (!cookies.has(email)) cookies.set(email, sessionCookie(email));
  await context.addCookies([{ name: "next-auth.session-token", value: cookies.get(email)!, url: BASE_URL }]);
}

const width = (page: Page) => page.viewportSize()!.width;

/** The bottom bar (fixed, < 1024 px) must not hide the last control or line of the page. */
async function findCoveredByBottomBar(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const bar = document.querySelector<HTMLElement>("[data-testid=portal-bottom-nav]");
    if (!bar || !bar.checkVisibility()) return [];
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const top = bar.getBoundingClientRect().top;
    const main = document.querySelector("main");
    if (!main) return ["no <main>"];
    let lowest: Element | null = null;
    let bottom = -Infinity;
    for (const el of Array.from(main.querySelectorAll("*"))) {
      if (el.children.length > 0 && !el.matches("a,button,input,select,textarea")) continue;
      if (!(el as HTMLElement).checkVisibility?.()) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom > bottom) {
        bottom = r.bottom;
        lowest = el;
      }
    }
    window.scrollTo(0, 0);
    if (lowest && bottom > top + 1) {
      const text = (lowest.textContent || "").trim().slice(0, 30);
      return [`<${lowest.tagName.toLowerCase()}> "${text}" ends at ${Math.round(bottom)}, bottom bar starts at ${Math.round(top)}`];
    }
    return [];
  });
}

async function expectFits(page: Page, what: string) {
  expect(await findHorizontalOverflow(page), `${what}: L-01 nothing past the window edge`).toEqual([]);
  if (width(page) < 768) {
    expect(await findSmallTapTargets(page), `${what}: L-09 tap targets smaller than 44×44`).toEqual([]);
  }
}

for (const portal of PORTALS) {
  test.describe(`${portal.name} portal`, () => {
    test.beforeEach(async ({ context }) => signIn(context, portal.email));

    for (const path of portal.pages) {
      test(`L-01/L-09 ${path}`, async ({ page }) => {
        await openPage(page, path);
        // Portal layouts check the session on the client first.
        await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText(/^Loading( [\w ]+)?…$/)).toHaveCount(0, { timeout: 45_000 });
        await expect(page.locator(".skeleton, .animate-pulse")).toHaveCount(0, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(250);
        await expectFits(page, path);
        expect(await findCoveredByBottomBar(page), `${path}: bottom bar covers content`).toEqual([]);
      });
    }

    test("L-07 navigation: sidebar from 1024 px, bottom bar + More sheet below", async ({ page }) => {
      await openPage(page, portal.pages[0]);
      await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
      const sidebar = page.locator("aside");
      const bar = page.getByTestId("portal-bottom-nav");
      if (width(page) >= 1024) {
        await expect(sidebar).toBeVisible();
        await expect(bar).toBeHidden();
        return;
      }
      await expect(sidebar).toBeHidden();
      await expect(bar).toBeVisible();
      await bar.getByRole("button", { name: "More" }).click();
      const sheet = page.getByRole("dialog", { name: "Menu" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(350); // pop-in animation
      await expectFits(page, "More sheet");
      // Every nav item is reachable from the sheet, and the sheet closes.
      const last = sheet.getByRole("link").last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toBeHidden();
    });
  });
}
