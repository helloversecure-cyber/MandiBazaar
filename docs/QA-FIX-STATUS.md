# MandiBazaar — QA Report v6.0: fix status

Every finding from "MandiBazaar QA-Report" (Hassan, 1–4 Nov 2026), with its status after the fixes. Last updated: 7 Nov 2026.

**Legend**
- **Fixed**: changed in code and verified (unit tests, API tests, browser check).
- **Passed**: QA already passed it; no change needed (small suggestions applied where noted).
- **Data**: the code is ready; the owner must fix live data in the admin panel (see "Owner actions").
- **Staging**: needs a staging copy with Stripe test mode to test end to end.

**Checks run on the final code:** TypeScript clean, 375/375 unit tests, lint clean, production build OK. Browser checks done on desktop and 390px mobile.

---

## Owner actions before / after deploy

### Security (urgent)
1. Run `crontab -r` in your own Terminal. This removes the last leftover of the malware that was found on the development Mac.
2. Rotate all secrets: database, Stripe, JazzCash, `NEXTAUTH_SECRET`, `CRON_SECRET`, storage keys, GitHub token, SSH keys, and saved browser passwords.
3. Review every commit by `hello.versecure@gmail.com`. Commit `b55ab76` added hidden malware to `postcss.config.mjs`; it has been removed.

### Deploy
1. `npx prisma migrate deploy` (use the Neon **direct**, non-pooled URL). The repo's `prisma/migrations/` holds `0_init` (the full baseline schema) and `20261108172920_add_review_base_price`; `migrate deploy` applies whatever isn't yet on the target DB.
2. Set these Vercel environment variables:
   - `CRON_SECRET` (any long random string). Without it, unpaid orders are never cancelled automatically.
   - `NEXTAUTH_SECRET`: at least 16 characters.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: these turn on SMS. Once set, signup phone codes, the coupon "verified phone" rule, and admin 2-step SMS codes all become active.
   - `RESEND_API_KEY`, `EMAIL_FROM`: these turn on email codes and order emails. The From domain must be verified in Resend.
   - `ADMIN_2FA_REQUIRED`: optional; on by default. Set it to `false` only in an emergency.
   - Before adding Twilio or Resend, make sure every admin/staff account has its real phone and email.
3. Run the one-time cleanup script. Run it first without `--apply` to preview, then with `--apply`:
   ```bash
   npx tsx scripts/phase0-security-cleanup.ts
   ```
   - It deactivates unsafe coupons (e.g. GFDHTGD at 120%).
   - It deletes old reset codes from the audit log.
   - It lists riders who still use the old shared password.
4. Find orders with over-recorded payments (e.g. Rs 3,200 on a Rs 500 order) using the SQL query at the end of this file, and correct them by hand.

### Live data (Admin panel)
| What | Where |
|---|---|
| Add an image to each real category (Aata, Daal, Fruits…), activate them, rename "chanay", move products into the right category | Admin → Categories / Products |
| Add Shah Jee Kiryana Store's payout details (bank or JazzCash) and map location. Without the location the delivery fee stays at the flat Rs 100 | Store portal → Store profile (owner) |
| Replace the placeholder business phone "042-111-MANDI" with a real number. Settings won't save until you do | Admin → Settings |
| Create the SAVE10 coupon (rules: 10%, max Rs X, first order only). The homepage advert only shows when the coupon exists and is active | Admin → Coupons |
| Deactivate junk customer accounts (use the "Accounts with invalid phone numbers" filter) | Admin → Customers |
| Assign a rider to ORD-20260929-000001 (ready since 29 Sep), or cancel it | Admin → Orders |
| Product spelling and unit fixes ("Daall", "Experiencer", 1pc vs 1 kg) | Store portal → Products (owner) |
| Upload 2–3 homepage banners | Admin → Carousel |
| Configure JazzCash merchant credentials (env vars) | Vercel |

---

## Status by finding

### A. Homepage & general site
| ID | Finding | Status | What was done |
|---|---|---|---|
| A1 | Homepage loads | Passed | — |
| A2 | Duplicate "All products" / "Store" in menu | Fixed | Duplicates removed; the seller link is now "Sell on MandiBazaar" |
| A3 | Promotional claims don't match reality | Fixed | Deal % comes from real discounts (hidden when there are none). Store count is real ("Growing network…"). "24/7 Support" became "Customer support" with the real contact. "Easy Returns" links to the policy page. COD wording is accurate. Fake countdown removed |
| A4 | Only "General store business" category | Fixed + Data | The shop shows only active categories that have an image. The owner must activate the real categories |
| A5 | No policy / info pages | Fixed | Added /about, /contact, /terms, /privacy, /return-policy, /faq, all linked in the footer |
| A6 | Plain 404 page | Fixed | Branded "Oops, page not found" page with "Go to homepage" and "Browse products" |
| A7 | https & redirects | Passed | — |
| A8 | Page speed | Passed | — |

