/**
 * Pure helpers for the customer's item-list screens (W12): draft lines, error
 * messages for every API code, countdowns and status labels. No React here so
 * vitest can cover it directly.
 */
import { listLineSchema, MAX_LIST_LINES } from "@/lib/lists/validation";

export const COMMON_UNITS = ["kg", "g", "L", "ml", "pcs", "dozen", "pack", "bag", "bottle", "box"] as const;

/** One line while the customer is typing (strings, so half-typed numbers stay as typed). */
export type DraftLine = {
  /** Stable React key. */
  key: string;
  /** Existing line id (editing a list that was already sent). */
  id?: string;
  name: string;
  quantity: string;
  unit: string;
  categoryId: string;
  productId?: string | null;
  note: string;
};

export type LineErrors = Partial<Record<"name" | "quantity" | "unit" | "note" | "categoryId", string>>;

let keySeq = 0;
export function draftKey(): string {
  keySeq += 1;
  return `l${Date.now().toString(36)}${keySeq}`;
}

export function emptyLine(): DraftLine {
  return { key: draftKey(), name: "", quantity: "1", unit: "kg", categoryId: "", note: "" };
}

/** Lines from the cart: catalog products keep their productId (test case B-06). */
export function linesFromCart(
  items: { productId?: string | null; name: string; variantName?: string | null; quantity: number; unit: string }[]
): DraftLine[] {
  return items.map((i) => ({
    key: draftKey(),
    name: (i.variantName ? `${i.name} (${i.variantName})` : i.name).slice(0, 100),
    quantity: String(i.quantity),
    unit: (i.unit || "pcs").slice(0, 20),
    categoryId: "",
    productId: i.productId || null,
    note: "",
  }));
}

/** Lines of a saved list, ready to edit. */
export function linesFromList(
  lines: { id: string; name: string; quantity: number; unit: string; categoryId: string | null; productId: string | null; note: string | null }[]
): DraftLine[] {
  return lines.map((l) => ({
    key: draftKey(),
    id: l.id,
    name: l.name,
    quantity: String(l.quantity),
    unit: l.unit,
    categoryId: l.categoryId || "",
    productId: l.productId,
    note: l.note || "",
  }));
}

/** A line the customer left completely empty is ignored rather than reported. */
export function isBlankLine(l: DraftLine): boolean {
  return !l.name.trim() && !l.note.trim() && !l.productId;
}

export type LinePayload = {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  categoryId?: string | null;
  productId?: string | null;
  note?: string | null;
};

/**
 * Check the draft with the same rules as the API (validation.ts) and build the
 * request body. Errors are keyed by the draft line's `key`.
 */
export function validateDraft(lines: DraftLine[]): {
  payload: LinePayload[];
  errors: Record<string, LineErrors>;
  formError: string | null;
} {
  const errors: Record<string, LineErrors> = {};
  const payload: LinePayload[] = [];
  const used = lines.filter((l) => !isBlankLine(l));
  if (!used.length) return { payload, errors, formError: "Add at least one item" };
  if (used.length > MAX_LIST_LINES) {
    return { payload, errors, formError: `A list can have at most ${MAX_LIST_LINES} items` };
  }
  for (const l of used) {
    const qtyText = l.quantity.trim().replace(",", ".");
    const raw = {
      ...(l.id ? { id: l.id } : {}),
      name: l.name,
      quantity: qtyText === "" ? Number.NaN : Number(qtyText),
      unit: l.unit,
      categoryId: l.categoryId || null,
      productId: l.productId || null,
      note: l.note,
    };
    const r = listLineSchema.safeParse(raw);
    if (!r.success) {
      const e: LineErrors = {};
      for (const issue of r.error.issues) {
        const f = String(issue.path[0] ?? "name") as keyof LineErrors;
        if (!e[f]) e[f] = issue.message;
      }
      errors[l.key] = e;
      continue;
    }
    payload.push({
      ...(r.data.id ? { id: r.data.id } : {}),
      name: r.data.name,
      quantity: r.data.quantity,
      unit: r.data.unit,
      categoryId: r.data.categoryId ?? null,
      productId: r.data.productId ?? null,
      note: r.data.note ?? null,
    });
  }
  return { payload, errors, formError: null };
}

/**
 * Map an API field path like "lines.2.quantity" back onto the draft line it
 * came from (blank lines are not sent, so indexes skip them).
 */
export function mapServerFieldError(
  lines: DraftLine[],
  field: string,
  message: string
): { lineKey: string; field: keyof LineErrors } | null {
  const m = /^lines\.(\d+)\.(\w+)$/.exec(field);
  if (!m) return null;
  const sent = lines.filter((l) => !isBlankLine(l));
  const line = sent[Number(m[1])];
  if (!line || !message) return null;
  return { lineKey: line.key, field: m[2] as keyof LineErrors };
}

