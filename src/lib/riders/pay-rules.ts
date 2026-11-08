/**
 * Rider pay model (owner decision 7) — pure rules, safe on client and server.
 *
 * Pay for one delivered order = riderBaseFee + riderPerKmFee × Order.deliveryDistanceKm
 * (no distance → base only), rounded to whole rupees, never negative.
 * The fee is fixed on the Delivery row when the order is delivered; later settings
 * changes do not alter it. Failed / returned deliveries earn nothing (owner may
 * change this later). Older delivered orders that never got a fee are priced with
 * the current settings when listed, and the fee is saved when they are paid out.
 */

export type RiderPaySettings = { baseFee: number; perKmFee: number };

export const DEFAULT_RIDER_PAY: RiderPaySettings = { baseFee: 50, perKmFee: 0 };

/** Hard cap on deliveries in one payout (keeps the transaction small). */
export const MAX_DELIVERIES_PER_PAYOUT = 500;

export const RIDER_PAYOUT_METHODS = ["BANK_TRANSFER", "JAZZCASH", "CASH", "OTHER"] as const;
export type RiderPayoutMethod = (typeof RIDER_PAYOUT_METHODS)[number];
export const RIDER_PAYOUT_METHOD_LABELS: Record<RiderPayoutMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  JAZZCASH: "JazzCash",
  CASH: "Cash in hand",
  OTHER: "Other",
};

