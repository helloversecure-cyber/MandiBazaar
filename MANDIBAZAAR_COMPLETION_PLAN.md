# MandiBazaar — Completion Plan (remaining gaps)

**Rule for every phase:** local only — no commit, no push, no deploy, no real money. Decimal money, backend validation, transactions, idempotency. Each phase ends with `tsc` + `lint` + `vitest` + a DB integration test, and (when the dev server is warm) a browser click-through. Nothing left half-wired.

**Status today:** Rider bidding, 5% commission, append-only ledger + transaction-safe payouts, 3-role finance dashboards, and the **COD remittance lifecycle** (48h deadline, partial, overdue-sweep → auto-restriction → settle → clear), the **rider remittance UI**, and the **Super Admin Cash Control Center** are built and verified (tsc/lint/unit + DB integration). The items below are what remains.

---

## Phase 1 — Store settlement gated on COD reconciliation  `P0 correctness`
**Gap:** `computePayoutDrafts` settles every DELIVERED order even if the rider hasn't remitted that order's COD cash yet (spec §8: never settle on an unverified COD collection).

- In `src/lib/orders/payouts.ts` `computePayoutDrafts`: for a COD order, include it in a store payout **only when** its `CashRemittance.status === "RECEIVED"` (cash verified). Online-paid orders settle as today.
- Add a helper `isOrderCodReconciled(order)` and a per-order flag so the UI can show *why* an order is held.
- Surface "Awaiting COD reconciliation" as a held reason on the store finance breakdown + admin payouts.
- **Verify:** unit test — a DELIVERED COD order with unremitted cash is NOT in a payout draft; after the remittance is RECEIVED it becomes eligible; online orders unaffected. DB integration for the full path.

## Phase 2 — Unify the remittance confirm path  `P0 consistency`
**Gap:** legacy `RECEIVE_REMITTANCE` (admin/payouts route) sets status RECEIVED directly, bypassing submissions / `amountRemitted` / recompute / restriction-clear — inconsistent with the new Cash Control Center.

- Repoint the legacy action to the new service (`recomputeRemittance` / a one-shot "mark fully received" that records an ADJUSTMENT submission), OR remove the legacy button and point admins to `/admin/cash-collection`.
- Keep one authoritative path so partial tracking and restriction-clear always run.
- **Verify:** integration — confirming via either entry point yields the same ledger/restriction state; no double-count.

## Phase 3 — Rider dashboard COD tiles  `P1`
**Gap:** `pendingRemittanceAmount` sums `amount` (total collected) and only PENDING/SUBMITTED; should show real outstanding.

- In `src/app/api/rider/route.ts` dashboard: use `outstanding(amountDue, amountRemitted)` across all non-RECEIVED statuses; add separate figures: **delivery earnings**, **cash collected**, **cash retained**, **owed to MandiBazaar**, **overdue** (spec §9 — these must never be mixed).
- Rider dashboard UI: a clear "Cash to remit" tile with overdue emphasis + link to `/rider-portal/remittances`.
- **Verify:** integration asserting the five figures are distinct and correct for a mixed COD/online set.

## Phase 4 — Refund / cancel ↔ COD obligation  `P1 edge case`
**Gap:** refund/cancel doesn't adjust the rider's remittance obligation (spec §6F: never erase an overdue obligation on refund — apply an authorized reversal/adjustment).

- On refund/cancel of a COD order with a remittance: create an **authorized adjustment** (reversing `RemittanceSubmission`/ledger row) rather than deleting; recompute; re-evaluate restriction.
- Decide + document the rule: customer refund after COD collection reduces what the rider owes the platform only by an authorized adjustment, never silently.
- **Verify:** integration — refund on a partially-remitted COD order leaves a correct, auditable balance; overdue isn't silently cleared.

## Phase 5 — Remittance notifications  `P1`  (spec §14)
**Gap:** no notifications for remittance events (the notification system exists in `src/lib/notifications/`).

- Rider: deadline approaching, submitted, approved, rejected, overdue, restricted, reinstated.
- Super Admin: new COD collection, new submission, handover awaiting confirmation, overdue rider.
- Fire from the backend choke points + the cron sweep (not browser timers). Email is a config blocker (provider) → in-app notifications now, email when configured.
- **Verify:** integration asserting rows are created on each transition; no duplicates on re-run.

## Phase 6 — Super Admin settings for remittance  `P1`  (unblocks config)
- Settings UI for `remittanceDeadlineHours`, `remittanceMethods`, `cashHandoverInstructions`.
- Documents the supervisor gate (`REMITTANCES_WRITE`); leave real bank details / OTP as the operator's to fill (no invented credentials).
- **Verify:** changing the deadline/methods reflects in the rider remittance screen.

## Phase 7 — Admin rider-bidding oversight view  `P2`
**Gap (older):** Super Admin can't see/cancel live delivery auctions.
- Read view of open `DeliveryRequest`s + bids, with cancel/intervene; reuse `cancelRequest`.
- **Verify:** admin cancel releases the request; customer sees it ended.

## Phase 8 — Live UI verification pass  `P1`
- Warm the dev server (clean `.next`, cold compile once), then click-through: customer COD order → deliver → rider collects → remittance (handover + digital, partial) → admin verify/confirm → store settlement unlocks. Capture the QA evidence (spec Scenarios A–H) through the UI, not just unit/DB.

## Phase 9 — Website redesign  `P2`  (spec §11, large)
- Role-by-role premium redesign (customer storefront, store dashboard, rider mobile-first, admin ops) on the existing brand/logo. Separate milestone; do after P0/P1 correctness.

---

### Config blockers to report (not invent)
- Real MandiBazaar bank / JazzCash remittance account details.
- Supervisor identity + OTP mechanism for physical cash handover (currently permission-gated).
- `CRON_SECRET` (sweep) and an email provider (notifications) for production.

### Suggested order
P1 → P2 → P3 → P4 → P5 → P6 → P8 (verify) → P7 → P9.
P1 and P2 are the real correctness/consistency risks and should go first.