export function newIdempotencyKey(prefix = "web"): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const id = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${id}`;
}

/** "2h 05m left", "4m 09s left", "Ended". */
export function formatCountdown(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "Ended";
  const s = Math.floor(msLeft / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m left`;
  return `${m}m ${String(sec).padStart(2, "0")}s left`;
}

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export function listStatusInfo(status: string): { label: string; tone: Tone; help: string } {
  switch (status) {
    case "BIDDING":
      return { label: "Waiting for offers", tone: "info", help: "Nearby stores are looking at your list." };
    case "ACCEPTED":
      return { label: "Order placed", tone: "success", help: "You accepted an offer. Your order is on its way." };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral", help: "You cancelled this list." };
    case "NO_STORES":
      return {
        label: "No stores nearby",
        tone: "danger",
        help: "No store near your address sells these items yet. Try again later or shop the catalogue.",
      };
    case "EXPIRED":
      return { label: "Expired", tone: "warning", help: "Bidding time ran out before you accepted an offer." };
    default:
      return { label: status.replace(/_/g, " ").toLowerCase(), tone: "neutral", help: "" };
  }
}

export type ApiFailure = { status: number; code?: string | null; error?: string | null };

/** What the screen should do after a failed accept. */
export type AcceptFailure = { message: string; reload: boolean; keepKey: boolean };

/** Every error from POST /api/lists/[id]/accept → a clear message (and whether to refresh offers). */
export function acceptOfferErrorMessage(f: ApiFailure | null): AcceptFailure {
  if (!f) {
    return {
      message: "We couldn't reach MandiBazaar. Check your connection and try again. You won't be charged twice.",
      reload: false,
      keepKey: true,
    };
  }
  switch (f.code) {
    case "ORDER_PLACED":
      return { message: "You already accepted an offer on this list. Opening your order…", reload: true, keepKey: false };
    case "LIST_CLOSED":
      return { message: "This list is closed, so offers can't be accepted any more.", reload: true, keepKey: false };
    case "LIST_CHANGED":
      return { message: "Your list changed since you opened this offer. Please check the offers again.", reload: true, keepKey: false };
    case "OFFER_NOT_FOUND":
    case "OFFER_UNAVAILABLE":
      return { message: "This offer is no longer available. Please choose another offer.", reload: true, keepKey: false };
    case "OFFER_OUTDATED":
      return {
        message: "This store is updating its offer for your changed list. Please wait a moment or choose another offer.",
        reload: true,
        keepKey: false,
      };
    case "OFFER_CHANGED":
      return { message: "The store just changed this offer. Check the new total and accept again.", reload: true, keepKey: false };
    case "STORE_UNAVAILABLE":
      return { message: "This store can't take orders right now. Please choose another offer.", reload: true, keepKey: false };
    case "MIN_ORDER":
      return { message: f.error || "This offer is below the minimum order amount.", reload: false, keepKey: false };
    case "ADDRESS_NOT_FOUND":
      return { message: "Choose one of your saved delivery addresses.", reload: false, keepKey: true };
    case "FEATURE_OFF":
      return { message: "Sending a list to stores isn't available right now.", reload: false, keepKey: false };
    case "NOT_FOUND":
      return { message: "We couldn't find this list.", reload: false, keepKey: false };
  }
  if (f.status === 401) return { message: "Your session ended. Please sign in again.", reload: false, keepKey: true };
  if (f.status === 429) return { message: "Too many tries. Please wait a minute and try again.", reload: false, keepKey: true };
  if (f.status >= 500) {
    return { message: "Something went wrong on our side. Please try again in a moment.", reload: false, keepKey: true };
  }
  return { message: f.error || "Couldn't accept this offer. Please try again.", reload: f.status === 409, keepKey: false };
}

/** Every error from POST /api/orders/[n]/rider-bids/[bidId]/accept → a clear message. */
export function acceptRiderErrorMessage(f: ApiFailure | null): AcceptFailure {
  if (!f) {
    return {
      message: "We couldn't reach MandiBazaar. Check your connection and try again.",
      reload: false,
      keepKey: true,
    };
  }
  switch (f.code) {
    case "ALREADY_ASSIGNED":
      return { message: "You've already chosen a rider for this order.", reload: true, keepKey: false };
    case "BID_NOT_FOUND":
    case "BID_UNAVAILABLE":
      return { message: "That rider's bid is no longer available. Please choose another rider.", reload: true, keepKey: false };
    case "BID_CHANGED":
      return { message: "The rider just changed their fee. Check the new amount and choose again.", reload: true, keepKey: false };
    case "RIDER_GONE":
      return { message: "That rider just became unavailable. Please choose another rider.", reload: true, keepKey: false };
    case "CLOSED":
      return { message: "Rider bidding on this order has closed.", reload: true, keepKey: false };
    case "NOT_READY":
      return { message: "Riders can bid once the store has packed your order.", reload: true, keepKey: false };
    case "ORDER_CHANGED":
      return { message: "This order can't take a rider right now. Please refresh and check its status.", reload: true, keepKey: false };
    case "NOT_FOUND":
      return { message: "We couldn't find this order.", reload: false, keepKey: false };
  }
  if (f.status === 401) return { message: "Your session ended. Please sign in again.", reload: false, keepKey: true };
  if (f.status === 429) return { message: "Too many tries. Please wait a minute and try again.", reload: false, keepKey: true };
  if (f.status >= 500) {
    return { message: "Something went wrong on our side. Please try again in a moment.", reload: false, keepKey: true };
  }
  return { message: f.error || "Couldn't choose this rider. Please try again.", reload: f.status === 409, keepKey: false };
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function vehicleLabel(v: string | null | undefined): string {
  if (!v) return "Vehicle not given";
  const s = v.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
