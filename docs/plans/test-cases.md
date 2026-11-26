# MandiBazaar: Test Cases for Bidding, Android App and Responsive Design

Goes with [bidding-and-android-app-plan.md](bidding-and-android-app-plan.md).

**Type**
- API: vitest against a test database (website repo, `tests/`)
- Unit: pure functions (vitest or `flutter test`)
- E2E: Playwright in a real browser (website)
- Widget: `flutter test`, one screen with a fake API
- Int: Flutter `integration_test` on an Android emulator against staging
- Golden: screenshot comparison
- Manual: done by a person on a real phone

**Priority**
- P0: blocks release
- P1: must pass before production
- P2: should pass

**Test data** (seeded on staging):
- Customer A, pin in Lahore Model Town.
- Store S1 at 2 km (Grocery), store S2 at 4 km (Grocery), store S3 at 8 km (Grocery), store S4 at 3 km (Pharmacy only), store S5 at 2 km but SUSPENDED.
- Rider R1 online at 1 km from S1, R2 online at 6 km, R3 offline, R4 with overdue COD cash.

---

## A. App login and API access (website backend)

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| A-01 | App login, right password | API | `POST /api/mobile/auth/login` with customer phone + password | 200, access token (1 h) + refresh token (30 d), user role CUSTOMER | P0 |
| A-02 | Wrong password | API | Login with wrong password | 401, same message as the website, failed-attempt counter +1 | P0 |
| A-03 | Lockout | API | 5 wrong passwords, then the right one | Locked message with minutes, same as website | P0 |
| A-04 | Wrong portal | API | Customer logs in with `portal=rider` | 403 with the website's portal message | P1 |
| A-05 | Pending rider | API | Unapproved rider logs in with `portal=rider` | Success, role RIDER, protected rider actions return `RIDER_PENDING_APPROVAL` | P1 |
| A-06 | Bearer token works on old routes | API | `GET /api/account/orders` with `Authorization: Bearer` | Same data as with the website cookie | P0 |
| A-07 | Expired access token | API | Call with a token older than 1 h | 401 `TOKEN_EXPIRED` | P0 |
| A-08 | Refresh | API | `POST /api/mobile/auth/refresh` | New access + new refresh token. Old refresh token now rejected (rotation). | P0 |
| A-09 | Reused refresh token | API | Use an old refresh token again | 401, and all refresh tokens of that user are revoked | P1 |
| A-10 | Logout | API | `POST /api/mobile/auth/logout` then refresh | Refresh fails with 401 | P1 |
| A-11 | Website login unchanged | E2E | Login on website as customer, store, rider, admin | Each lands on its portal like before | P0 |
| A-12 | Tampered token | API | Change one character of the token | 401 | P0 |
| A-13 | Customer token on store route | API | `GET /api/store/lists` with customer token | 403 | P0 |
| A-14 | Login rate limit | API | 30 logins from one IP in 1 minute | 429 after the limit | P1 |

## B. Item list: create, edit, cancel (customer)

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| B-01 | Create list | API | Customer A posts 3 lines + address with pin | 201, status BIDDING, radius 5, lines saved in order | P0 |
| B-02 | Empty list | API | Post with 0 lines | 400 "Add at least one item" | P0 |
| B-03 | Too many lines | API | Post 101 lines | 400 (limit 100) | P1 |
| B-04 | Bad quantity | API | Quantity 0, negative, text | 400 per line | P0 |
| B-05 | No pin | API | Address without lat/long | Accepted, city-only matching, flag `noPin` shown to customer | P1 |
| B-06 | Catalog + custom items | E2E | Add 2 catalog products + "+ Add custom item" in cart, tap "Stores will bid" | One list with 3 lines, the 2 catalog lines carry `productId` | P0 |
| B-07 | Edit while bidding | API | Add 1 line, remove 1 line | Saved. Stores that already bid see "List changed, update your bid". Their bids are marked out of date. | P0 |
| B-08 | Edit after accept | API | PATCH an ACCEPTED list | 409 "Order already placed" | P0 |
| B-09 | Cancel while bidding | API | DELETE | Status CANCELLED, all PENDING bids → NOT_SELECTED, stores notified | P0 |
| B-10 | Cancel after accept | API | DELETE an ACCEPTED list | 409 | P0 |
| B-11 | Another customer's list | API | Customer B opens Customer A's list id | 404 | P0 |
| B-12 | Rate limit | API | 11 lists in 1 hour | 429 after 10 | P1 |
| B-13 | Urdu text | API | Line name "آٹا" | Saved and shown correctly | P1 |
| B-14 | Record | API | Create, edit, cancel | Each writes an AuditLog row with actor and time | P1 |

