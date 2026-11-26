/**
 * Pure helpers for the store and rider bidding screens (W13, W14): the store's
 * view of a list, the bid form (draft → request body, live totals, the same
 * checks as the API), API error codes → messages. No React, so vitest covers it.
 */
import type { Tone } from "@/lib/lists/ui";

export const MAX_UNIT_PRICE = 1_000_000;
export const MAX_RIDER_FEE = 10_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Link to a list in the store portal. Pass the store when known (e.g. the
 * fulfilment's store on an order) so an owner whose several stores got the same
 * list goes straight to the right one instead of "choose which store".
 */
export function storeListHref(listId: string, storeId?: string | null): string {
  const base = `/store-portal/lists/${encodeURIComponent(listId)}`;
  return storeId ? `${base}?storeId=${encodeURIComponent(storeId)}` : base;
}

export type StoreBidView = {
  id: string;
  orderId?: string;
  orderNumber?: string;
  status: "PENDING" | "ACCEPTED" | "NOT_SELECTED" | "WITHDRAWN" | "EXPIRED";
  /** Round the offer was made in. */
  round?: number;
  itemsTotal: number;
  discount: number;
  total: number;
  prepMinutes: number | null;
  note: string | null;
  coveredCount: number;
  needsUpdate: boolean;
  updatedAt: string;
  lines: { lineId: string; available: boolean; unitPrice: number | null }[];
};

export type StoreListRow = {
  listId: string;
  storeId: string;
  status: "BIDDING" | "ACCEPTED" | "CANCELLED" | "NO_STORES" | "EXPIRED";
  area: string | null;
  city: string;
  distanceKm: number | null;
  lineCount: number;
  expiresAt: string;
  /** Offer round (the list restarts when a round ends without an accept). */
  round?: number;
  /** End of the current round (same as expiresAt). */
  roundEndsAt?: string;
  sentAt: string;
  seen: boolean;
  declined: boolean;
  myBid: StoreBidView | null;
};

export type StoreListDetail = Omit<StoreListRow, "lineCount" | "sentAt" | "seen"> & {
  version: number;
  note: string | null;
  lines: { id: string; name: string; quantity: number; unit: string; category: string | null; note: string | null }[];
};

export type StoreListStateKey =
  | "NEW"
  | "OFFER_SENT"
  | "UPDATE_NEEDED"
  | "DECLINED"
  | "WITHDRAWN"
  | "WON"
  | "NOT_SELECTED"
  | "CLOSED";

/** Whether the list still takes offers (status and time). */
export function listOpen(l: { status: string; expiresAt: string }, now = Date.now()): boolean {
  return l.status === "BIDDING" && new Date(l.expiresAt).getTime() > now;
}

/** What this list means for the store right now. */
export function storeListState(
  l: {
    status: string;
    expiresAt: string;
    declined: boolean;
    round?: number;
    myBid: Pick<StoreBidView, "status" | "needsUpdate" | "orderNumber"> | null;
  },
  now = Date.now()
): { key: StoreListStateKey; label: string; tone: Tone; help: string } {
  const b = l.myBid;
  if (b?.status === "ACCEPTED") {
    return {
      key: "WON",
      label: "Customer accepted your offer",
      tone: "success",
      help: b.orderNumber ? `It is now order ${b.orderNumber}. Prepare it from Orders.` : "Prepare it from Orders.",
    };
  }
  if (b?.status === "NOT_SELECTED") {
    return { key: "NOT_SELECTED", label: "Not selected", tone: "neutral", help: "The customer chose another store's offer." };
  }
  if (!listOpen(l, now)) {
    const why =
      l.status === "CANCELLED"
        ? "The customer cancelled this list."
        : l.status === "ACCEPTED"
          ? "The customer chose another offer."
          : "Bidding time ran out.";
    return { key: "CLOSED", label: "Closed", tone: "neutral", help: why };
  }
  if (b?.status === "PENDING" && b.needsUpdate) {
    return {
      key: "UPDATE_NEEDED",
      label: "Update needed",
      tone: "warning",
      help: "The customer changed the list. Check every item and send your offer again.",
    };
  }
  if (b?.status === "PENDING") {
    return { key: "OFFER_SENT", label: "Offer sent", tone: "info", help: "You can change or withdraw it until the customer chooses." };
  }
  if (l.declined) return { key: "DECLINED", label: "Can't supply", tone: "neutral", help: "You said you can't supply this list." };
  if (b?.status === "WITHDRAWN") {
    return { key: "WITHDRAWN", label: "Offer withdrawn", tone: "neutral", help: "You can send a new offer while the list is open." };
  }
  if ((l.round ?? 1) > 1) {
    return {
      key: "NEW",
      label: "Needs your offer",
      tone: "brand",
      help: `The customer hasn't chosen yet, so the list restarted (round ${l.round}). Send a new offer, or say you can't supply.`,
    };
  }
  return { key: "NEW", label: "Needs your offer", tone: "brand", help: "Price what you have, or say you can't supply." };
}

/** Lists waiting for this store to act (nav badge): open, not declined, no live offer or offer out of date. */
export function storeListsNeedingAction(rows: StoreListRow[], now = Date.now()): number {
  return rows.filter((r) => {
    const k = storeListState(r, now).key;
    return k === "NEW" || k === "UPDATE_NEEDED" || k === "WITHDRAWN";
  }).length;
}

// ── Bid form ────────────────────────────────────────────────────────────────

export type BidDraftLine = { lineId: string; available: boolean; price: string };
export type BidDraft = { lines: BidDraftLine[]; discount: string; prepMinutes: string; note: string };
export type BidFieldErrors = { lines: Record<string, string>; discount?: string; prepMinutes?: string; note?: string; form?: string };

function num(s: string): number {
  const t = s.trim().replace(/,/g, "");
  return t === "" ? Number.NaN : Number(t);
}

/**
 * Draft for a list: from the store's current offer when it has one (lines that
 * still exist keep their answer), else every line "available" with no price.
 * `keep` carries over what the store typed before a reload (LIST_CHANGED).
 */
export function bidDraftFor(
  list: Pick<StoreListDetail, "lines" | "myBid">,
  keep?: BidDraft | null
): BidDraft {
  const typed = new Map((keep?.lines ?? []).map((l) => [l.lineId, l]));
  const offered = new Map((list.myBid && list.myBid.status !== "WITHDRAWN" ? list.myBid.lines : []).map((l) => [l.lineId, l]));
  return {
    lines: list.lines.map((l) => {
      const t = typed.get(l.id);
      if (t) return { ...t };
      const o = offered.get(l.id);
      if (o) return { lineId: l.id, available: o.available, price: o.unitPrice == null ? "" : String(o.unitPrice) };
      return { lineId: l.id, available: true, price: "" };
    }),
    discount: keep?.discount ?? (list.myBid && list.myBid.discount > 0 ? String(list.myBid.discount) : ""),
    prepMinutes: keep?.prepMinutes ?? (list.myBid?.prepMinutes != null ? String(list.myBid.prepMinutes) : ""),
    note: keep?.note ?? list.myBid?.note ?? "",
  };
}

/** Live totals while typing (half-typed prices count as 0). */
export function bidTotals(lines: { id: string; quantity: number }[], draft: BidDraft) {
  const qty = new Map(lines.map((l) => [l.id, l.quantity]));
  let itemsTotal = 0;
  let covered = 0;
  const lineTotals: Record<string, number | null> = {};
  for (const d of draft.lines) {
    if (!d.available) {
      lineTotals[d.lineId] = null;
      continue;
    }
    covered++;
    const p = num(d.price);
    const t = Number.isFinite(p) && p > 0 ? round2(round2(p) * (qty.get(d.lineId) ?? 0)) : 0;
    lineTotals[d.lineId] = t;
    itemsTotal += t;
  }
  itemsTotal = round2(itemsTotal);
  const d = num(draft.discount);
  const discount = Number.isFinite(d) && d > 0 ? round2(d) : 0;
  return { itemsTotal, discount, total: round2(Math.max(0, itemsTotal - discount)), covered, lineCount: lines.length, lineTotals };
}

export type BidPayload = {
  storeId?: string;
  listVersion: number;
  lines: { lineId: string; available: boolean; unitPrice?: number }[];
  discount: number;
  prepMinutes: number | null;
  note: string | null;
};

/** Same rules as bidSchema + submitBid in store-bids.ts; returns the body or per-field errors. */
export function validateBidDraft(
  list: Pick<StoreListDetail, "lines" | "version" | "storeId">,
  draft: BidDraft
): { payload: BidPayload | null; errors: BidFieldErrors } {
  const errors: BidFieldErrors = { lines: {} };
  const byId = new Map(draft.lines.map((l) => [l.lineId, l]));
  const out: BidPayload["lines"] = [];
  for (const line of list.lines) {
    const d = byId.get(line.id) ?? { lineId: line.id, available: true, price: "" };
    if (!d.available) {
      out.push({ lineId: line.id, available: false });
      continue;
    }
    const p = num(d.price);
    if (!Number.isFinite(p) || p <= 0) errors.lines[line.id] = `Enter a price for ${line.name}, or mark it "Don't have".`;
    else if (p > MAX_UNIT_PRICE) errors.lines[line.id] = `The price for ${line.name} is too high.`;
    out.push({ lineId: line.id, available: true, unitPrice: round2(p) });
  }
  const totals = bidTotals(list.lines, draft);
  if (totals.covered === 0) errors.form = "You don't have any of these items. Use \"Can't supply\" instead.";

  let discount = 0;
  if (draft.discount.trim()) {
    const d = num(draft.discount);
    if (!Number.isFinite(d) || d < 0) errors.discount = "Discount can't be negative";
    else if (totals.covered > 0 && !Object.keys(errors.lines).length && round2(d) >= totals.itemsTotal) {
      errors.discount = "The discount must be less than the total.";
    } else discount = round2(d);
  }
  let prepMinutes: number | null = null;
  if (draft.prepMinutes.trim()) {
    const m = num(draft.prepMinutes);
    if (!Number.isInteger(m)) errors.prepMinutes = "Preparation time must be whole minutes";
    else if (m < 5) errors.prepMinutes = "Preparation time must be at least 5 minutes";
    else if (m > 24 * 60) errors.prepMinutes = "Preparation time must be under 24 hours";
    else prepMinutes = m;
  }
  const note = draft.note.trim();
  if (note.length > 300) errors.note = "Note must be 300 characters or fewer";

  const bad = Object.keys(errors.lines).length || errors.form || errors.discount || errors.prepMinutes || errors.note;
  if (bad) return { payload: null, errors };
  return {
    payload: { storeId: list.storeId, listVersion: list.version, lines: out, discount, prepMinutes, note: note || null },
    errors,
  };
}

/** Put a server error (`fieldErrors` key like "lines.2.unitPrice") on the right input. */
export function applyServerBidError(
  lines: { id: string }[],
  field: string | null | undefined,
  message: string
): BidFieldErrors {
  const errors: BidFieldErrors = { lines: {} };
  const m = field ? /^lines\.(\d+)/.exec(field) : null;
  if (m && lines[Number(m[1])]) errors.lines[lines[Number(m[1])].id] = message;
  else if (field === "discount") errors.discount = message;
  else if (field === "prepMinutes") errors.prepMinutes = message;
  else if (field === "note") errors.note = message;
  else errors.form = message;
  return errors;
}

/** What the bid screen does after a failed store request. reload = fetch the list again. */
export function storeBidErrorMessage(f: { status: number; code?: string | null; error?: string | null } | null): {
  message: string;
  reload: boolean;
} {
  if (!f) return { message: "We couldn't reach MandiBazaar. Check your connection and try again.", reload: false };
  switch (f.code) {
    case "LIST_CHANGED":
      return {
        message: "The customer changed this list. We loaded the new version and kept your prices. Check every item and send again.",
        reload: true,
      };
    case "LIST_CLOSED":
      return { message: "This list is closed. The customer already chose an offer or cancelled it.", reload: true };
    case "STORE_NOT_ACTIVE":
      return { message: "Your store can't make offers right now. Contact MandiBazaar support.", reload: false };
    case "NOTHING_AVAILABLE":
      return { message: f.error || "You don't have any of these items. Use \"Can't supply\" instead.", reload: false };
    case "HAS_OFFER":
      return { message: "Withdraw your offer first, then you can say you can't supply.", reload: true };
    case "NO_OFFER":
      return { message: "You have no open offer on this list.", reload: true };
    case "NOT_FOUND":
      return { message: "This list wasn't sent to your store.", reload: false };
    case "STORE_REQUIRED":
      return { message: "Choose which of your stores this offer is for.", reload: false };
  }
  if (f.status === 401) return { message: "Your session ended. Please sign in again.", reload: false };
  if (f.status === 429) return { message: "Too many tries. Please wait a minute and try again.", reload: false };
  if (f.status >= 500) return { message: "Something went wrong on our side. Please try again in a moment.", reload: false };
  return { message: f.error || "Couldn't save your offer. Please try again.", reload: false };
}

// ── Rider bids ──────────────────────────────────────────────────────────────

/** Check a rider's fee before sending (the API rounds to whole rupees, 1 … 10,000). */
export function validateRiderFee(raw: string): { amount: number | null; error: string | null } {
  const n = num(raw);
  if (!Number.isFinite(n) || n <= 0) return { amount: null, error: "Enter your delivery fee in rupees." };
  if (n > MAX_RIDER_FEE) return { amount: null, error: "Delivery fee can't be more than Rs 10,000." };
  return { amount: Math.round(n), error: null };
}

export function riderBidErrorMessage(f: { status: number; code?: string | null; error?: string | null } | null): {
  message: string;
  reload: boolean;
} {
  if (!f) return { message: "We couldn't reach MandiBazaar. Check your connection and try again.", reload: false };
  switch (f.code) {
    case "TOO_FAR":
      return { message: "This pickup is too far from where you are now. Move closer or share your location again.", reload: true };
    case "INELIGIBLE":
      return { message: f.error || "You can't bid right now.", reload: true };
    case "EXPIRED":
      return { message: "Bidding on this delivery has closed.", reload: true };
    case "CLOSED":
      return { message: "The customer has already chosen a rider, or this delivery is closed.", reload: true };
    case "NO_BID":
      return { message: "You have no open bid on this delivery.", reload: true };
    case "BAD_AMOUNT":
      return { message: f.error || "Enter a valid delivery fee.", reload: false };
    case "NOT_FOUND":
      return { message: "This delivery request is no longer available.", reload: true };
  }
  if (f.status === 429) return { message: "Please slow down a little and try again.", reload: false };
  if (f.status >= 500) return { message: "Something went wrong on our side. Please try again in a moment.", reload: false };
  return { message: f.error || "Couldn't save your bid. Please try again.", reload: false };
}

/** Admin "Needs rider" wording for a post-pack request row. */
export function postPackStateLabel(r: { status: string; biddingOpen?: boolean; pendingBids?: number }): { label: string; tone: Tone } {
  if (r.status === "NO_BIDS") return { label: "Needs rider", tone: "danger" };
  if (r.status === "OPEN" && r.biddingOpen) return { label: "Riders bidding", tone: "info" };
  if (r.status === "OPEN" && (r.pendingBids ?? 0) > 0) return { label: "Waiting for customer", tone: "warning" };
  if (r.status === "OPEN") return { label: "Bidding closed", tone: "warning" };
  if (r.status === "ASSIGNED") return { label: "Rider chosen", tone: "success" };
  return { label: r.status.replace(/_/g, " ").toLowerCase(), tone: "neutral" };
}

/** Store orders: the rider stage of an item-list order. */
export function storeRiderStage(o: {
  isListOrder?: boolean;
  orderStatus: string;
  rider?: { name: string } | null;
  postPackRequest?: { status: string; expiresAt: string } | null;
}): { label: string; tone: Tone; expiresAt?: string } | null {
  if (!o.isListOrder) return null;
  if (o.rider && ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"].includes(o.orderStatus)) {
    return { label: o.orderStatus === "OUT_FOR_DELIVERY" ? `${o.rider.name} is delivering` : `Rider assigned: ${o.rider.name}`, tone: "success" };
  }
  if (o.orderStatus !== "READY_FOR_DISPATCH") return null;
  const r = o.postPackRequest;
  if (!r) return { label: "Waiting for rider bidding", tone: "info" };
  if (r.status === "OPEN") {
    return new Date(r.expiresAt).getTime() > Date.now()
      ? { label: "Riders are bidding", tone: "info", expiresAt: r.expiresAt }
      : { label: "Customer is choosing a rider", tone: "info" };
  }
  if (r.status === "NO_BIDS") return { label: "No rider bids. MandiBazaar will assign one", tone: "warning" };
  if (r.status === "ASSIGNED") return { label: "Rider chosen", tone: "success" };
  return null;
}