function finiteNonNeg(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whole rupees, rounded half up (Rs 78.5 → Rs 79), never negative. */
export function computeRiderFee(settings: RiderPaySettings, distanceKm: number | null | undefined): number {
  const base = finiteNonNeg(settings.baseFee);
  const perKm = finiteNonNeg(settings.perKmFee);
  const km = finiteNonNeg(distanceKm);
  // Round to 2 dp first so float noise (e.g. 78.49999999) can't flip the rupee.
  const raw = Math.round((base + perKm * km) * 100) / 100;
  return Math.max(0, Math.round(raw));
}

function rs(n: number): string {
  return `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

/** One line for riders and admins: "Rs 50 per delivery + Rs 10 per km". */
export function describeRiderPayRule(s: RiderPaySettings): string {
  const base = finiteNonNeg(s.baseFee);
  const perKm = finiteNonNeg(s.perKmFee);
  if (!perKm) return `${rs(base)} per delivery`;
  return `${rs(base)} per delivery + ${rs(perKm)} per km`;
}

/** Stored fee if fixed at delivery, else priced with the current settings. */
export function effectiveRiderFee(
  row: { riderFee: number | null; distanceKm: number | null },
  settings: RiderPaySettings
): number {
  if (row.riderFee != null && Number.isFinite(row.riderFee)) return Math.max(0, row.riderFee);
  return computeRiderFee(settings, row.distanceKm);
}

// ---------------------------------------------------------------------------
// Earnings aggregation
// ---------------------------------------------------------------------------

export type EarningRow = {
  orderId: string;
  orderNumber: string;
  deliveredAt: Date | string | null;
  distanceKm: number | null;
  /** null = not fixed yet (older order) */
  riderFee: number | null;
  riderPayoutId: string | null;
};

export type EarningPeriod = { key: string; label: string; since?: Date };

export type EarningsSummary = {
  periods: { key: string; label: string; deliveries: number; earned: number }[];
  unpaid: { count: number; amount: number };
  paid: { count: number; amount: number };
};

/** Totals per period (by delivery time) + unpaid / paid balance. */
export function summarizeRiderEarnings(
  rows: EarningRow[],
  periods: EarningPeriod[],
  settings: RiderPaySettings
): EarningsSummary {
  const out = periods.map((p) => ({ key: p.key, label: p.label, deliveries: 0, earned: 0 }));
  const unpaid = { count: 0, amount: 0 };
  const paid = { count: 0, amount: 0 };
  for (const r of rows) {
    const fee = effectiveRiderFee(r, settings);
    const at = r.deliveredAt ? new Date(r.deliveredAt).getTime() : NaN;
    periods.forEach((p, i) => {
      if (!p.since || (Number.isFinite(at) && at >= p.since.getTime())) {
        out[i].deliveries += 1;
        out[i].earned += fee;
      }
    });
    const bucket = r.riderPayoutId ? paid : unpaid;
    bucket.count += 1;
    bucket.amount += fee;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    periods: out.map((p) => ({ ...p, earned: r2(p.earned) })),
    unpaid: { count: unpaid.count, amount: r2(unpaid.amount) },
    paid: { count: paid.count, amount: r2(paid.amount) },
  };
}

// ---------------------------------------------------------------------------
// Payout selection / double-pay guard
// ---------------------------------------------------------------------------

export type PayoutCandidate = {
  orderId: string;
  /** order belongs to this rider and is DELIVERED */
  eligible: boolean;
  riderPayoutId: string | null;
  riderFee: number | null;
  distanceKm: number | null;
};

export type PayoutCheck =
  | { ok: true; orderIds: string[]; amount: number; count: number; fees: Record<string, number> }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Checks that the deliveries the admin confirmed are exactly what will be paid:
 * every id is an eligible, still-unpaid delivery of this rider and the total
 * matches the confirmed amount. Anything else → 409 (reload and confirm again).
 */
export function checkPayoutSelection(
  requestedIds: string[],
  expected: { amount: number; count: number },
  candidates: PayoutCandidate[],
  settings: RiderPaySettings
): PayoutCheck {
  const ids = Array.from(new Set(requestedIds.filter((x) => typeof x === "string" && x)));
  if (!ids.length) return { ok: false, status: 400, error: "No deliveries selected to pay" };
  if (ids.length !== requestedIds.length) {
    return { ok: false, status: 400, error: "The same delivery was listed twice" };
  }
  if (ids.length > MAX_DELIVERIES_PER_PAYOUT) {
    return { ok: false, status: 400, error: `Pay at most ${MAX_DELIVERIES_PER_PAYOUT} deliveries at a time` };
  }
  const byId = new Map(candidates.map((c) => [c.orderId, c]));
  const fees: Record<string, number> = {};
  let amount = 0;
  for (const id of ids) {
    const c = byId.get(id);
    if (!c || !c.eligible) {
      return { ok: false, status: 409, error: "A delivery in this payout is no longer payable — reload and try again" };
    }
    if (c.riderPayoutId) {
      return { ok: false, status: 409, error: "Some of these deliveries were already paid — reload and try again" };
    }
    const fee = effectiveRiderFee(c, settings);
    fees[id] = fee;
    amount += fee;
  }
  amount = Math.round(amount * 100) / 100;
  if (ids.length !== expected.count || Math.abs(amount - expected.amount) > 0.005) {
    return {
      ok: false,
      status: 409,
      error: `The unpaid total changed (now ${ids.length} deliveries, Rs ${amount}) — reload and confirm again`,
    };
  }
  return { ok: true, orderIds: ids, amount, count: ids.length, fees };
}

/** "JazzCash ****4567" / "Bank Meezan ****6702 (Ali)" / "No payout account". */
export function maskRiderPayoutAccount(r: {
  accountNumber?: string | null;
  accountTitle?: string | null;
  bankName?: string | null;
  jazzCashNumber?: string | null;
}): string {
  const mask = (v: string) => {
    const c = v.replace(/[\s-]/g, "");
    return c.length > 4 ? `****${c.slice(-4)}` : `****${c}`;
  };
  const parts: string[] = [];
  if (r.accountNumber?.trim()) {
    parts.push(
      `Bank ${r.bankName?.trim() || ""} ${mask(r.accountNumber.trim())}${r.accountTitle ? ` (${r.accountTitle})` : ""}`
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  if (r.jazzCashNumber?.trim()) parts.push(`JazzCash ${mask(r.jazzCashNumber.trim())}`);
  return parts.length ? parts.join(" · ") : "No payout account";
}

/** Reference rules: required (4–80 chars) for bank / JazzCash transfers. */
export function payoutFieldErrors(input: { method?: unknown; reference?: unknown; notes?: unknown }) {
  const errors: Record<string, string> = {};
  const method = String(input.method || "");
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (!(RIDER_PAYOUT_METHODS as readonly string[]).includes(method)) {
    errors.method = "Choose how you paid the rider";
  }
  if ((method === "BANK_TRANSFER" || method === "JAZZCASH") && reference.length < 4) {
    errors.reference = "Enter the transfer reference / transaction ID (at least 4 characters)";
  }
  if (reference.length > 80) errors.reference = "Reference can be at most 80 characters";
  if (reference && /[<>]/.test(reference)) errors.reference = "Reference can't contain < or >";
  if (notes.length > 500) errors.notes = "Notes can be at most 500 characters";
  return {
    errors,
    value: { method: method as RiderPayoutMethod, reference: reference || null, notes: notes || null },
  };
}