## C. Broadcast and radius

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| C-01 | First circle | API | Create list (Grocery items) | ListBroadcast rows for S1 and S2 only (≤ 5 km, Grocery, approved) | P0 |
| C-02 | Category filter | API | Same list | S4 (Pharmacy only) not included | P0 |
| C-03 | Suspended store | API | Same list | S5 not included | P0 |
| C-04 | Max 20 stores | API | 30 matching stores within 5 km | Exactly 20 nearest get the list | P1 |
| C-05 | Widen after 30 min | API | Fake clock +31 min, no bids, trigger tick | radius 10, S3 now gets a broadcast, S1/S2 not sent again | P0 |
| C-06 | No widen when bids exist | API | S1 bid, clock +31 min | radius stays 5 | P1 |
| C-07 | Widen when everyone declined | API | S1 and S2 tap "Can't supply" | Widens right away (no 30 min wait) | P1 |
| C-08 | Max radius | API | No bids until 20 km and +30 min | Status NO_STORES, customer notified "No shop found" | P0 |
| C-09 | Lazy tick | API | No cron. Customer opens the list after 31 min | Widening happens on that read | P0 |
| C-10 | Daily cron | API | Run the cron route | Stale lists widened or expired | P1 |
| C-11 | Store without pin | API | Store with no lat/long, same city | Included by city match, after pinned stores | P2 |
| C-12 | Push sent | API | Create list | Each broadcast store owner gets IN_APP + PUSH notification | P0 |

## D. Store bidding

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| D-01 | See incoming list | API | S1 owner `GET /api/store/lists` | List shows items and area, not the customer's name, phone or house number | P0 |
| D-02 | Store not in broadcast | API | S3 (not yet broadcast) opens the list id | 404 | P0 |
| D-03 | Full bid | API | S1 prices all 3 lines | Bid PENDING, `itemsTotal` = sum of qty × price − discount, coveredCount 3 | P0 |
| D-04 | Partial bid | API | S2 marks 1 line "Don't have" | coveredCount 2, total covers 2 lines only | P0 |
| D-05 | Bid with nothing available | API | All lines "Don't have" | 400 "Use Can't supply instead" | P1 |
| D-06 | Bad prices | API | Price 0, negative, above Rs 1,000,000 | 400 per line | P0 |
| D-07 | Discount larger than total | API | Discount > items total | 400 | P1 |
| D-08 | Edit bid | API | S1 changes a price | One bid row only, updated, customer notified "Offer updated" | P0 |
| D-09 | Second bid row | API | S1 bids twice at once (parallel) | Still one row (unique store per list) | P0 |
| D-10 | Bid after accept | API | S2 bids after customer accepted S1 | 409 "List already closed" | P0 |
| D-11 | Bid on cancelled list | API | Customer cancelled | 409 | P0 |
| D-12 | Can't supply | API | S2 declines | `declinedAt` set, no bid shown to customer | P1 |
| D-13 | Withdraw | API | S1 withdraws before accept | Status WITHDRAWN, hidden from customer | P1 |
| D-14 | Staff member | API | Store STAFF member bids | Allowed if the store's rules allow staff to bid, else 403 | P2 |
| D-15 | Suspended store | API | Store suspended after broadcast, then bids | 403 | P0 |
| D-16 | Store can't see other bids | API | S1 requests the list | No other store's price in the response | P1 |
| D-17 | Out-of-date bid | API | Customer edits list after S1 bid | S1's bid shows "update needed" and cannot be accepted until S1 updates it | P0 |

