/**
 * N9 (admin side): store edits to an approved product wait in
 * `Product.pendingChanges` until an admin approves them. Pure helpers to show
 * old → new and to turn the pending payload into a safe product update.
 *
 * Contract (written by the store portal):
 *   { name?, categoryId?, unit?, description?, shortDescription?, price?, salePrice?,
 *     images?: { url: string; sortOrder: number }[], submittedById: string, submittedAt: ISO }
 */

export const PENDING_CHANGE_FIELDS = [
  "name",
  "price",
  "salePrice",
  "categoryId",
  "unit",
  "shortDescription",
  "description",
  "images",
] as const;
export type PendingChangeField = (typeof PENDING_CHANGE_FIELDS)[number];

export const PENDING_CHANGE_LABELS: Record<PendingChangeField, string> = {
  name: "Name",
  price: "Price",
  salePrice: "Deal price",
  categoryId: "Category",
  unit: "Unit",
  shortDescription: "Short description",
  description: "Description",
  images: "Photos",
};

export type PendingChanges = {
  name?: string;
  categoryId?: string;
  unit?: string;
  description?: string | null;
  shortDescription?: string | null;
  price?: number | string;
  salePrice?: number | string | null;
  images?: { url: string; sortOrder?: number }[];
  submittedById?: string;
  submittedAt?: string;
};

export type LiveProductForDiff = {
  name: string;
  categoryId: string;
  unit: string;
  description?: string | null;
  shortDescription?: string | null;
  price: number;
  salePrice?: number | null;
  images?: { url: string; sortOrder?: number }[];
};

export type ChangeRow = {
  field: PendingChangeField;
  label: string;
  /** Text values; for images a list of URLs. */
  from: string | number | null | string[];
  to: string | number | null | string[];
};

/** Narrow an unknown JSON value to PendingChanges (null when empty/invalid). */
export function asPendingChanges(raw: unknown): PendingChanges | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const hasAny = PENDING_CHANGE_FIELDS.some((f) => obj[f] !== undefined);
  return hasAny ? (obj as PendingChanges) : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function sortedUrls(list: { url: string; sortOrder?: number }[] | undefined): string[] {
  return (list || [])
    .filter((i) => i && typeof i.url === "string" && i.url.trim())
    .map((i, idx) => ({ url: i.url.trim(), s: typeof i.sortOrder === "number" ? i.sortOrder : idx }))
    .sort((a, b) => a.s - b.s)
    .map((i) => i.url);
}

/** Rows for the admin old → new table (only fields that really differ). */
export function describePendingChanges(
  live: LiveProductForDiff,
  pending: PendingChanges,
  categoryName: (id: string) => string = (id) => id
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const field of PENDING_CHANGE_FIELDS) {
    if (pending[field] === undefined) continue;
    let from: ChangeRow["from"];
    let to: ChangeRow["to"];
    if (field === "images") {
      from = sortedUrls(live.images);
      to = sortedUrls(pending.images);
      if (from.join("\n") === to.join("\n")) continue;
    } else if (field === "price" || field === "salePrice") {
      from = toNum(live[field]);
      to = toNum(pending[field]);
      if (from === to) continue;
    } else if (field === "categoryId") {
      if (live.categoryId === pending.categoryId) continue;
      from = categoryName(live.categoryId);
      to = categoryName(String(pending.categoryId));
    } else {
      from = (live[field] as string | null | undefined) ?? null;
      to = (pending[field] as string | null | undefined) ?? null;
      if ((from || "") === (to || "")) continue;
    }
    rows.push({ field, label: PENDING_CHANGE_LABELS[field], from, to });
  }
  return rows;
}

export type ApprovedChangesUpdate = {
  data: {
    name?: string;
    categoryId?: string;
    unit?: string;
    description?: string | null;
    shortDescription?: string | null;
    price?: number;
    salePrice?: number | null;
  };
  images: { url: string; sortOrder: number }[] | null;
};

/**
 * Validate the pending payload against the live product and build the update.
 * Returns `{ error }` when the change can't be applied as-is.
 */
export function buildApprovedChangesUpdate(
  live: { price: number; salePrice?: number | null },
  pending: PendingChanges
): ApprovedChangesUpdate | { error: string } {
  const data: ApprovedChangesUpdate["data"] = {};
  if (pending.name !== undefined) {
    const name = String(pending.name || "").trim();
    if (name.length < 2 || name.length > 200) return { error: "The new name must be 2–200 characters" };
    data.name = name;
  }
  if (pending.categoryId !== undefined) {
    if (!pending.categoryId) return { error: "The new category is missing" };
    data.categoryId = String(pending.categoryId);
  }
  if (pending.unit !== undefined) {
    const unit = String(pending.unit || "").trim();
    if (!unit) return { error: "The new unit is empty" };
    data.unit = unit;
  }
  if (pending.description !== undefined) data.description = pending.description ? String(pending.description) : null;
  if (pending.shortDescription !== undefined) {
    data.shortDescription = pending.shortDescription ? String(pending.shortDescription) : null;
  }
  if (pending.price !== undefined) {
    const p = toNum(pending.price);
    if (p == null || p <= 0) return { error: "The new price is not valid" };
    data.price = p;
  }
  if (pending.salePrice !== undefined) {
    const sp = toNum(pending.salePrice);
    if (sp != null && sp <= 0) return { error: "The new deal price is not valid" };
    data.salePrice = sp;
  }
  const finalPrice = data.price ?? live.price;
  const finalSale = data.salePrice !== undefined ? data.salePrice : live.salePrice ?? null;
  if (finalSale != null && finalSale >= finalPrice) {
    return { error: "After this change the deal price would not be lower than the regular price" };
  }
  let images: ApprovedChangesUpdate["images"] = null;
  if (pending.images !== undefined) {
    const urls = sortedUrls(pending.images);
    if (!urls.length) return { error: "The change removes every photo — a product needs at least one photo" };
    images = urls.slice(0, 5).map((url, i) => ({ url, sortOrder: i }));
  }
  if (!Object.keys(data).length && !images) return { error: "There are no changes to apply" };
  return { data, images };
}