### B. Search
| ID | Finding | Status | What was done |
|---|---|---|---|
| B1 | Search works | Passed | — |
| B2 | "phone" in no-results suggestions | Fixed | Suggests daal, rice and atta, offers "Did you mean", and shows popular products |
| B3 | Urdu search returns 0 | Fixed | Urdu ↔ English word mapping, plus a new "Urdu name" field on products |

### C. Listing, sorting & filters
| ID | Finding | Status | What was done |
|---|---|---|---|
| C1–C3, C5 | Listing, sort, price filter, organic | Passed | — |
| C4 | Min > Max price shows nothing | Fixed | Shows "Min price can't be more than Max price" with a Swap button |

### D. Product page
| ID | Finding | Status | What was done |
|---|---|---|---|
| D1 | Spelling, unit, empty Details tab | Fixed + Data | Details tab now shows unit, category, store, flags and tags. Unit is chosen from a dropdown. The spelling must be fixed by the store owner |
| D2 | "You may also like" shows "Sold out" wrongly | Fixed | Real stock is passed to every product card |
| D3 | Fake ★ 4.5 ratings | Fixed | Shows the real average from approved reviews, or "No ratings yet" |
| D4, D5 | Tabs, Buy now as guest | Passed | — |

### E. Cart & checkout
| ID | Finding | Status | What was done |
|---|---|---|---|
| E1–E4 | Cart basics | Passed | — |
| E5 | "No delivery fee" contradicts the banner | Fixed | Guest and signed-in carts use the same delivery rule and message |
| E6 | No coupon box for guests | Fixed | Guests see the coupon box and a "Sign in to use it" note |
| E7 | Checkout needs sign-in | Passed | Owner decision: sign-in stays required |

### F. Customer account
| ID | Finding | Status | What was done |
|---|---|---|---|
| F1, F3 | Sign-in, forgot password | Passed | Also hardened: account lockout, 3 reset requests per hour, hashed reset codes |
| F2 | Signup accepts phone "abc" | Fixed | See L1 |
| F4 | Not returned to Orders after sign-in | Fixed | After sign-in you go back to the page you asked for (callbackUrl) |
| F5 | Wishlist heart as guest | Fixed | "Sign in to save to your wishlist" message, then return to the same page |
| F6 | Welcome tour on every sign-in | Fixed | Finish or skip is saved on the account; Skip button from step 1; "Guide" link to reopen it |

### G–J. Store, rider, admin entry, mobile
| ID | Finding | Status | What was done |
|---|---|---|---|
| G1, G2, H1, H4, I1, J1, J3, J4 | — | Passed | — |
| H2 | Rider signup "private link" note | Fixed | Owner decision: signup is public. The rider login now has a "Become a rider →" link |
| H3 | Rider phone/CNIC format | Fixed | See S3 |
| I2 | Separate sign-in pages, no extra admin protection | Fixed | Admin/staff 2-step sign-in (SMS/email code). Lockout after 5 wrong tries. Every admin sign-in is audit-logged |
| J2 | Duplicates in mobile menu | Fixed | See A2 |

### K. Search engines
| ID | Finding | Status | What was done |
|---|---|---|---|
| K1 | Same title on every page | Fixed | Every shop page has its own title (e.g. "Chana Dal — Rs 260 \| MandiBazaar") with share image. The sitemap includes products and stores |

### L. Signup forms
| ID | Finding | Status | What was done |
|---|---|---|---|
| L1 | Customer signup accepts junk | Fixed | Pakistani mobile (+92 converted), name, email and password rules on screen and server. **Plus** phone verification by SMS code |
| L2 | Only "Invalid input" | Fixed | Specific message under each field, e.g. "This phone number is already registered…" |
| L3 | Store signup has no checks | Fixed | Mobile, landline, CNIC, IBAN, bank account and JazzCash rules. City/Province dropdowns. Location via "Use my current location" or read from the Maps link. At least one category and one payout method required |
| L4 | No message for missing documents | Fixed | Red message under each missing document, a summary at the top, and the page scrolls to the first error |

