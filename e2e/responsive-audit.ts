/**
 * In-page layout checks for docs/plans/test-cases.md §L, shared by the responsive specs.
 * Each returns a list of human-readable problems (empty = fine).
 */
import { expect, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { CUSTOMER_STATE } from "./global-setup";

/** Customer-facing shop pages (W16). Seed: e2e/seed.ts. */
export const PUBLIC_PAGES = [
  "/",
  "/products",
  "/products/atta-10kg",
  "/products/urdu-chakki-atta",
  "/stores",
  "/stores/test-s1",
  "/search?q=atta",
  "/cart",
  "/login",
  "/register",
  "/forgot-password",
  "/about",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
  "/return-policy",
  "/sell",
];

export const SIGNED_IN_PAGES = [
  "/cart",
  "/checkout",
  "/account",
  "/account/orders",
  "/account/orders/MB-E2E-0001",
  "/account/addresses",
  "/account/notifications",
  "/account/profile",
  "/account/reviews",
  "/account/security",
];

/** Two lines in Customer A's cart (one with a long Urdu name), added through the cart API. */
export async function ensureCartItems(playwright: PlaywrightWorkerArgs["playwright"]) {
  const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: CUSTOMER_STATE });
  const cart = await api.get("/api/cart");
  expect(cart.ok(), "signed in for /api/cart").toBeTruthy();
  const items = ((await cart.json()).data?.items ?? []) as unknown[];
  if (items.length === 0) {
    const res = await api.get("/api/products?limit=20");
    const list = ((await res.json()).data?.items ?? []) as { id: string; slug: string }[];
    const picks = list.filter((p) => ["atta-10kg", "urdu-chakki-atta"].includes(p.slug));
    expect(picks.length, "seeded products from /api/products").toBe(2);
    for (const p of picks) {
      const add = await api.post("/api/cart", { data: { productId: p.id, quantity: 1 } });
      expect(add.ok(), `add ${p.slug} to cart: ${await add.text()}`).toBeTruthy();
    }
  }
  await api.dispose();
}

export const MIN_TAP = 44;

export async function openPage(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: "load" });
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  // Client data (cart quote, session) and fonts settle the layout. `next dev` keeps an
  // HMR socket open, so don't wait for a fully idle network.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  // Pages that fetch on the client show "Loading…" first; a cold `next dev` (CI) can
  // take several seconds, so wait for the real content before measuring.
  await expect(page.getByText(/^Loading…$/)).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** L-01: the page never scrolls sideways and no element sticks out past the window edge. */
