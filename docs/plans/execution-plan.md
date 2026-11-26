# MandiBazaar: Execution Plan (feature by feature)

How the work in [bidding-and-android-app-plan.md](bidding-and-android-app-plan.md)
gets built, tested and shipped, one pull request per feature, in two repos:

| Repo | Folder on this Mac | What |
|---|---|---|
| `helloversecure-cyber/MandiBazaar` (public) | `/Users/mac/StudioProjects/MandiBazaar` | Website + API + database (Next.js, Prisma, Postgres on Neon, Vercel) |
| `helloversecure-cyber/MandiBazaarApp` (private) | `/Users/mac/StudioProjects/MandiBazaarApp` | Flutter Android app |

Test IDs (A-01, M2-11, ...) refer to [test-cases.md](test-cases.md).

---

## 1. How every feature is delivered

Each feature is one branch and one pull request. The cycle never changes:

1. **Brief.** I write what the feature does, the files it may touch, the API contract and the test IDs it must pass.
2. **Build.** An agent builds it on its own branch in its own worktree (`feat/<name>`).
3. **Self-check by the agent**:
   - Website: `tsc --noEmit`, `vitest run`, `next build`, Playwright for the pages it touched.
   - App: `flutter analyze`, `flutter test`, golden tests.
4. **My review.** I read the diff and check it against the brief and the business rules. I send it back if anything is off.
5. **QA agent.** Runs the feature's test IDs plus the full regression suite, and checks the responsive widths. Website: 360, 390, 768, 1024, 1280 and 1440 px. App: 360×640, 411×891 and 800×1280 dp.
6. **Malware scan.** Every PR is checked for hidden long lines, obfuscated code, new root files and changed `dev`/`build`/`start` scripts. This runs in CI too.
7. **Pull request** opened with a summary, the test IDs and their results, and screenshots at each width.
8. **Merge** after CI is green and QA passes (see section 6 for who merges).
9. **Verify after merge.**
   - Website: Vercel deploys `main`. I smoke-test production with test accounts while the feature flag is still off for the public.
   - App: a debug APK is built from `main` and run on the emulator against production.

If a check fails at any step, it goes back to step 2. A feature is only "done"
when its test IDs pass on the merged code.

---

## 2. Website pull requests (repo `MandiBazaar`)

| # | PR | What it delivers | Tests | Agent |
|---|---|---|---|---|
| W1 | `chore/ci-and-test-db` | GitHub Actions running `tsc`, `vitest`, malware scan and `next build` on every PR. A local Postgres test database. A DB test helper with seed data (customer, 5 stores, 4 riders as in test-cases.md). Playwright installed with the 6 widths. | CI green, existing 379 tests pass | QA (6) |
| W2 | `feat/mobile-auth` | `POST /api/mobile/auth/login`, `/refresh`, `/logout`, `MobileRefreshToken` table, `getSession()` reads `Authorization: Bearer`. Website cookie login unchanged. | A-01 … A-14 | Backend platform (2) |
| W3 | `feat/lists-schema` | Additive migration: `ItemList`, `ItemListLine`, `ListBroadcast`, `StoreBid`, `StoreBidLine`, `StoreReview`, `DeviceToken`, new columns on `Order` and `DeliveryRequest`, `PUSH` channel, settings incl. `listBiddingEnabled` (off) | Migration runs up on a copy of the schema, `prisma validate`, old tests pass | Backend bidding (1) |
| W4 | `feat/lists-api` | Customer creates, views, edits and cancels lists. Rate limits, audit log. | B-01 … B-14 | Backend bidding (1) |
| W5 | `feat/lists-broadcast` | Matching by distance, category and approval. Max 20 stores, radius 5 → 20 km every 30 min. "No shop found". Lazy tick + daily cron + protected `/api/cron/lists-tick`. | C-01 … C-12 | Backend bidding (1) |
| W6 | `feat/store-bids-api` | Stores see broadcast lists, bid with "Don't have", edit, withdraw, can't supply. Out-of-date bids after a list edit. | D-01 … D-17 | Backend bidding (1) |
| W7 | `feat/accept-offer` | Accept a store bid → order + items + fulfilment in one transaction, using today's payment process. Notifications, status history, ledger. | E-01 … E-15, F-01 … F-05 | Backend bidding (1) |
| W8 | `feat/post-pack-rider-bidding` | For list orders only: rider bidding opens at Ready. Riders filtered by distance, customer accepts, fee and rider set, fallback to admin. Normal cart orders untouched. | G-01 … G-18 | Backend bidding (1) |
| W9 | `feat/delivery-code-store-rating` | 4-digit delivery code (hashed, lockout), required before Mark delivered on list orders. Store rating. | H-01 … H-11 | Backend bidding (1) |
| W10 | `feat/push-notifications` | Device token register/remove, FCM sending through the existing notification service, dead-token cleanup | J-01, J-04, J-05, O-04 | Backend platform (2) |
| W11 | `feat/app-support-endpoints` | `/api/app/config` (min version, flags), account deletion page + API, JSON endpoints for any screen the app needs that is server-rendered today | M1-08, M1-12, P-04, P-06 | Backend platform (2) |
| W12 | `feat/web-send-list` | Pages: send list, cart "+ Add custom item", my lists, compare offers + accept | B-06, E-14, E-15, L-04, L-05 | Web UI (3) |
| W13 | `feat/web-store-bidding` | Store portal: incoming lists with badge, bid form, my bids | L-06, M3 equivalents on web | Web UI (3) |
| W14 | `feat/web-rider-bids-and-code` | Customer order page: rider bids, delivery code, store rating. Rider portal: distance, after-packing requests, code entry. | G-09, G-10, H-03, H-09 on web | Web UI (3) |
| W15 | `feat/web-admin-bidding` | Admin: "Item lists" tab with broadcast log and all bids, "Rider bids" tab, settings for radius/window/limits and the on/off switch | I-01 … I-06 | Web UI (3) |
| W16 | `fix/responsive-shop` | Responsive pass: home, products, product, stores, search, cart, checkout, account | L-01 … L-03, L-09, L-10 | Web UI (3) |
| W17 | `fix/responsive-portals` | Responsive pass: store portal, rider portal, admin (drawer < 1024 px, tables → cards < 768 px) | L-07, L-08 | Web UI (3) |
| W18 | `test/e2e-full-flow` | Playwright end-to-end: list → store bids → accept → pack → rider bids → deliver with code → ledger, at all 6 widths. Security and role matrix. | K-01 … K-05, L-11, L-12, O-01 … O-03 | QA (6) |
| W19 | `chore/enable-list-bidding` | Turns the feature on for the public after UAT sign-off. A one-line settings change, but it gets its own PR so it's visible. | Smoke test on production | Lead (0) |