### M. Signed-in customer
| ID | Finding | Status | What was done |
|---|---|---|---|
| M1 | Account pages | Passed | The account menu is compact on mobile |
| M2 | Address form "Invalid input", no labels | Fixed | Labels, errors under each field, dropdowns, "Use my current location", first address becomes the default |
| M3 | Wishlist "Sold out" | Fixed | See D2; "1 saved product" plural fixed |
| M4, M8 | Signed-in cart, address step | Passed | — |
| M5 | SAVE10 doesn't exist | Fixed + Data | The advert only shows when the coupon exists. Owner creates SAVE10 |
| M6 | Wrong coupon shows nothing | Fixed | Exact reason under the box (invalid, expired, minimum order, already used, first order only, verify phone). Green "Coupon applied — you saved Rs X" |
| M7 | Checkout phone | Fixed | Pakistani mobile rule; name/phone/email filled in from the account |
| M9 | Checkout with an empty cart | Fixed | Blocked on every step and on the server; sends the customer back to the cart with a message |
| M10 | Payment wording, "(live)" | Fixed | "(live)" removed; wording is clear. **Plus** small orders (≤ Rs 2,000, set in Settings) can pay everything in cash |
| M11 | Orders page | Passed | "1 order" plural fixed; status filter and pagination added |
| M12, M13 | Card minimum Rs 150 / stuck loop | Fixed | Card is disabled below Rs 150 with a note before the customer chooses it. Amount recalculates when the choice changes. No stuck order left behind |

### N. Store owner portal
| ID | Finding | Status | What was done |
|---|---|---|---|
| N1 | Dashboard | Passed | Added "Sales this week" and "Pending payout" |
| N2 | "Mark ready" on cancelled/unpaid orders | Fixed | Shown only on paid orders, and the server also refuses others. Tabs: To prepare / Ready / Completed / Cancelled / Unpaid. Search, order detail, steps (Packed → Ready). Unpaid orders are cancelled automatically (needs `CRON_SECRET`) |
| N3 | No limits on price/stock/name | Fixed | Price Rs 1–1,000,000, stock 0–100,000, name ≤ 80, deal price must be below the regular price |
| N4 | Category empty on edit | Fixed | The current category is pre-selected |
| N5 | Deals page | Passed | Shows "% off" automatically |
| N6 | Payouts page empty | Fixed | Total sales, commission %, amount due, next payout, history |
| N7 | Store approved without payout/location | Fixed + Data | Approve is blocked until payout details and location exist. Store profile enforces them. The owner fills them in for Shah Jee |
| N8 | Photo check approves wrong photos | Fixed | Never passes without really checking. Without an AI key the button becomes "Confirm photos" and the admin reviews them |
| N9 | Edits after approval go live without review | Fixed | Name/category/unit/photo changes and price changes above ±20% wait for admin review; the approved version stays live. Small changes are applied and audit-logged |

### O. Rider portal
| ID | Finding | Status | What was done |
|---|---|---|---|
| O1, O3, O4 | — | Passed | — |
| O2 | Confusing instructions | Fixed | "Collect Rs X cash (products + delivery)" / "Paid online — don't collect money" |
| O5 | Wrong portal → silent homepage | Fixed | "This page is for … only" screen with buttons |
| O6 | No profile / earnings, unassigned job | Fixed | My profile (masked payout details, editable vehicle/payout). My earnings with the pay model (Rs per delivery + per km, set in Settings), unpaid balance and payout history. Admin "Pay rider". Dashboard "Needs attention" flags orders waiting for a rider |

### P. Super Admin
| ID | Finding | Status | What was done |
|---|---|---|---|
| P1 | Dashboard numbers wrong | Fixed | Labels follow the chosen range. Only paid, non-cancelled orders count. Totals reconcile. "No data" message. "Needs attention" block. Delivery income vs rider pay |
| P2 | "Manage order" shows no details; any status allowed | Fixed | Full order page (items, address, payments, receipts, history). Only valid next statuses are offered, and the server enforces them. Search, date and store filters, pagination. Payments are capped and can't be recorded twice |
| P3 | Coupons can't be configured | Fixed | Every rule is in the form. Edit, activate/deactivate, delete (only if unused). Usage report |
| P4 | Approvals | Fixed | Approval guard. Review counts on the admin menu |
| P5 | Shared rider password, bad CNIC approved | Fixed | Random temporary password with a forced change on first login. CNIC and documents checked before approval. Quick-add riders start Pending (owner decision) |
| P6 | Approve receipt on a cancelled order | Fixed | Blocked; "record & refund" instead. Warning when the image is missing. Order total shown. Text in English |
| P7 | One-click pay all, odd remittance | Fixed | Summary and confirmation before paying. Remittances need a rider and collected cash. Refund ≤ amount paid |
| P8 | Settings | Fixed + Data | Validation; JazzCash text corrected; the owner sets a real phone |
| P9 | Reset codes in audit logs | Fixed | Codes are stored only as hashes and hidden from logs; old rows are removed by the cleanup script |
| P10 | Junk customers | Fixed + Data | "Invalid phone numbers" filter; the owner deactivates the junk accounts |
| P11 | Categories inactive | Fixed + Data | Duplicates blocked; an image is required to activate. The owner activates them |
| P12 | Labels, carousel developer note | Fixed | "Gross product sales" label; developer note removed |
| P13, P14 | Browser pop-ups, no confirmation | Fixed | In-app confirm dialogs with a required reason, success messages, Undo after archive, owner notified, store reactivation |