## E. Compare and accept a store offer

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| E-01 | Offers list | API | Customer opens list with S1 and S2 bids | Both shown with total, covered count, missing item names, prep time, estimated delivery fee, store rating | P0 |
| E-02 | Tags | Unit | Bids 900/30 min and 850/60 min | 850 tagged "Lowest price", 900 tagged "Fastest" | P2 |
| E-03 | Accept | API | Accept S1 | In one transaction: bid ACCEPTED, S2 NOT_SELECTED, list ACCEPTED, Order created (status per payment rule), OrderItems = covered lines with S1 prices, one StoreFulfillment for S1 | P0 |
| E-04 | Missing items dropped | API | Accept S2 (2 of 3) | Order has 2 items, confirm screen said "1 item will be removed" | P0 |
| E-05 | Double accept | API | Two accepts for different bids at the same moment | Exactly one succeeds, the other gets 409 | P0 |
| E-06 | Accept own list only | API | Customer B accepts A's bid | 404 | P0 |
| E-07 | Accept out-of-date bid | API | Bid marked update needed | 409 "Store is updating this offer" | P0 |
| E-08 | Order numbers | API | Accept | `orderNumber` uses the same generator as checkout | P1 |
| E-09 | Commission | API | Accept then deliver | Ledger: SALE, COMMISSION 5% (or store override), STORE_EARNING, same as cart orders | P0 |
| E-10 | Notifications | API | Accept | S1 "Customer accepted your bid", S2 "Not selected", customer "Order placed" | P0 |
| E-11 | Status history | API | Accept | OrderStatusEvent row with actor = customer and note "Accepted bid from S1" | P1 |
| E-12 | Minimum order | API | Accepted total below minimum order setting | 400 with the same message as checkout | P1 |
| E-13 | Coupon | API | Apply a coupon on accept | Same coupon rules as checkout (or blocked, per decision) | P2 |
| E-14 | Payment choice | E2E | Accept with COD products | Order CONFIRMED, store sees it in Orders | P0 |
| E-15 | Payment online | E2E | Accept with pay products online (Stripe test card) | PENDING_PAYMENT → CONFIRMED after payment | P1 |

## F. Store fulfilment (existing flow, regression)

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| F-01 | Processing → Packed → Ready | API | S1 moves through steps | Fulfilment and order statuses follow `state-machine.ts` | P0 |
| F-02 | Skip step | API | CONFIRMED → READY directly | Rejected if the state machine doesn't allow it | P1 |
| F-03 | Multi-store cart order | API | Cart order from S1 + S2, only S1 ready | Order not READY_FOR_DISPATCH yet | P0 |
| F-04 | All ready | API | S2 also ready | Order READY_FOR_DISPATCH, rider bidding opens (G-01) | P0 |
| F-05 | Existing tests | API | `npx vitest run` | All 379 existing tests still pass | P0 |

