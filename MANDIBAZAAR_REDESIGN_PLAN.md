# MandiBazaar — Redesign Plan (Theme + Layout)

**North star:** user-friendly, simple, consistent. One design system across all 4 surfaces
(Storefront, Admin, Store portal, Rider portal).

**Confirmed look:** Light & clean shell · Bottom tab bar + "More" on mobile.

**Constraints:** Local only. No commits/pushes/deploy unless the user asks. No money logic
touched — this is UI/theme only. Logged-in dashboards can't be live-verified in this sandbox
(Firebase auth is offline); verified by typecheck + lint + tests + build + public-page screenshots.

---

## Design language (the one system)

- **Color:** `brand` emerald = primary. `accent` orange used sparingly (main CTA / deals only).
  Neutral **slate** for text, borders, surfaces. One green, one accent — no competing palettes.
- **Shell:** light background (`#f8fafc`/white), white sidebar with subtle emerald active pill,
  thin brand accent. Calm, airy, high-contrast text.
- **Radius/shadow:** rounded-2xl cards, soft `shadow-card`; reuse existing `hover-lift`/`press`/`reveal`.
- **Type:** display font for headings, clear hierarchy (page title → section → body).
- **Spacing:** consistent page padding, section gaps, card padding.

---

## Phase A — Foundation (tokens + primitives), no visual breakage
- Consolidate theme usage onto `brand` / `accent` / `surface` / slate. Keep `forest/leaf/sand/honey`
  aliases mapped in `tailwind.config.ts` so nothing breaks mid-migration.
- Build shared UI primitives in `src/components/ui/`:
  `PageHeader` (exists — standardize), `StatCard`, `Card`/`SectionCard`, `Badge`, `DataTable` wrapper,
  reuse `EmptyState`. These make every page look consistent for free.
- Verify: tsc + lint (no page changes yet).

## Phase B — Unified `DashboardShell` + mobile bottom nav
- New `src/components/dashboard/DashboardShell.tsx`: light sidebar (desktop) + topbar.
- Admin's 21 links grouped into collapsible sections: **Overview · Catalog · Orders & Delivery ·
  Finance · People · System**. Store/Rider keep flat (few items).
- `src/components/dashboard/BottomNav.tsx`: 4–5 primary tabs (icon+label) + **More** sheet for the rest.
  Replaces the horizontal 21-pill scroll.
- Wire `(admin)`, `(store)`, `(rider)` layouts to the shared shell (keep each one's nav list + guards).
- Verify: tsc + lint + build.

## Phase C — Admin pages to the system
- Dashboard, Orders, Finance, Cash Collection, Bidding, Payouts, Stores, Products → `PageHeader`,
  `StatCard`, `Card`, `Badge`, `DataTable`. Consistent empty/loading states.

## Phase D — Store portal pages
- Dashboard, Finance/Earnings, Orders, Products, Payouts, Settings → same primitives.

## Phase E — Rider portal pages
- Dashboard, Delivery requests/Bids, Deliveries, Cash to Admin (remittances), Earnings, Profile → same.

## Phase F — Storefront alignment
- Header, Footer, product/store cards, home sections aligned to the unified tokens & spacing.
  (Already polished — light consistency pass, not a rebuild.)

## Phase G — Verify & report
- `npx tsc --noEmit` · `npx next lint` · `npx vitest run` · `npx next build` (if font-offline allows).
- Browser pane: screenshot public storefront + login at desktop and mobile widths.
- Honest report: what's verified vs. the Firebase-blocked logged-in views.

---

## Explicit non-goals
- No change to money/commission/remittance/bidding **logic** — UI only.
- No new features; this is a visual + navigation redesign.
- No commits/pushes unless you say so.
