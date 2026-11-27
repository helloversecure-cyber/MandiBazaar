# W17 — responsive store, rider and admin portals: findings

Checked with `e2e/responsive-portals.spec.ts` (test cases L-01, L-07, L-08, L-09 in
[test-cases.md](test-cases.md) §L) on every store-portal, rider-portal and admin page at 360,
390, 768, 1024, 1280 and 1440 px, signed in as the right role (pages and users in
`e2e/portal-pages.ts`):

- Store: Owner S1 — dashboard, products, deals, orders (both tabs), incoming lists, earnings,
  payouts, store profile (9 pages). The bid form is covered by `bidding-portals.spec.ts`.
- Rider: Rider R3 — dashboard, delivery requests, deliveries, cash to MandiBazaar, earnings,
  profile (6 pages).
- Admin: Super Admin — all 25 admin pages, including an order detail and the 4 bidding pages.

Unlike the W13–W15 checks in `bidding-portals.spec.ts` (which only look inside `<main>`),
these include the shared shell: header, theme toggle, bottom bar and the More sheet. Each page
also checks that the fixed bottom bar never covers the end of the page.

Run locally:

```bash
TEST_DATABASE_URL=postgresql://<user>@localhost:5432/<test db> E2E_PORT=3300 \
  npx playwright test e2e/responsive-portals.spec.ts
```

## Seed added (e2e/seed.ts)

- Rider R3 (offline, not used by the bidding specs) delivered MB-E2E-0001 (rider fee Rs 150)
  and is out for delivery with a COD cart order for Customer B, MB-E2E-0002. Without these
  the rider Deliveries / Earnings pages and the admin order detail had no rows or action buttons.
- One customer per width with a saved address for the W18 checkout journey.

## Before

A first pass (fixes not applied) at 360, 768 and 1024 px:

- **L-01: no page scrolled sideways or had anything past the window edge at any width.** The
  wide admin tables (orders 860 px, refunds 860, cash collection 800/900, products 780,
  payments 760, customers 720, staff/inventory 640) already scroll inside their own box.
- **L-07:** already met — sidebar from 1024 px, bottom bar + More sheet below.
- **L-09 (< 768 px): 222 controls under 44 × 44 px across the 40 pages at 360 px.** Every
  page: the theme toggle (36 × 36). Then e.g. admin riders 37 (form inputs 42 px tall,
  "Choose image"), admin carousel 26 (inputs 38 px), store dashboard 12 (product Edit/Delete
  30 px, "Manage all products →" 20 px), rider deliveries 13 (filter chips 28 px, "Call
  customer"/"Open in Maps" 26 px, search 38 px), admin settings 13, categories 12, store
  orders 9 (tabs 28 px, "View order" 28 px), store profile 8 (location "Remove"/"Enter
  manually" 16 px), admin filter chips 24 px, select boxes 38 px.
- **L-08:** orders / finance / payouts tables were still tables on phones (scrolling sideways
  inside their box).
- **Toasts** sat 24 px from the bottom from 640 px, but the bottom bar shows until 1024 px:
  at 640–1023 px a toast covered the bottom bar.
- **Confirm dialog** buttons were 36 px tall on phones.

## Fixes

| # | Where | Width | Problem | Fix |
|---|---|---|---|---|
| 1 | All portal pages (shell + content) | < 768 | Controls under 44 × 44 (see above) | `DashboardShell` gets `portal-tap-targets`; the W16 rule in `globals.css` now reads `:is(.shop-tap-targets, .portal-tap-targets)` and also covers `textarea`. Inline links inside sentences stay exempt |
| 2 | Admin orders, store Earnings (order breakdown + payout history), rider Earnings (deliveries + payouts) | < 768 | Tables on phones (L-08) | New `.table-cards` class: below 768 px each row is a card, the header row is hidden and each cell shows its column name (`data-label`) left and its content right. Ordinary table from 768 px |
| 3 | Toasts (`components/ui/feedback.tsx`) | 640–1023 | Toast covered the bottom bar | `sm:bottom-6` → `lg:bottom-6` (80 px up until the bar goes away). Same for the shop, whose bottom nav also shows until 1024 px |
| 4 | Confirm dialog, toast action button | < 768 | 36 px / 24 px tall | `max-md:min-h-11` |
| 5 | Bottom bar | all | No hook for tests; sheet had no accessible name | `data-testid="portal-bottom-nav"`, `aria-label="Portal"`; the More sheet is labelled "Menu" |

Desktop (≥ 1024 px) looks are unchanged: every change is under a `max-width: 767.98px` media
query except the toast offset, which only moves at 640–1023 px.

## After

All 40 pages at 360 and 768 px: no overflow, no tap target under 44 × 44, bottom bar never
covers the end of the page. Full results of the spec at all 6 widths are in the W18 run below.

## Not changed

- Other wide admin tables (payments, refunds, cash collection, products, customers, staff,
  inventory, reports) keep scrolling sideways inside their own box on phones, as allowed by
  the W17 brief; they are back-office screens mostly used on desktop.
- `bidding-portals.spec.ts` still limits its tap check to `<main>`; the shell is now covered
  here.