## G. Rider bidding after packing

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| G-01 | Opens on ready | API | Order becomes READY_FOR_DISPATCH | DeliveryRequest created with trigger POST_PACK, orderId set, city set | P0 |
| G-02 | Only once | API | Ready event fires twice | Still one DeliveryRequest | P0 |
| G-03 | Riders notified | API | G-01 | R1 and R2 notified (within range), R3 (offline) and R4 (COD overdue) not | P0 |
| G-04 | Rider sees request | API | R1 `GET /api/rider/bids` | Shows pickup area, drop area, distance. No customer phone or house number. | P0 |
| G-05 | Far rider | API | Rider 30 km away | Request not shown | P1 |
| G-06 | Bid | API | R1 bids Rs 150 | RiderBid PENDING, customer notified | P0 |
| G-07 | Bid limits | API | Rs 0, negative, above Rs 10,000 | 400 | P0 |
| G-08 | Ineligible rider bids | API | R4 bids | 403 with COD message | P0 |
| G-09 | Customer sees bids | API | Customer opens order | R1 and R2 bids sorted by price, with vehicle and completed deliveries | P0 |
| G-10 | Accept rider | API | Customer accepts R1 | Order ASSIGNED_TO_RIDER, `riderId` R1, `deliveryFee` 150, Delivery.riderFee 150, R2 bid REJECTED | P0 |
| G-11 | Double accept | API | Two accepts at once | One wins, the other 409 | P0 |
| G-12 | Rider goes offline before accept | API | R1 goes offline, customer accepts R1 | 409 "Rider unavailable", bid EXPIRED | P0 |
| G-13 | One rider wins two orders at once | API | R1 accepted on two orders in the same second | Only one succeeds (row lock) | P0 |
| G-14 | No bids | API | Window passes with no bids | Re-opened once. Then order flagged in admin "Needs rider". | P0 |
| G-15 | Admin assigns manually | E2E | Admin uses Assign rider on a flagged order | Works as today, open bids closed | P1 |
| G-16 | Normal cart orders unchanged | API | Place a normal cart order, store marks it ready | No POST_PACK rider bidding opens. Checkout, payment, rider assignment and fees behave exactly as before the release. | P0 |
| G-17 | Delivery fee payment | API | Cash default | `remainingAmount` includes the fee, rider collects it | P0 |
| G-18 | Pay fee online | E2E | Customer pays the fee online after accepting rider | Payment row DELIVERY_FEE SUCCESS, `deliveryFeePaymentStatus` PAID | P1 |

## H. Delivery, code and completion

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| H-01 | Code created | API | Order ASSIGNED_TO_RIDER | 4-digit code sent to customer (push + SMS if set up), only the hash stored | P0 |
| H-02 | Start delivery | API | R1 Start delivery | OUT_FOR_DELIVERY | P0 |
| H-03 | Right code | API | R1 enters correct code | Accepted, Mark delivered enabled | P0 |
| H-04 | Wrong code | API | 3 wrong codes | 400 each, after 5 wrong tries locked 15 min, admin alerted | P0 |
| H-05 | Delivered without code | API | Mark delivered without code | 400 | P0 |
| H-06 | Cash | API | COD order | Collect cash required before delivered (existing rule) | P0 |
| H-07 | Ledger | API | Delivered | RIDER_EARNING 150, STORE_EARNING, COMMISSION rows match amounts | P0 |
| H-08 | Failed delivery | API | Mark failed with reason | FAILED, reason saved, customer and store notified | P1 |
| H-09 | Store rating | API | Customer rates 4 stars | StoreReview saved, store average updated | P1 |
| H-10 | Rate twice | API | Rate same order again | 409 | P2 |
| H-11 | Rate before delivery | API | Order not delivered | 400 | P1 |

## I. Records and admin

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| I-01 | List history | E2E | Admin opens a list | Shows every broadcast (store, radius, time, seen, declined), every bid with versions, accept time | P0 |
| I-02 | Rider bid history | E2E | Admin opens an order | Shows all rider bids and who won | P1 |
| I-03 | Admin cancel list | API | Admin cancels a BIDDING list | CANCELLED, stores and customer notified, AuditLog row | P1 |
| I-04 | Settings | E2E | Admin changes radius start to 3 km | Next list uses 3 km | P1 |
| I-05 | Permissions | API | ORDER_MANAGER opens bidding admin | Allowed or 403 per role table | P1 |
| I-06 | Finance totals | API | 5 bid orders delivered | Finance page totals equal ledger sums | P0 |

