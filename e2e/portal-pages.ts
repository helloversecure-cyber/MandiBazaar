/** W17: the store, rider and admin portal pages and who signs in to see them (e2e/seed.ts data). */
import type { BrowserContext, Page } from "@playwright/test";
import { sessionCookieParam } from "../playwright.config";
import { sessionCookie } from "./list-bidding-helpers";

export const STORE_PAGES = [
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

export const RIDER_PAGES = [
  "/rider-portal",
  "/rider-portal/bids",
  "/rider-portal/deliveries",
  "/rider-portal/remittances",
  "/rider-portal/earnings",
  "/rider-portal/profile",
];

export const ADMIN_PAGES = [
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

export const PORTALS = [
  { name: "store", email: "owner.s1@test.local", pages: STORE_PAGES },
  // R3 is offline and carries the seeded delivered + out-for-delivery orders.
  { name: "rider", email: "rider.r3@test.local", pages: RIDER_PAGES },
  { name: "admin", email: "admin@test.local", pages: ADMIN_PAGES },
];

const cookies = new Map<string, string>();
export async function signIn(context: BrowserContext, email: string) {
  if (!cookies.has(email)) cookies.set(email, sessionCookie(email));
  await context.addCookies([sessionCookieParam(cookies.get(email)!)]);
}

/** The bottom bar (fixed, < 1024 px) must not hide the last control or line of the page. */
export async function findCoveredByBottomBar(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const bar = document.querySelector<HTMLElement>("[data-testid=portal-bottom-nav]");
    if (!bar || !bar.checkVisibility()) return [];
    // `instant`: the site sets scroll-behavior: smooth on <html>.
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
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
    window.scrollTo({ top: 0, behavior: "instant" });
    if (lowest && bottom > top + 1) {
      const text = (lowest.textContent || "").trim().slice(0, 30);
      return [`<${lowest.tagName.toLowerCase()}> "${text}" ends at ${Math.round(bottom)}, bottom bar starts at ${Math.round(top)}`];
    }
    return [];
  });
}
