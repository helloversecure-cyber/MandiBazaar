/**
 * W16: every customer-facing shop page at the 6 widths of docs/plans/test-cases.md §L
 * (one Playwright project per width, see playwright.config.ts).
 *
 *   L-01  no horizontal scroll, and no element pushed past the edge of the window
 *   L-02  product grids: 2+ columns on phones, 3+ from 768 px; images not stretched
 *   L-03  cart / checkout: total and main button on screen without scrolling (phones)
 *   L-09  tap targets at least 44 × 44 px below 768 px
 *   L-10  Urdu text (logo tagline, item names, FAQ) never overflows its box
 *
 * Signed-in pages use the Customer A session minted by e2e/mint-session.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { CUSTOMER_STATE } from "./global-setup";
import {
  SIGNED_IN_PAGES,
  PUBLIC_PAGES,
  ensureCartItems,
  findHorizontalOverflow,
  findSmallTapTargets,
  findStretchedImages,
  findUrduOverflow,
  openPage,
  productGridColumns,
} from "./responsive-audit";

const GRID_PAGES = ["/", "/products", "/stores/test-s1", "/search?q=atta"];

test.describe.configure({ timeout: 60_000 });

function width(page: Page) {
  return page.viewportSize()!.width;
}

async function expectPageFits(page: Page) {
  expect(await findHorizontalOverflow(page), "L-01 nothing past the window edge").toEqual([]);
  if (width(page) < 768) {
    expect(await findSmallTapTargets(page), "L-09 tap targets smaller than 44×44").toEqual([]);
  }
  expect(await findUrduOverflow(page), "L-10 Urdu text overflowing").toEqual([]);
}

test.describe("guest", () => {
  for (const path of PUBLIC_PAGES) {
    test(`L-01/L-09/L-10 ${path}`, async ({ page }) => {
      await openPage(page, path);
      await expectPageFits(page);
    });
  }

  test("L-01/L-09 mobile menu drawer", async ({ page }) => {
    await openPage(page, "/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    test.skip(!(await toggle.isVisible()), "no menu drawer at this width");
    await toggle.click();
    await page.waitForTimeout(400);
    await expectPageFits(page);
  });

  for (const path of GRID_PAGES) {
    test(`L-02 ${path} product grid`, async ({ page }) => {
      await openPage(page, path);
      const grids = await productGridColumns(page);
      expect(grids.length, "a product grid on the page").toBeGreaterThan(0);
      const min = width(page) < 768 ? 2 : 3;
      for (const g of grids) expect(g.cols, `columns of a ${g.width}px product grid`).toBeGreaterThanOrEqual(min);
      expect(await findStretchedImages(page), "images drawn at the wrong aspect ratio").toEqual([]);
    });
  }
});

test.describe("signed in", () => {
  test.use({ storageState: CUSTOMER_STATE });

  test.beforeAll(async ({ playwright }) => {
    await ensureCartItems(playwright);
  });

  for (const path of SIGNED_IN_PAGES) {
    test(`L-01/L-09/L-10 ${path}`, async ({ page }) => {
      await openPage(page, path);
      expect(new URL(page.url()).pathname, "stayed signed in").not.toBe("/login");
      await expectPageFits(page);
    });
  }

  /** L-03: on phones the total and the main button are on screen without scrolling to the bottom. */
  for (const [path, action, total] of [
    ["/cart", /^proceed to checkout$/i, /^total/i],
    ["/checkout", /^continue$/i, /^payable now$/i],
  ] as const) {
    test(`L-03 ${path} total and main action on screen`, async ({ page }) => {
      test.skip(width(page) >= 768, "phone widths only");
      await openPage(page, path);
      for (const at of ["top", "middle"] as const) {
        if (at === "middle") {
          await page.evaluate(() =>
            window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) / 2)
          );
          await page.waitForTimeout(250);
        }
        // On screen and not covered (e.g. by the bottom nav): the element at its centre is itself.
        const onScreen = async (role: "button" | "link" | "text", name: RegExp) => {
          const loc =
            role === "text"
              ? page.getByText(name)
              : page.getByRole("button", { name }).or(page.getByRole("link", { name }));
          return loc.evaluateAll((els) =>
            els.some((e) => {
              const r = e.getBoundingClientRect();
              if (r.width === 0 || r.top < 0 || r.bottom > window.innerHeight) return false;
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
            })
          );
        };
        expect(await onScreen("button", action), `${path}: main action on screen at ${at} of page`).toBe(true);
        expect(await onScreen("text", total), `${path}: total on screen at ${at} of page`).toBe(true);
      }
    });
  }
});