## J. Notifications and push

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| J-01 | Register device | API | App sends FCM token | DeviceToken saved, same token not duplicated | P0 |
| J-02 | Push reaches phone | Manual | New list near store owner's phone, app closed | Push arrives within 10 s | P0 |
| J-03 | Tap opens screen | Int | Tap "New offer" push | App opens that list's offer screen | P0 |
| J-04 | Dead token | API | FCM says token invalid | Token deleted | P1 |
| J-05 | Logout | API | Logout from app | That device's token removed, no more pushes | P1 |
| J-06 | Urdu text | Manual | Phone in Urdu | Push text in Urdu | P2 |
| J-07 | In-app list | E2E | Website notifications page | Same notifications as the app shows | P1 |

## K. Security and permissions

| ID | Case | Type | Steps | Expected | Pri |
|---|---|---|---|---|---|
| K-01 | Every new route needs login | API | Call each new route with no token | 401 | P0 |
| K-02 | Role matrix | API | Each role × each new route | Only allowed roles get 2xx | P0 |
| K-03 | Data leak | API | Store and rider responses | No customer phone, email or full address before they win | P0 |
| K-04 | IDs guessed | API | Change ids in URLs | 404, never another user's data | P0 |
| K-05 | Input injection | API | HTML/script in list item names and notes | Stored as text, shown escaped | P1 |
| K-06 | No secrets in APK | Manual | Unzip release APK, search for keys | Only public config (API URL, Firebase public config, Stripe publishable key) | P0 |
| K-07 | HTTPS only | Int | App with `http://` URL | Blocked by network security config | P1 |
| K-08 | Malware check | Manual | Before each release: check `package.json` scripts, `postcss.config.mjs`, new root files, very long lines | Clean | P0 |

## L. Website responsive

Run with Playwright at widths **360, 390, 768, 1024, 1280, 1440**.

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| L-01 | No horizontal scroll | E2E | `document.documentElement.scrollWidth <= innerWidth` on every page | P0 |
| L-02 | Home, product, store, search | E2E | Grid columns 2 / 3 / 4 / 5 by width, images not stretched | P1 |
| L-03 | Cart and checkout | E2E | Sticky bottom bar with total and button on phone widths | P0 |
| L-04 | Send list | E2E | Lines editable at 360 px, keyboard doesn't hide the add button | P0 |
| L-05 | Compare offers | E2E | Cards on phone, side-by-side columns ≥ 1024 | P0 |
| L-06 | Store bid form | E2E | One line per row, "Don't have" toggle and price field fit at 360 px | P0 |
| L-07 | Store / rider / admin portals | E2E | Sidebar becomes a drawer below 1024 px | P1 |
| L-08 | Tables | E2E | Orders, finance, payouts tables become cards below 768 px | P1 |
| L-09 | Tap targets | E2E | Buttons and links at least 44 × 44 px on phone widths | P1 |
| L-10 | Urdu text | E2E | Urdu tagline and item names don't overflow | P2 |
| L-11 | Screenshots | Golden | Screenshot per page per width, compared with approved images | P2 |
| L-12 | Lighthouse mobile | E2E | Home and product pages: Performance ≥ 70, Accessibility ≥ 90 | P2 |

## M. Flutter app features

### M1. Common

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| M1-01 | First launch | Int | Splash → choose "Shop", "Sell" or "Deliver" → login | P0 |
| M1-02 | Login per role | Int | Customer, store owner, rider each land on their own home | P0 |
| M1-03 | Stay logged in | Int | Kill app, open again | Still logged in (refresh token) | P0 |
| M1-04 | Token refresh during use | Widget | API returns 401 TOKEN_EXPIRED once | App refreshes and retries silently | P0 |
| M1-05 | Refresh fails | Widget | Refresh returns 401 | Back to login with a message | P0 |
| M1-06 | No internet | Widget | Airplane mode | "No internet" banner, cached screens still visible, retry button | P0 |
| M1-07 | Server error | Widget | API returns 500 | Friendly error, no crash, error sent to Crashlytics | P1 |
| M1-08 | Force update | Widget | `/api/app/config` min version above installed | Blocking "Update app" screen with Play link | P1 |
| M1-09 | Urdu | Widget | Switch to Urdu | Layout right-to-left, all labels translated | P1 |
| M1-10 | Register customer | Int | Sign up, verify email link | Account active, same as website | P0 |
| M1-11 | Forgot password | Int | Request reset | Email arrives, reset works on website page | P1 |
| M1-12 | Account deletion | Int | Delete account | Website marks the account for deletion, user logged out | P0 |
| M1-13 | Back button | Int | Android back on every screen | Goes back, never exits from a sub-screen | P1 |