### Q. Pagination
| ID | Status | What was done |
|---|---|---|
| Q1–Q8 | Fixed | Page numbers on the shop, search, deals, store pages, every admin list (25 per page), store orders/products, rider deliveries and customer orders. `?page=` is kept in the URL on shop pages |

### R. Search & filters
| ID | Status | What was done |
|---|---|---|
| R1 | Fixed | Suggestions only show live, in-stock products, with photo and price |
| R2 | Fixed | Search uses the full products page with filters and sorting; everything is kept in the URL |
| R3 | Fixed | Words matched in any order, spelling variants (dal/daal, chana/channa…), store names, organic, Urdu |
| R4 | Passed | Typing is debounced |
| R5–R8 | Fixed | Search added on admin Orders, Stores, Riders, Payments, Reviews, Audit logs, Customers, plus store orders/products and rider deliveries |

### S. Form validation
| ID | Status | What was done |
|---|---|---|
| S0 | Fixed | Shared rule set (mobile, CNIC, IBAN, JazzCash, email, name, password, money, stock, links…), used on screen and on the server |
| S1–S15 | Fixed | Every form listed in the report uses these rules, with errors under each field |
| S16 | Fixed (code) / Staging | Review form (one review per product per order, photo checked), receipt upload, decline reason, rider proof upload, deals: validated. Test end to end on staging |

### T. Coupons
| ID | Status | What was done |
|---|---|---|
| T1 | Fixed | No hidden minimum; the customer sees "Add Rs X more…" |
| T2 | Fixed | Percentage 1–90% with a required cap. Fixed amount ≤ half the minimum order. The discount never exceeds 90% of products |
| T3 | Fixed | Edit, deactivate, delete; GFDHTGD is blocked and is deactivated by the cleanup script |
| T4 | Fixed | Limits per account, per phone and per delivery address. First-order-only. Usage counted at order placement and returned on cancel. Coupons need a verified phone (when SMS is on) |

### U. QA Flow Test Plan extras
| ID | Status | What was done |
|---|---|---|
| U1 | Fixed | The public stores API returns only public fields. Two more leaks were also closed: store details in the cart API, and rider CNIC/bank details in the orders API |
| U2 | Fixed | Quantity capped at stock in the cart and on the product page |
| U3 | Fixed | `/stores` page; store links go to the store page |
| U4 | Fixed | Minimum order shown in the cart, with checkout blocked until it is met |
| U5 | Fixed | Settings: per-km rate, maximum fee, commission %, full-COD limit, rider pay |

### 4. Not tested yet: test on staging
- Card (Stripe test mode) and JazzCash payment, confirmation, invoice download
- Full order lifecycle: place → store ready → assign rider → out for delivery → delivered/failed
- Rider COD collection → remittance → admin confirm; rider payout
- Store payout generation; refunds after cancel or late payment
- SMS/email notifications (after Twilio/Resend are set)

**Staging setup:**
1. Create a Neon branch of the database.
2. Create a Vercel Preview deployment with its own env vars: the Stripe **test** keys, the staging database URL, and Twilio/Resend test credentials.
3. Run `npx prisma migrate deploy` and `npm run db:seed` on the staging database only.
4. Give QA the seeded test accounts.

---

## SQL: orders with over-recorded payments
```sql
SELECT o."orderNumber", o."orderStatus", o."grandTotal", o."deliveryFeePaid", o."productAmountPaid",
       (o."deliveryFeePaid"+o."productAmountPaid") AS recorded,
       (SELECT COALESCE(SUM(p.amount),0) FROM "Payment" p WHERE p."orderId"=o.id AND p.status IN ('SUCCESS','REFUNDED') AND p.type<>'REFUND') AS online_captured,
       (SELECT c."amountCollected" FROM "CashCollection" c WHERE c."orderId"=o.id) AS cash
FROM "Order" o
WHERE o."deliveryFeePaid" > o."deliveryFee"
   OR o."productAmountPaid" > (o.subtotal - o.discount)
   OR EXISTS (SELECT 1 FROM "CashRemittance" r WHERE r."orderId"=o.id AND r."riderId" IS NULL);
```
