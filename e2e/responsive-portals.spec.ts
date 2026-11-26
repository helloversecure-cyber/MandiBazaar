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
import { expect, test, type Page } from "@playwright/test";
import { findCoveredByBottomBar, PORTALS, signIn } from "./portal-pages";
import { findHorizontalOverflow, findSmallTapTargets, openPage } from "./responsive-audit";

const width = (page: Page) => page.viewportSize()!.width;

async function expectFits(page: Page, what: string) {
  expect(await findHorizontalOverflow(page), `${what}: L-01 nothing past the window edge`).toEqual([]);
  if (width(page) < 768) {
    expect(await findSmallTapTargets(page), `${what}: L-09 tap targets smaller than 44×44`).toEqual([]);
  }
}

for (const portal of PORTALS) {
  test.describe(`${portal.name} portal`, () => {
    test.beforeEach(async ({ context }) => {
      test.setTimeout(90_000);
      await signIn(context, portal.email);
    });

    for (const path of portal.pages) {
      test(`L-01/L-09 ${path}`, async ({ page }) => {
        await openPage(page, path);
        // Portal layouts check the session on the client first.
        await expect(page.locator("main")).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText(/^Loading( [\w ]+)?…$/)).toHaveCount(0, { timeout: 45_000 });
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