### M2. Customer

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| M2-01 | Home | Widget | Banners, categories, deals, stores load from the same APIs as the website | P0 |
| M2-02 | Search | Int | Results match website search for the same word | P0 |
| M2-03 | Product page | Widget | Price, sale price, unit, stock, add to cart | P0 |
| M2-04 | Cart sync | Int | Add on app, open website with same account | Same cart | P0 |
| M2-05 | Coupon | Int | Valid and invalid coupons | Same messages as website | P1 |
| M2-06 | Address with pin | Int | Add address, drag pin, use current location | Lat/long saved, shown on website | P0 |
| M2-07 | Checkout COD | Int | Place COD order | Order on website with same number and totals | P0 |
| M2-08 | Stripe | Int | Test card 4242… | Order CONFIRMED after payment | P0 |
| M2-09 | JazzCash form | Int | Opens WebView, sandbox payment | Returns to app, order CONFIRMED | P1 |
| M2-10 | JazzCash QR | Int | Show QR, upload proof photo | Proof visible to admin, order waits for approval | P1 |
| M2-11 | Send list | Int | Type 5 items with quantities and units, pick address, send | List in BIDDING, visible on website | P0 |
| M2-12 | Custom item in cart | Int | "+ Add custom item" | Cart shows "Stores will bid" | P0 |
| M2-13 | Offers update | Int | Store bids from the website | Offer appears in app within 10 s (push or refresh) | P0 |
| M2-14 | Compare | Widget | 3 offers | Total, covered, missing, prep time, rating, tags | P0 |
| M2-15 | Accept | Int | Accept with 1 missing item | Confirm dialog says 1 item removed, order created | P0 |
| M2-16 | Edit and cancel list | Int | Edit then cancel while bidding | Same results as B-07 and B-09 | P1 |
| M2-17 | Rider bids | Int | Order ready, riders bid | Bids listed, accept one, order shows rider | P0 |
| M2-18 | Delivery code | Widget | Order out for delivery | Code shown large, copy button | P0 |
| M2-19 | Track order | Widget | Status timeline matches OrderStatusEvent list | P1 |
| M2-20 | Invoice | Int | Download invoice | PDF opens | P2 |
| M2-21 | Rate store and products | Int | After delivery | Saved, visible on website | P1 |
| M2-22 | Refund request | Int | Damaged item | Request visible in admin refunds | P1 |
| M2-23 | Wishlist | Int | Add/remove | Same as website | P2 |

### M3. Store portal

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| M3-01 | Store application | Int | Fill details, categories, upload CNIC and shop photos | Shows in admin store approvals | P0 |
| M3-02 | Pending / rejected / reapply | Widget | Each status shows the right screen | P1 |
| M3-03 | Incoming lists | Int | New list near store | Appears in "Lists" with badge and push | P0 |
| M3-04 | Bid form | Widget | Toggle "Don't have", enter prices, discount, prep time | Total updates live, can't submit with empty prices on available lines | P0 |
| M3-05 | Submit bid | Int | Submit | Customer sees it on website and app | P0 |
| M3-06 | Edit / withdraw / can't supply | Int | Each action | Same as D-08, D-13, D-12 | P1 |
| M3-07 | Accepted | Int | Customer accepts | Push "Customer accepted your bid", order in Orders | P0 |
| M3-08 | Fulfilment | Int | Processing → Packed → Ready | Same as website, rider bidding starts | P0 |
| M3-09 | Products | Int | Add product with 3 photos, variant, stock | Visible on website after approval rules | P1 |
| M3-10 | Deals | Int | Create deal | Shows on website deals | P2 |
| M3-11 | Finance and payouts | Widget | Numbers equal website store finance page | P1 |