export async function findHorizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) {
      out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${window.innerWidth}px window`);
    }
    const describe = (el: Element, r: DOMRect) => {
      const cls = typeof el.className === "string" ? el.className.slice(0, 90) : "";
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `<${el.tagName.toLowerCase()} class="${cls}"> "${text}" spans ${Math.round(r.left)}..${Math.round(r.right)}`;
    };
    const flagged = new Set<Element>();
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Entirely off-screen = a closed drawer / slide, not a layout bug.
      if (r.right <= 0 || r.left >= vw) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      // Inside a box that scrolls or clips sideways (carousels, chip rows) is fine,
      // as long as that box itself fits in the window.
      let inClip = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") {
          const pr = p.getBoundingClientRect();
          inClip = pr.left >= -1 && pr.right <= vw + 1;
          break;
        }
      }
      if (inClip) continue;
      // Report the outermost offender only.
      let parentFlagged = false;
      for (let p = el.parentElement; p; p = p.parentElement) if (flagged.has(p)) parentFlagged = true;
      flagged.add(el);
      if (!parentFlagged) out.push(describe(el, r));
      if (out.length >= 10) break;
    }
    return out;
  });
}

/** L-09: buttons, links and form controls at least 44 × 44 px (call below 768 px only). */
export async function findSmallTapTargets(page: Page): Promise<string[]> {
  return page.evaluate((MIN) => {
    const out: string[] = [];
    const sel = [
      "a[href]",
      "button",
      '[role="button"]',
      "select",
      "textarea",
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    ].join(",");
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.pointerEvents === "none") continue;
      if (el.matches(":disabled")) continue;
      const r = el.getBoundingClientRect();
      // Visually hidden (sr-only) and closed-drawer controls
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right <= 0 || r.left >= window.innerWidth) continue;
      // Hidden by a collapsed ancestor
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      // Links inside running text are exempt (WCAG 2.5.8 "inline" exception).
      if (el.tagName === "A" && s.display === "inline") {
        const own = (el.textContent || "").trim().length;
        const around = (el.parentElement?.textContent || "").trim().length;
        if (around > own + 1) continue;
      }
      if (r.width < MIN - 0.5 || r.height < MIN - 0.5) {
        const label = (
          el.getAttribute("aria-label") ||
          (el.textContent || "").trim().replace(/\s+/g, " ") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          el.getAttribute("href") ||
          ""
        ).slice(0, 30);
        out.push(
          `<${el.tagName.toLowerCase()}> "${label}" ${Math.round(r.width)}×${Math.round(r.height)} at y=${Math.round(
            r.top + window.scrollY
          )}`
        );
      }
    }
    return out;
  }, MIN_TAP);
}

/** L-10: every run of Urdu text stays inside the box that clips it and inside the window. */
export async function findUrduOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urdu = /[؀-ۿ]/;
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const value = n.textContent || "";
      if (!urdu.test(value)) continue;
      const el = n.parentElement;
      if (!el) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.width === 0 || t.height === 0) continue;
      if (t.right <= 0 || t.left >= vw) continue; // closed drawer
      // Truncated with an ellipsis on purpose: fine.
      let truncated = false;
      let box = new DOMRect(0, -1e9, vw, 2e9);
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.textOverflow === "ellipsis" || ps.webkitLineClamp !== "none") truncated = true;
        if (ps.overflowX !== "visible" || ps.overflowY !== "visible") {
          box = p.getBoundingClientRect();
          break;
        }
      }
      if (truncated) continue;
      const left = Math.max(box.left, 0) - 1;
      const right = Math.min(box.right, vw) + 1;
      if (t.left < left || t.right > right || t.top < box.top - 2 || t.bottom > box.bottom + 2) {
        out.push(
          `"${value.trim().slice(0, 40)}" text ${Math.round(t.left)}..${Math.round(t.right)} × ${Math.round(
            t.top
          )}..${Math.round(t.bottom)} in box ${Math.round(box.left)}..${Math.round(box.right)} × ${Math.round(
            box.top
          )}..${Math.round(box.bottom)}`
        );
      }
    }
    return out;
  });
}

/** L-02: column counts of the grids that hold product cards (wider than 200 px). */
export async function productGridColumns(page: Page): Promise<{ cols: number; width: number }[]> {
  return page.evaluate(() => {
    const grids = new Set<Element>();
    for (const c of Array.from(document.querySelectorAll('a[href^="/products/"]'))) {
      for (let p = c.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).display === "grid") {
          grids.add(p);
          break;
        }
      }
    }
    return Array.from(grids)
      .map((g) => ({
        cols: getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length,
        width: Math.round(g.getBoundingClientRect().width),
      }))
      .filter((g) => g.width > 200);
  });
}

/** L-02: images drawn at a different aspect ratio than their file (and not object-fit). */
export async function findStretchedImages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 20)
      .filter((img) => {
        const fit = getComputedStyle(img).objectFit;
        if (fit === "cover" || fit === "contain" || fit === "scale-down") return false;
        const r = img.getBoundingClientRect();
        const natural = img.naturalWidth / img.naturalHeight;
        return Math.abs(r.width / r.height - natural) / natural > 0.05;
      })
      .map((img) => img.currentSrc.slice(-60))
  );
}
