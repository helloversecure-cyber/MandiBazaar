# W16 — responsive shop: findings

Checked with `e2e/responsive-shop.spec.ts` (test cases L-01, L-02, L-03, L-09, L-10 in
[test-cases.md](test-cases.md) §L) on every customer-facing shop page at 360, 390, 768, 1024,
1280 and 1440 px, guest and signed in (Customer A, cart with 2 lines, 1 delivered order).

Run locally:

```bash
TEST_DATABASE_URL=postgresql://<user>@localhost:5432/<test db> E2E_PORT=3300 \
  npx playwright test e2e/responsive-shop.spec.ts
```

## Issues and fixes

| # | Page | Width | Problem | Cause | Fix |
|---|---|---|---|---|---|
| 1 | /cart (signed in) | 360–1023 | Page scrolls sideways; a long Urdu item name pushes the cart to ~1000 px | `grid` without `grid-cols-1`: the single implicit column grows to the widest child (the `truncate` name line) | `grid-cols-1` on the cart grid |
| 2 | /cart | < 1024 | "Proceed to checkout" and the total are far below the items, under the summary and coupon box (L-03) | No mobile action bar | Sticky bottom bar (total + main button) above the bottom nav, `lg:hidden`, as the last row of the cart grid so it stays until the summary's own button |
| 3 | /checkout | < 1024 | Each step's Continue / Confirm button sits at the end of a long form; the payable amount is only in the summary under the form (L-03) | No mobile action bar | Step buttons sit in a bar pinned above the bottom nav (shows "Payable now" too); static as before from 1024 px. Grid got `grid-cols-1` and bottom padding so the bar never covers the form |
| 4 | /checkout | 360, 390 | Step 4 of the step bar is cut off (hidden in a sideways-scrolling strip) | `min-w-[480px]` on the steps list, although step labels are hidden below 640 px | `sm:min-w-[480px]` |
| 5 | All shop pages | < 768 | Buttons, icon buttons, inputs, selects and standalone links smaller than 44 × 44 (header menu 36, search/cart 40, wishlist heart 26, quantity ± 32, "Add to cart" 36, chips 24, breadcrumb links 20, inputs 40–42, checkout step circles 32, "Remove" 16, …) (L-09) | Desktop-sized controls | One rule in `globals.css`, scoped to the shop layout (`.shop-tap-targets`) and to < 768 px: `min-height`/`min-width: 44px` on `a[href]`, `button`, `[role=button]`, `select`, text inputs. Inline links inside sentences are unchanged (WCAG 2.5.8 inline exception) |
| 6 | Footer, login, forgot password, account overview | < 768 | Standalone inline links stayed 15–18 px tall (`min-height` does not apply to inline boxes): footer link lists, "Forgot password?", "Sell on MandiBazaar — Store", "Back to sign in", order number link | `display: inline` | `max-md:inline-flex max-md:items-center`; footer lists drop their `space-y-2.5` on phones so the list keeps about the same rhythm |
| 7 | Header (signed in) | 360, 390 | With 44 px icons the header actions ran into the right edge (360: 378 px wide) | Menu + logo + 3 icons + gaps no longer fit | Header gap `gap-2` below 640 px, icon group gap 0 below 640 px, logo basket 48 px below 390 px (56 px from 390) |
| 8 | Product cards | < 768 | After #5 the heart sat off-centre in its 44 px circle; store name and product name links grew with the text stuck to the top | Block content in a taller box | Heart button `flex items-center justify-center`; store link `max-md:leading-[44px]`; name link `max-md:flex max-md:items-center` |
| 9 | Breadcrumbs | < 768 | After #5 the middle crumb's text sat at the top of its 44 px box | Block link in a taller box | `inline-flex items-center` on crumb links |

## Not fixed here

- **/account/\* at 360–1023 px** — the account layout grid has no `grid-cols-1`, so the
  horizontally scrolling account nav widens the page to ~1100 px. It is fixed in
  `src/app/(shop)/account/AccountLayoutClient.tsx` by another PR, so this PR leaves that file
  alone. Until that PR is merged, the `/account*` L-01 tests in this spec fail at 360, 390 and
  768 px. The account nav pills (28 px tall) are made 44 px by the global rule in #5.
  With that one-class fix emulated by injected CSS (no file change), every /account page
  passes L-01, L-09 and L-10 at 360, 390 and 768 px.

## Result

`e2e/responsive-shop.spec.ts`: 210 tests (35 per width × 6 widths): 175 passed, 11 skipped
(L-03 is phone-only; the menu drawer doesn't exist from 1024 px), 24 failed — all of them the
/account* L-01 cases above that wait on the AccountLayoutClient PR.

## Test notes

- Signed-in pages use a NextAuth session cookie minted by `e2e/mint-session.ts` (run from
  global setup with `npx tsx`, written to `e2e/.auth/customer.json`, git-ignored).
- The e2e seed adds a product with a long Urdu name (L-10) and one delivered order for
  Customer A (so /account/orders and the order page have content).
- `playwright.config.ts` reads the port from `E2E_PORT` (default 3100).
- L-02 checks "2+ columns below 768, 3+ from 768" rather than an exact 2/3/4/5: the
  /products grid sits next to a filter sidebar from 1024 px, so it shows 3–4 columns by design.