### M4. Rider portal

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| M4-01 | Rider application | Int | Upload selfie, CNIC both sides, licence, bike photos | Shows in admin riders | P0 |
| M4-02 | Online / offline | Int | Toggle | Status saved, offline rider gets no requests | P0 |
| M4-03 | Requests | Int | Order ready nearby | Request with pickup, drop, distance, countdown | P0 |
| M4-04 | Bid | Int | Enter amount | Saved, customer sees it | P0 |
| M4-05 | Won | Int | Customer accepts | Push, delivery appears in Deliveries | P0 |
| M4-06 | Navigate | Manual | "Open in Maps" | Google Maps opens with store, then customer pin | P1 |
| M4-07 | Start, code, cash, delivered | Int | Full delivery | Same as H-02 to H-06 | P0 |
| M4-08 | Failed | Int | Mark failed with reason | Same as H-08 | P1 |
| M4-09 | Earnings | Widget | Totals equal website rider earnings | P1 |
| M4-10 | Remittance | Int | Submit COD remittance with proof | Visible in admin remittances | P0 |
| M4-11 | COD restriction | Widget | Overdue cash | Banner, bidding blocked with reason | P0 |

## N. App responsive and devices

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| N-01 | Small phone 360×640 | Golden | All main screens fit, no overflow warnings | P0 |
| N-02 | Large phone 411×891 | Golden | Same | P0 |
| N-03 | Tablet 800×1280 | Golden | Navigation rail, two-pane lists (list + detail) | P1 |
| N-04 | Landscape | Golden | No overflow in landscape on phone | P2 |
| N-05 | Text size 1.5× | Golden | No clipped text on buttons and prices | P1 |
| N-06 | Urdu right-to-left | Golden | Mirrored layout correct | P1 |
| N-07 | Android 8 (API 26) | Manual | App installs and runs | P1 |
| N-08 | Android 15/16 | Manual | Notification permission asked, edge-to-edge looks right | P0 |
| N-09 | Low-end phone (2 GB RAM) | Manual | Home loads < 3 s on 4G, scrolling smooth | P2 |
| N-10 | Dark mode | Golden | Readable, or locked to light if not designed | P2 |

## O. Performance and reliability

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| O-01 | 50 stores bid on one list at once | API | All saved, no duplicate rows, under 2 s each | P1 |
| O-02 | 200 lists created in 1 minute | API | Broadcasts done, API p95 < 800 ms | P2 |
| O-03 | Polling load | API | 500 open app screens refreshing every 8 s | Vercel and DB stay within limits | P2 |
| O-04 | Push failure | API | FCM down | In-app notification still saved, list flow continues | P1 |
| O-05 | Database restart | Manual | Neon restart during bidding | App shows retry, no lost bids | P2 |

## P. Release

| ID | Case | Type | Expected | Pri |
|---|---|---|---|---|
| P-01 | Signed release build | Manual | `flutter build appbundle --release` succeeds, signed with upload key | P0 |
| P-02 | Play pre-launch report | Manual | No crashes, no accessibility blockers | P0 |
| P-03 | Data safety form matches app | Manual | Location, contact info, photos, payment declared | P0 |
| P-04 | Privacy and deletion links work | Manual | `/privacy` and account deletion page open | P0 |
| P-05 | Website deploy | Manual | Migration applied on production DB, `next build` green, smoke test of cart checkout and list bidding | P0 |
| P-06 | Rollback | Manual | Feature flag in `/api/app/config` turns list bidding off without a new app release | P1 |