---

## 3. App pull requests (repo `MandiBazaarApp`)

| # | PR | What it delivers | Tests | Agent |
|---|---|---|---|---|
| A1 | `chore/scaffold` | Flutter project `pk.mandibazaar.app`, lints, folder structure, GitHub Actions (`flutter analyze`, `flutter test`, malware scan), README, `.gitignore` that keeps keys and `key.properties` out | CI green | Flutter core (4) |
| A2 | `feat/core` | Theme matching the website's colours and fonts, go_router, dio client with token refresh, secure storage, error and offline handling, responsive breakpoints, English + Urdu (right-to-left) | M1-04 … M1-09 | Flutter core (4) |
| A3 | `feat/auth` | Role choice, login per role, customer register + email verification, forgot password, stay logged in, logout | M1-01 … M1-03, M1-10, M1-11 | Flutter core (4) |
| A4 | `feat/catalog` | Home (banners, categories, deals, stores), search, category, product, store page | M2-01 … M2-03 | Flutter core (4) |
| A5 | `feat/cart-checkout` | Cart (synced with website), coupon, addresses with map pin, checkout with cash on delivery | M2-04 … M2-07 | Flutter core (4) |
| A6 | `feat/payments` | Stripe (PaymentIntent), JazzCash form in WebView, JazzCash QR + proof upload | M2-08 … M2-10 | Flutter core (4) |
| A7 | `feat/orders` | My orders, order detail with status timeline, invoice, cancel where allowed, refund request, product reviews | M2-19 … M2-22 | Flutter core (4) |
| A8 | `feat/send-list` | Send list, custom items in cart, my lists, compare offers, accept, edit/cancel while bidding | M2-11 … M2-16 | Flutter core (4) |
| A9 | `feat/rider-bids-customer` | Rider bids on order, accept, delivery code screen, store rating | M2-17, M2-18, M2-21 | Flutter core (4) |
| A10 | `feat/push` | Firebase messaging, notification permission (Android 13+), deep links to the right screen, notifications list | J-02, J-03, J-06 | Flutter core (4) |
| A11 | `feat/account` | Profile, addresses, wishlist, change password, account deletion | M1-12, M2-23 | Flutter core (4) |
| A12 | `feat/store-onboarding` | Store application with documents and categories, pending/rejected/reapply screens | M3-01, M3-02 | Store + rider (5) |
| A13 | `feat/store-bidding` | Incoming lists with badge, bid form with "Don't have", edit/withdraw/can't supply, accepted push | M3-03 … M3-07 | Store + rider (5) |
| A14 | `feat/store-orders` | Store orders and fulfilment steps (Processing, Packed, Ready) | M3-08 | Store + rider (5) |
| A15 | `feat/store-catalog-finance` | Products (photos, variants, stock), deals, finance, payouts, settings | M3-09 … M3-11 | Store + rider (5) |
| A16 | `feat/rider-onboarding` | Rider application with documents, pending screen, online/offline | M4-01, M4-02 | Store + rider (5) |
| A17 | `feat/rider-bidding-delivery` | Requests with countdown, bid, won push, open in Google Maps, start, code, collect cash, payment proof, delivered, failed | M4-03 … M4-08, M4-11 | Store + rider (5) |
| A18 | `feat/rider-money` | Earnings, COD remittances with proof, profile | M4-09, M4-10 | Store + rider (5) |
| A19 | `test/goldens-and-integration` | Golden tests at 3 sizes, text 1.5×, Urdu, landscape; integration tests for the 3 full journeys on the emulator | N-01 … N-06, M1-13 | QA (6) |
| A20 | `chore/release` | App icon and splash, signing config (key stays outside git), release AAB, Play internal test upload checklist, Crashlytics | P-01 … P-03, K-06, K-07 | Lead (0) |

