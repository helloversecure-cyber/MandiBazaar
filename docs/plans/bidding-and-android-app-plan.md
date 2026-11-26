# MandiBazaar: Store Bidding, Rider Bidding and Android App Plan

Status: plan only, nothing built yet. Written 26 Nov 2026 after reading the
MandiBazaar codebase (`main` at `37d7cdb`) and the Apni Dukan website
(home page, "How kirana bidding works" guide, help articles on sending a list,
choosing a shop, seller bids, delivery).

Test cases are in a separate file: [test-cases.md](test-cases.md).

---

## 1. What we are building

1. **List bidding (like Apni Dukan).** A customer types a list of items (or adds
   items from the catalog plus custom items). Nearby stores see it, mark items
   they don't have, and bid a price. The customer compares offers and accepts
   one. That becomes a normal MandiBazaar order.
2. **Rider bidding after packing** (only for orders that started as an item list;
   normal cart orders keep today's flow). When the store marks the order ready,
   nearby riders bid a delivery fee. The customer accepts one rider. The rider
   delivers, the customer confirms with a delivery code.
3. **Everything is recorded**: who got the list, every bid, every accept and
   reject, every status change, all money in the ledger.
4. **A Flutter Android app** with the customer, store and rider features of the
   website, including both kinds of bidding.
5. **Website and app both responsive** (phones, tablets, desktop).

### 1.1 Same database, same services

The app must **not** connect to the database directly. A database password
inside an APK can be pulled out by anyone who downloads the app.

```
 Flutter Android app ─┐
                      ├──► Next.js API on Vercel (www.mandibazaar.pk/api/...) ──► Postgres (Neon)
 Website (browser) ───┘        same business logic, same auth rules,              same tables
                               same payments, uploads, notifications
```

Both the website and the app call the same `/api/...` routes, so prices,
commission, stock, payouts and permissions stay identical. The only backend
additions for the app are: login with a token instead of a cookie, push
notifications, and a few JSON endpoints for screens that today are rendered
server-side.

---

## 2. What already exists (and gets reused)

| Area | Where | Reuse |
|---|---|---|
| Rider bidding engine (bids, accept with row locks, expiry, eligibility) | `src/lib/orders/bidding.ts`, `DeliveryRequest`, `RiderBid` | Generalise to work on an existing order after packing |
| Order lifecycle `CONFIRMED → PROCESSING → PACKED → READY_FOR_DISPATCH → ASSIGNED_TO_RIDER → OUT_FOR_DELIVERY → DELIVERED` | `src/lib/orders/state-machine.ts` | Unchanged |
| "All stores ready → order ready" | `src/lib/orders/fulfillment-sync.ts` | Trigger point for rider bidding |
| Status history, audit, money ledger | `OrderStatusEvent`, `AuditLog`, `LedgerEntry` | Every bidding event is written here |
| Notifications (in-app, SMS/WhatsApp via Twilio, email via Resend) | `src/lib/notifications/service.ts` | Add a `PUSH` channel (Firebase Cloud Messaging) |
| Delivery confirmation link | `src/lib/orders/delivery-confirm.ts` | Add a 4-digit delivery code |
| Store and address map pins, distance | `Store.latitude/longitude`, `Address.latitude/longitude`, `haversineKm` | Radius matching (5 to 20 km) |
| Store categories | `Store.requestedCategories` | Only send lists to matching stores |
| Payments (Stripe PaymentIntent, JazzCash form, JazzCash QR + proof upload) | `src/lib/payments/*`, `api/stripe`, `api/jazzcash`, `api/orders/payment-proof` | App uses the same endpoints |
| Uploads (S3-compatible storage on Neon) | `api/upload` | App uploads through it |
| Login (NextAuth, JWT in a cookie, 7 days) | `src/lib/auth/auth.ts`, `src/middleware.ts` | Add bearer-token login for the app |
| Firebase (email verification, password reset) | `firebase`, `firebase-admin` | Also used for push |
| 55 API routes, 24 test files, 379 passing tests | `src/app/api`, `tests/` | Extend |

Gaps found:

- Riders currently bid **before** checkout on a cart, and every rider in every city sees every request.
- Reviews are per product only. There is no store rating.
- Vercel Hobby only runs crons once a day, so timed steps (radius widening, expiry) must also run when someone opens a page.
- Login only works with a browser cookie, so a phone app can't call the API yet.

---

## 3. Business flow

### 3.1 List bidding (stores)

| Step | Customer | Store | System |
|---|---|---|---|
| 1 | Writes a list ("Atta 10kg × 1", "Milk 1L × 2") or uses the cart with "+ Add custom item". Picks an address with a map pin. | | Creates `ItemList` (status `BIDDING`). |
| 2 | Sees "Waiting for offers" | Gets notification "New list near you" | Sends it to up to 20 approved stores within 5 km that sell the matching categories. Logs each in `ListBroadcast`. |
| 3 | | Opens the list, marks "Don't have" per item, enters a unit price for each item it has, optional discount, preparation time, note. Or taps "Can't supply". | Saves `StoreBid` and `StoreBidLine`. Customer is notified of each new offer. |
| 4 | Can edit or cancel the list while bidding | Can edit its bid until the customer accepts | If no bid in 30 min, the radius grows to 10, 15, 20 km. If no store anywhere, the customer is told. |
| 5 | Compares offers: total, items covered ("8 of 10"), missing items, preparation time, estimated delivery fee, store rating, tags "Lowest price" and "Fastest". | | |
| 6 | Accepts one offer (a confirm screen shows which items will be dropped) | Winner: "Customer accepted your bid". Others: "Not selected". | In one transaction: bid → `ACCEPTED`, other bids → `NOT_SELECTED`, list → `ACCEPTED`, a normal `Order` + `OrderItem` + `StoreFulfillment` is created with only the covered items. |

### 3.2 Rider bidding (after packing)

| Step | Customer | Store | Rider | System |
|---|---|---|---|---|
| 1 | | Processing → Packed → Ready (existing buttons) | | Order becomes `READY_FOR_DISPATCH`. A `DeliveryRequest` (`trigger = POST_PACK`) opens for this order. |
| 2 | Notified "Riders are bidding" | | Riders who are near the store, online, approved and have no overdue COD cash get notified. They see pickup area, drop area and distance only. | |
| 3 | Sees rider bids (price, vehicle, deliveries done), accepts one | Sees which rider is coming | Winner: "Your bid was accepted" | Order → `ASSIGNED_TO_RIDER`, `deliveryFee` and `Delivery.riderFee` = bid amount. Other bids → `REJECTED`. |
| 4 | Gets a 4-digit delivery code | Hands the bag to the rider | Start delivery → `OUT_FOR_DELIVERY` | |
| 5 | Pays cash (or online), gives the code | | Enters the code, collects cash, marks delivered | Order → `DELIVERED`. Ledger entries for sale, 5% commission, store earning, rider earning. |
| 6 | Rates the store | | | `StoreReview` saved |

Fallback: no rider bid within the window → re-open once → order shows in admin
for the existing manual "Assign rider".

### 3.3 Decisions

Decided by the owner on 26 Nov 2026:

1. **Payment collection stays as it is today.** The platform collects, takes its commission and pays stores and riders through the existing ledger and payouts. List-bidding orders use exactly the same payment process.
2. **Normal catalog orders stay unchanged.** Cart → checkout → payment works exactly as today. Store bidding and rider bidding after packing apply only to orders that start as an item list.
3. **No separate staging environment for now.** Work runs against production, with the guardrails in section 7.2.

Still open (my recommendation in bold, used unless the owner says otherwise):

4. Delivery fee for list orders, known only after a rider is chosen: **cash to the rider by default, online optional**.
5. Pickup (customer collects, no rider): **later**.
6. Admin panel in the app: **no**, admin stays on the website.
7. App name and package: **"MandiBazaar", package `pk.mandibazaar.app`**.

---

## 4. Backend changes (website repo)

### 4.1 Database (additive migration, no existing column changed or dropped)

```prisma
enum ItemListStatus { BIDDING ACCEPTED CANCELLED NO_STORES EXPIRED }
enum StoreBidStatus { PENDING ACCEPTED NOT_SELECTED WITHDRAWN DECLINED }
enum DeliveryRequestTrigger { CHECKOUT POST_PACK }

model ItemList {
  id               String   @id @default(cuid())
  customerId       String
  status           ItemListStatus @default(BIDDING)
  addressSnapshot  Json
  latitude         Float?
  longitude        Float?
  city             String
  radiusKm         Int      @default(5)
  lastWidenedAt    DateTime @default(now())
  expiresAt        DateTime
  acceptedBidId    String?  @unique
  orderId          String?  @unique
  note             String?
  lines            ItemListLine[]
  bids             StoreBid[]
  broadcasts       ListBroadcast[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([customerId]) @@index([status, city])
}

model ItemListLine {
  id          String  @id @default(cuid())
  listId      String
  name        String
  quantity    Decimal @db.Decimal(10, 3)
  unit        String
  categoryId  String?
  productId   String?   // set when added from the catalog
  note        String?
  sortOrder   Int     @default(0)
}

model ListBroadcast {          // who received the list, when, and what they did
  id         String   @id @default(cuid())
  listId     String
  storeId    String
  radiusKm   Int
  sentAt     DateTime @default(now())
  seenAt     DateTime?
  declinedAt DateTime?
  @@unique([listId, storeId])
}

model StoreBid {
  id             String   @id @default(cuid())
  listId         String
  storeId        String
  status         StoreBidStatus @default(PENDING)
  itemsTotal     Decimal  @db.Decimal(12, 2)
  discount       Decimal  @default(0) @db.Decimal(12, 2)
  prepMinutes    Int?
  note           String?
  coveredCount   Int
  lines          StoreBidLine[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([listId, storeId])
}

model StoreBidLine {
  id         String  @id @default(cuid())
  bidId      String
  lineId     String
  available  Boolean
  unitPrice  Decimal? @db.Decimal(12, 2)
  @@unique([bidId, lineId])
}

model StoreReview {
  id        String @id @default(cuid())
  storeId   String
  orderId   String @unique
  userId    String
  rating    Int
  comment   String?
  createdAt DateTime @default(now())
}

model DeviceToken {             // Firebase Cloud Messaging tokens for push
  id         String   @id @default(cuid())
  userId     String
  token      String   @unique
  platform   String   // "android"
  lastSeenAt DateTime @default(now())
}

model MobileRefreshToken {      // app login sessions, hashed, revocable
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique
  deviceName String?
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime @default(now())
}

// Additions to existing models
// Order:            itemListId String? @unique, deliveryCodeHash String?
// DeliveryRequest:  trigger DeliveryRequestTrigger @default(CHECKOUT), city String?
// NotificationChannel enum: add PUSH
// StoreSettings:    listRadiusStartKm Int @default(5), listRadiusMaxKm Int @default(20),
//                   listRadiusStepMins Int @default(30), listMaxStores Int @default(20),
//                   postPackBidWindowSecs Int @default(300)
```

### 4.2 API (new routes, all under the existing `/api`)

| Route | Who | Purpose |
|---|---|---|
| `POST /api/mobile/auth/login` | anyone | Same password + lockout check as the website. Returns a 1-hour access token (same JWT format NextAuth uses) and a 30-day refresh token |
| `POST /api/mobile/auth/refresh`, `POST /api/mobile/auth/logout` | app | Rotate / revoke refresh token |
| `POST /api/devices` / `DELETE /api/devices/:token` | signed in | Register / remove push token |
| `POST /api/lists`, `GET /api/lists`, `GET/PATCH/DELETE /api/lists/:id` | customer | Create, list, view with live offers, edit, cancel |
| `POST /api/lists/:id/accept` | customer | Accept a store bid, creates the order |
| `GET /api/store/lists`, `GET /api/store/lists/:id` | store | Incoming lists near the store |
| `PUT /api/store/lists/:id/bid`, `POST /api/store/lists/:id/decline`, `DELETE /api/store/lists/:id/bid` | store | Bid / edit, can't supply, withdraw |
| `GET /api/orders/:orderNumber/rider-bids`, `POST /api/orders/:orderNumber/rider-bids/:bidId/accept` | customer | Rider bidding after packing |
| `GET /api/rider/bids` (extended) | rider | Now filtered by distance and includes after-packing requests |
| `POST /api/rider` action `VERIFY_DELIVERY_CODE` | rider | Code check before Mark delivered |
| `POST /api/stores/:id/reviews` | customer | Store rating after delivery |
| `GET /api/app/config` | anyone | Minimum app version, feature flags, payment methods on/off |

Plus JSON versions of any screen data that today only exists as server-rendered
pages (found during Phase 0's API inventory).

### 4.3 How the app logs in (one small change, all 55 routes work)

- Every route already calls `getSession()` / `requireAuth()` / `requireRider()` / `requireStorePortal()`.
- Change `getSession()` so that if there is no cookie session, it reads `Authorization: Bearer <token>` and decodes it with `next-auth/jwt` using the same `NEXTAUTH_SECRET`.
- `src/middleware.ts` already uses `getToken`, which also reads the bearer header.
- Result: the website keeps using cookies, the app sends a header, and both go through the same role checks.
- Login rate limiting, lockout and the portal check (`portalAccessError`) are reused as they are.

### 4.4 Timers without a paid cron

Vercel Hobby only runs crons daily. Radius widening, list expiry and rider-bid
expiry run:

1. whenever a customer, store or rider loads a list or bid (lazy, like `expireIfStale` in `bidding.ts` today),
2. in the existing daily cron as a sweep.

For exact 30-minute steps, either upgrade to Vercel Pro (cron every minute) or use a free external cron (cron-job.org) that calls a protected `/api/cron/lists-tick`.

### 4.4a List rounds (owner rule, 48 h restart)

- Each round is open for `listExpiryHours` (default **48**). `ItemList.expiresAt` is the end of the current round; `ItemList.round` starts at 1.
- When a round ends without an accept, `tickList` locks the list, marks that round's PENDING offers `EXPIRED` (kept), and restarts: `round + 1`, fresh window, radius back to the start. Last round's bidders get it again straight away ("List restarted, bid again"), then the first circle as for a new list; the customer gets "Your list restarted — round N".
- About 6 h before a round ends (half the window if shorter), the customer gets one "Your offers expire in 6 hours — choose one" per round, only when there are offers (`reminderSentAt`).
- `StoreBid` is one per store per list **per round**; `ListBroadcast.round` is the latest round a store got the list in.
- Stops on accept, customer cancel or admin cancel. `listMaxRounds` (default 0 = unlimited) ends the list as `EXPIRED` after that many rounds.
- Same tick triggers as above (on read, `/api/cron/lists-tick`, the daily cron).

### 4.5 Website pages

- Customer: `/send-list`, cart "+ Add custom item", `/account/lists`, `/account/lists/[id]` (compare offers), rider bids section on `/account/orders/[orderNumber]`, delivery code, store rating.
- Store: `/store-portal/lists`, `/store-portal/lists/[id]` (bid form), "My bids", badge in sidebar.
- Rider: `/rider-portal/bids` now shows distance and after-packing requests, delivery code entry on the delivery screen.
- Admin: `/admin/bidding` gets tabs "Item lists" (with broadcast log and all bids) and "Rider bids", plus settings for radius, window and store limit.

---

## 5. Flutter Android app

### 5.1 Repository and folder

- Folder: `/Users/mac/StudioProjects/MandiBazaarApp`
- Repo: `helloversecure-cyber/MandiBazaarApp` (private)
- The owner creates the empty repo under `helloversecure-cyber` (a personal account, so the account on this Mac can't) and adds `UsamaKhan123456789` as a collaborator with write access.
- Security note: the malware commits in the website repo came through this account (`b55ab76` is authored by `helloversecure-cyber`, and `main` was force-pushed again on 23 Nov). The owner will secure the account later. Until then: turn on branch protection for `main` in both repos (no force-push, pull requests required), and re-run the malware scan before every deploy.
- Scan result on 26 Nov 2026: all MandiBazaar branches (local and remote) clean. Local Fan-Arena, Passione90LandingPage and Passione90AdminDashboard clean. This Mac showed no running loader, no launch agents, no cron jobs and no known stealer folders.

### 5.2 Tech stack

| Concern | Choice | Why |
|---|---|---|
| Flutter | 3.47.7 stable (already installed at `/Users/mac/Documents/flutter`) | |
| State | Riverpod | Testable, no BuildContext needed for logic |
| Navigation | go_router | Deep links from push notifications (`/orders/MB-123`) |
| Networking | dio + interceptor for bearer token and refresh | One place for auth, retries, errors |
| Models | freezed + json_serializable | Typed API responses |
| Secure storage | flutter_secure_storage | Refresh token in Android Keystore |
| Push | firebase_messaging + flutter_local_notifications | Same Firebase project as the website |
| Maps / pin | flutter_map (OpenStreetMap) + geolocator | No Google Maps billing; website also has no paid map |
| Images | cached_network_image, image_picker | Product photos, store and rider documents |
| Payments | flutter_stripe (PaymentIntent, the website already returns `clientSecret`), WebView for JazzCash form, QR image + proof upload for JazzCash QR | Same payment endpoints |
| Language | flutter_localizations, English + Urdu (right-to-left) | Website already shows Urdu |
| Errors | Firebase Crashlytics | Crash reports from real phones |
| Tests | flutter_test, mocktail, integration_test, golden tests | See test cases |

### 5.3 App structure

```
MandiBazaarApp/
  lib/
    core/        api client, auth, config, errors, theme, l10n, responsive helpers
    shared/      widgets (buttons, cards, price, status chip, empty/error/loading)
    features/
      auth/            login (customer / store / rider), register, verify email, forgot password
      onboarding/      customer, store (documents, categories), rider (documents)
      catalog/         home, categories, search, product, stores, store page, deals
      cart/            cart, custom items, coupons, quote
      checkout/        address + map pin, payment choice, Stripe, JazzCash, QR + proof
      lists/           send list, my lists, compare offers, accept
      orders/          my orders, order detail, tracking, rider bids, delivery code, invoice, rating, refund request
      account/         profile, addresses, wishlist, notifications, security
      store_portal/    dashboard, incoming lists + bid form, my bids, orders + fulfilment, products, deals, finance, payouts, settings, reapply
      rider_portal/    go online/offline, delivery requests + bid, deliveries (start, code, collect cash, delivered, failed), earnings, remittances, profile
  test/  integration_test/  android/
```

One app, three roles. After login the app opens the right home for the role,
like the website portals do. A store owner or rider can switch to "Shop as customer"
where the website allows it.

### 5.4 Feature parity checklist

Customer: browse, search, categories, deals, stores, product detail, wishlist,
cart, coupon, address with pin, checkout, all three payment methods, order list
and detail, invoice PDF, cancel where allowed, refund request, reviews,
notifications, profile, change password, **send list, compare store offers,
accept, rider bids, delivery code, store rating**.

Store: application with documents and categories, pending/rejected/reapply
screens, dashboard, products (add/edit with images, stock, variants), deals,
orders and fulfilment steps, finance, payouts, settings, **incoming lists, bid
form with "Don't have", my bids**.

Rider: application with documents, pending screen, online/offline, delivery
requests with bidding, deliveries (start, code, collect cash, payment proof,
delivered, failed), earnings, COD remittances, profile.

### 5.5 Release

- Package `pk.mandibazaar.app`, upload key kept outside the repo, Play App Signing on.
- Play Console: the website is already verified in Search Console (done 23 Nov), which the Play Console asked for.
- Internal testing track → closed testing (20 testers for 14 days, required for new personal Play accounts) → production.
- Privacy policy link: `https://www.mandibazaar.pk/privacy`. Data safety form: location, phone, email, photos, payment info (processed by Stripe/JazzCash).
- Account deletion page (Play requires one): add `/account/delete` on the website and a button in the app.

---

## 6. Responsive design

### Website

- Check every page at widths 360, 390, 768, 1024, 1280 and 1440 px.
- Rules: no horizontal scroll, tap targets at least 44 px, tables become cards under 768 px, sticky bottom action bar on phones for cart/checkout/bid/accept, side navigation becomes a drawer under 1024 px on store/rider/admin portals.
- Automated with Playwright screenshots at those widths (test cases L-*).

### App

- Phones 320 to 480 dp wide, small tablets 600 dp, tablets 840 dp+.
- Breakpoints in `core/responsive`: compact < 600, medium 600 to 839, expanded ≥ 840.
- Compact: bottom navigation, single column. Medium: two-column grids, navigation rail. Expanded: list + detail side by side (for example list of offers + offer detail).
- Text scale up to 1.5×, Urdu right-to-left, portrait and landscape, Android 8 (API 26) and up.
- Golden tests at 360×640, 411×891 and 800×1280 (test cases N-*).

---

## 7. Agents: who does what

I act as the **lead**. I write the API contract, hand out work, review every
change, run the full test suite, and merge. The other agents each work in their
own git worktree on their own branch, so no two agents edit the same files.

| # | Agent | Repo | Owns | Starts after |
|---|---|---|---|---|
| 0 | **Lead / architect** (this session) | both | API contract (OpenAPI file), schema review, code review, merges, release | now |
| 1 | **Backend: bidding** | website | Prisma migration, `src/lib/lists/*`, `src/app/api/lists/*`, `api/store/lists/*`, post-pack rider bidding in `bidding.ts` and `fulfillment-sync.ts`, ledger, cron tick | contract frozen |
| 2 | **Backend: mobile platform** | website | Bearer token login, refresh tokens, `getSession()` change, push (`DeviceToken`, `PUSH` channel), `/api/app/config`, missing JSON endpoints, account deletion | contract frozen |
| 3 | **Web UI** | website | All new website pages (send list, compare offers, store bid form, rider bids after packing, admin tabs) and the responsive pass of existing pages | agent 1 has endpoints on a branch |
| 4 | **Flutter: core + customer** | app | App skeleton, theme, auth, API client, push, maps, catalog, cart, checkout, payments, orders, lists and compare offers, account | agent 2 has login done |
| 5 | **Flutter: store + rider** | app | Store portal (incl. bid form) and rider portal (incl. rider bidding and delivery code) | agent 4 has the skeleton |
| 6 | **QA and security** | both | Writes and runs the tests in `test-cases.md`: API tests (vitest), website end-to-end (Playwright), Flutter widget/integration/golden tests. Checks permissions, rate limits and secrets. | from week 1, alongside everyone |

**Total: 7** (1 lead + 6 working agents). At most 4 run at the same time, which
keeps reviews manageable and costs under control.

### Rules for the agents

- Each agent gets a written brief: goal, files it owns, contract section, tests it must pass, definition of done.
- Branch names: `feat/lists-backend`, `feat/mobile-platform`, `feat/web-lists-ui`, `feat/app-core-customer`, `feat/app-store-rider`, `test/qa`.
- No agent pushes to `main`. Each opens a pull request. I review, QA runs the tests, then I merge.
- Secrets stay in `.env` (website) and in local build config (app), never in git.

### 7.2 Working on production without staging (owner's decision)

There is one database, and real customers, stores and money live in it. So:

- **Automated tests never touch production.** Vitest and Playwright run against a local Postgres started with the repo's `docker-compose.yml`, seeded with test data. Flutter widget tests use a fake API.
- **Migrations are additive only**: new tables, new nullable columns, new enum values. Nothing is renamed or dropped. Each migration is reviewed by me before `prisma migrate deploy`, and a Neon backup (branch snapshot) is taken right before it.
- **New features ship switched off.** A setting `listBiddingEnabled` (admin settings + `/api/app/config`) stays off for the public until UAT passes. Test accounts get it switched on.
- **UAT on production uses marked test accounts** (`test+…@mandibazaar.pk`, stores and riders named "TEST …", `isVirtual` stores where possible). Their orders are excluded from finance reports and payouts, and cleaned up after UAT.
- **Payments in UAT** use Stripe test mode and the JazzCash sandbox on the test accounts only. No real money moves.
- **Agents get no production database URL.** Only I run migrations and production checks, after review.
- If the owner later wants a staging copy, it's one Neon branch and one Vercel preview environment. Nothing in this plan has to change.

---

## 8. Timeline (about 8 weeks)

| Week | Lead | Agent 1 | Agent 2 | Agent 3 | Agent 4 | Agent 5 | Agent 6 |
|---|---|---|---|---|---|---|---|
| 1 | Contract, schema, briefs, staging DB, repo setup | Migration, list create/edit/cancel | Bearer login, refresh, `getSession` | Responsive audit of existing pages | App skeleton, theme, API client | | Test plan, test DB seed, CI |
| 2 | Review | Broadcast + radius, store bid, accept → order | Push notifications, app config | Fix responsive issues | Login, register, onboarding | | API tests for lists |
| 3 | Review | Post-pack rider bidding, delivery code, store rating | Missing JSON endpoints, account deletion | Send list, compare offers pages | Catalog, search, cart, custom items | Store skeleton, incoming lists, bid form | Website E2E for list bidding |
| 4 | Review, first staging demo | Admin data, ledger checks, cron tick | Done → helps agent 1 with tests | Store bid pages, rider bids after packing | Checkout, payments, addresses | Store orders, products, finance | App widget tests |
| 5 | Review | Bug fixes | | Admin tabs, settings | Lists + compare + accept, orders, rider bids | Rider portal: requests, bids, deliveries | App integration tests |
| 6 | Full regression | Bug fixes | | Bug fixes | Account, notifications, Urdu | Remittances, earnings, profile | Security and load checks |
| 7 | Closed testing on Play, staging UAT with real stores and riders | Fixes from UAT | | Fixes | Fixes | Fixes | Regression, golden tests |
| 8 | Production release of website features, then the app | | | | | | Post-release smoke tests |

---

## 9. Definition of done

- All tests in `test-cases.md` marked P0 and P1 pass. P2 pass or have a ticket.
- Existing 379 tests still pass.
- `tsc --noEmit` clean, `next build` succeeds, `flutter analyze` clean.
- No API route reachable without the right role (checked by QA).
- Website pages pass the responsive checks at all six widths. App goldens pass on all three sizes.
- Staging run with 2 stores, 2 riders and 2 customers completes the full flow 10 times without manual fixes.
- App on Play closed testing with no crash in Crashlytics for 3 days.

---

## 10. Before we start

1. ~~Decisions~~ done (section 3.3). Items 4 to 7 use my recommendations unless changed.
2. The new GitHub repo `MandiBazaarApp`, created by the owner under `helloversecure-cyber`, with `UsamaKhan123456789` added. The owner is doing this.
3. Branch protection on `main` in both repos. Securing the account is postponed by the owner.
4. ~~Staging database~~ not needed (section 7.2). Still needed: Firebase Cloud Messaging enabled on the existing Firebase project, and a Neon backup before the first migration.
5. Play Console access for uploading builds.
