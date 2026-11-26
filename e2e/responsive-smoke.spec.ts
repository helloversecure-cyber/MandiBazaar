import { expect, test, type Page } from "@playwright/test";

/** L-01: no page may scroll sideways at any of the 6 widths. */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${innerWidth}px window`).toBeLessThanOrEqual(innerWidth);
}

const PUBLIC_PAGES = ["/", "/products", "/stores", "/cart", "/login", "/about", "/faq"];

for (const path of PUBLIC_PAGES) {
  test(`L-01 ${path} loads without horizontal scroll`, async ({ page }) => {
    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    await expectNoHorizontalScroll(page);
  });
}

test("seeded products are visible on /products", async ({ page }) => {
  await page.goto("/products", { waitUntil: "networkidle" });
  await expect(page.getByText("Atta 10kg").first()).toBeVisible();
});