---

## 4. Order of work (waves)

Some features need others first. Each wave starts when the PRs it depends on are merged.

| Wave | Website | App | Why this order |
|---|---|---|---|
| 1 | W1 CI + test DB, W2 mobile auth, W3 schema | A1 scaffold | Everything else builds on tests, login and tables |
| 2 | W4 lists API, W10 push, W11 app endpoints, W16 responsive shop | A2 core, A3 auth | App can log in against production once W2 is live |
| 3 | W5 broadcast, W6 store bids, W12 web send list | A4 catalog, A5 cart/checkout, A12 store onboarding, A16 rider onboarding | Store bids need lists; app catalog uses existing APIs |
| 4 | W7 accept offer, W13 web store bidding, W17 responsive portals | A6 payments, A7 orders, A8 send list, A13 store bidding | Accept needs bids |
| 5 | W8 post-pack rider bidding, W9 delivery code, W14 web rider bids, W15 admin | A9 rider bids (customer), A14 store orders, A17 rider bidding | Rider bidding needs accepted list orders |
| 6 | W18 full E2E suite | A10 push, A11 account, A15 store catalog/finance, A18 rider money, A19 goldens | Hardening |
| 7 | UAT on production with test accounts → W19 switch on | A20 release to Play internal testing → closed testing | Go live |

At most 4 agents work at the same time.

---

## 5. Agents

| # | Agent | Owns |
|---|---|---|
| 0 | Lead (this session) | Briefs, API contract, reviews, migrations on production, merges, releases |
| 1 | Backend: bidding | W3 to W9 |
| 2 | Backend: mobile platform | W2, W10, W11 |
| 3 | Web UI | W12 to W17 |
| 4 | Flutter: core + customer | A1 to A11 |
| 5 | Flutter: store + rider | A12 to A18 |
| 6 | QA and security | W1, W18, A19, plus running every PR's test IDs |

Rules:

- One agent per set of files.
- Nobody pushes to `main`.
- Agents never get the production database URL.
- Secrets never go into git.

---

## 6. Merging and production

- **App repo:** I merge each PR myself once CI is green and QA passes. Nothing reaches users until the Play upload in A20.
- **Website repo:** merging to `main` deploys to production on Vercel. Every new feature is behind `listBiddingEnabled`, which stays **off** for the public, so merged work is invisible to customers. I merge after CI, QA and a Vercel preview check, then smoke-test production with test accounts. If you'd rather approve every website merge yourself, I'll stop at the open PR instead.
- **Database migrations:** additive only. Before each one I take a Neon backup branch. I run `prisma migrate deploy` myself, never an agent.
- **Turning it on for customers (W19) and the Play release (A20)** happen only after you say yes.

---

## 7. What I need before starting

1. **Access to `MandiBazaarApp`.** On 26 Nov `UsamaKhan123456789` gets "Repository not found" for it, and has no pending invitation. Please check Settings → Collaborators on the repo. The invite must go to `UsamaKhan123456789` exactly, and then be accepted (GitHub email or https://github.com/notifications).
2. **Website `.env` in `/Users/mac/StudioProjects/MandiBazaar/.env`.** There is none on this Mac, only `.env.example`. Needed to run the site locally against production and to run migrations. It stays out of git.
3. **A local Postgres for automated tests.** Docker isn't installed. I'll install Postgres with Homebrew (`brew install postgresql@16`) unless you prefer Docker Desktop or a separate Neon branch for tests.
4. **Firebase:** Cloud Messaging on in the existing Firebase project, and the Android app `pk.mandibazaar.app` added there (gives `google-services.json`).
5. **Branch protection on `main`** in both repos (no force-push, PR required, CI must pass). Owner-only setting.
6. **Test accounts on production** (or permission for me to create them): 1 customer, 3 stores (marked TEST), 2 riders.
7. **Payment test keys:** Stripe test keys and JazzCash sandbox values for the test accounts.

Toolchain on this Mac is ready: Flutter 3.47.7, Android SDK 36, Java 17, and 5 devices/emulators available.

---

## 8. Done means

- All P0 and P1 test IDs pass on merged code, in both repos.
- The full journey works 10 times in a row on production with test accounts, on the website and in the app, at every width/size in the test plan.
- Existing website tests (379) still pass, and normal cart orders behave exactly as before.
- Each PR has its test results and screenshots attached.
