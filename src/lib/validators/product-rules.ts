/**
 * Store product rules (QA N3 / S9 / STO-01, N9).
 *
 * Shared by the store product form (client pre-check) and `/api/store`
 * (server), so limits and messages are identical everywhere.
 *
 * Pure module: no Prisma / Next imports — safe in client bundles and unit tests.
 */
import { z } from "zod";
import { zodFieldErrors, type FieldErrors } from "@/lib/validators/pk";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const PRODUCT_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  urduNameMax: 80,
  descriptionMin: 5,
  descriptionMax: 2000,
  shortDescriptionMax: 300,
  priceMin: 1,
  priceMax: 1_000_000,
  stockMin: 0,
  stockMax: 100_000,
  packSizeMin: 0.001,
  packSizeMax: 10_000,
  maxImages: 5,
  /** Price/deal changes larger than this fraction need MandiBazaar review (N9). */
  priceReviewThreshold: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Units (dropdown) — stored as "<size> <unit>", e.g. "1 kg", "500 g", "12 pc"
// ---------------------------------------------------------------------------

export const PRODUCT_UNITS = [
  "kg",
  "g",
  "litre",
  "ml",
  "pc",
  "dozen",
  "pack",
  "bundle",
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  kg: "kg (kilogram)",
  g: "g (gram)",
  litre: "litre",
  ml: "ml (millilitre)",
  pc: "pc (piece)",
  dozen: "dozen",
  pack: "pack",
  bundle: "bundle",
};

const UNIT_ALIASES: Record<string, ProductUnit> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  l: "litre",
  lt: "litre",
  ltr: "litre",
  ltrs: "litre",
  litre: "litre",
  litres: "litre",
  liter: "litre",
  liters: "litre",
  ml: "ml",
  mls: "ml",
  millilitre: "ml",
  milliliter: "ml",
  pc: "pc",
  pcs: "pc",
  piece: "pc",
  pieces: "pc",
  pce: "pc",
  unit: "pc",
  units: "pc",
  dozen: "dozen",
  dozens: "dozen",
  dz: "dozen",
  doz: "dozen",
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  pkt: "pack",
  bundle: "bundle",
  bundles: "bundle",
  gaddi: "bundle",
};

/**
 * Parse any unit text ("1kg", "1 KG", "500 gm", "pc", "/ 1pc") into
 * { size, unit }. Returns null when it can't be understood.
 */
export function parseUnit(raw: unknown): { size: number; unit: ProductUnit } | null {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase().replace(/^\/\s*/, "");
  if (!text) return null;
  const m = /^(\d+(?:\.\d+)?)?\s*([a-z]+)\.?$/.exec(text);
  if (!m) return null;
  const unit = UNIT_ALIASES[m[2]];
  if (!unit) return null;
  const size = m[1] ? Number(m[1]) : 1;
  if (!Number.isFinite(size) || size < PRODUCT_LIMITS.packSizeMin || size > PRODUCT_LIMITS.packSizeMax) {
    return null;
  }
  return { size, unit };
}

/** Canonical unit string: "1 kg", "500 g", "0.5 litre". */
export function formatUnit(size: number, unit: ProductUnit): string {
  const s = Number.isInteger(size) ? String(size) : String(Number(size.toFixed(3)));
  return `${s} ${unit}`;
}

/** Normalise any accepted unit text to the canonical form, or null. */
export function normalizeUnit(raw: unknown): string | null {
  const p = parseUnit(raw);
  return p ? formatUnit(p.size, p.unit) : null;
}

export const UNIT_MESSAGE = `Choose a unit from the list (${PRODUCT_UNITS.join(", ")})`;

// ---------------------------------------------------------------------------
// Zod field rules
// ---------------------------------------------------------------------------

const HAS_LETTER = new RegExp("\\p{L}", "u");

function trimmed(v: unknown) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v;
}

const priceMsg = (label: string) =>
  `${label} must be a whole number of rupees from 1 to 1,000,000`;

function zWholeRupees(label: string) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : v),
    z
      .number({ message: priceMsg(label) })
      .refine(
        (v) =>
          Number.isFinite(v) &&
          Number.isInteger(v) &&
          v >= PRODUCT_LIMITS.priceMin &&
          v <= PRODUCT_LIMITS.priceMax,
        { message: priceMsg(label) }
      )
  );
}

const stockMsg = "Stock must be a whole number from 0 to 100,000";

export const productFieldRules = {
  name: z.preprocess(
    trimmed,
    z
      .string({ message: "Product name is required" })
      .refine(
        (v) =>
          v.length >= PRODUCT_LIMITS.nameMin &&
          v.length <= PRODUCT_LIMITS.nameMax &&
          HAS_LETTER.test(v) &&
          !/[<>]/.test(v),
        { message: "Product name must be 2–80 characters and include letters" }
      )
  ),
  urduName: z.preprocess(
    (v) => (v == null ? "" : trimmed(v)),
    z
      .string()
      .refine((v) => v.length <= PRODUCT_LIMITS.urduNameMax && !/[<>]/.test(v), {
        message: "Urdu name can be at most 80 characters",
      })
  ),
  description: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ message: "Please add a product description" })
      .refine(
        (v) => v.length >= PRODUCT_LIMITS.descriptionMin && v.length <= PRODUCT_LIMITS.descriptionMax,
        { message: "Description must be 5–2,000 characters" }
      )
  ),
  shortDescription: z.preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
    z
      .string()
      .refine((v) => v.length <= PRODUCT_LIMITS.shortDescriptionMax, {
        message: "Short description can be at most 300 characters",
      })
  ),
  price: zWholeRupees("Regular price"),
  /** null / "" = no deal price */
  salePrice: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.union([z.null(), zWholeRupees("Deal price")])
  ),
  stockQuantity: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: stockMsg })
      .refine(
        (v) =>
          Number.isFinite(v) &&
          Number.isInteger(v) &&
          v >= PRODUCT_LIMITS.stockMin &&
          v <= PRODUCT_LIMITS.stockMax,
        { message: stockMsg }
      )
  ),
  unit: z
    .unknown()
    .transform((v, ctx) => {
      const n = normalizeUnit(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: UNIT_MESSAGE });
        return z.NEVER;
      }
      return n;
    }),
};

/** Full schema for creating a product (store portal). */
export const storeProductCreateSchema = z
  .object({
    name: productFieldRules.name,
    urduName: productFieldRules.urduName.optional(),
    description: productFieldRules.description,
    shortDescription: productFieldRules.shortDescription.optional(),
    price: productFieldRules.price,
    salePrice: productFieldRules.salePrice.optional(),
    stockQuantity: productFieldRules.stockQuantity,
    unit: productFieldRules.unit,
  })
  .superRefine((d, ctx) => {
    if (d.salePrice != null && d.salePrice >= d.price) {
      ctx.addIssue({
        code: "custom",
        path: ["salePrice"],
        message: "Deal price must be lower than the regular price",
      });
    }
  });

/** Partial schema for edits — only the fields that were sent are checked. */
export const storeProductUpdateSchema = z.object({
  name: productFieldRules.name.optional(),
  urduName: productFieldRules.urduName.optional(),
  description: productFieldRules.description.optional(),
  shortDescription: productFieldRules.shortDescription.optional(),
  price: productFieldRules.price.optional(),
  salePrice: productFieldRules.salePrice.optional(),
  stockQuantity: productFieldRules.stockQuantity.optional(),
  unit: productFieldRules.unit.optional(),
});

export type StoreProductUpdate = z.infer<typeof storeProductUpdateSchema>;

/** Run a schema and return field errors (or null) plus parsed data. */
export function checkProduct<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown
): { ok: true; data: z.infer<T> } | { ok: false; fieldErrors: FieldErrors } {
  const r = schema.safeParse(values);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, fieldErrors: zodFieldErrors(r.error) };
}

/** Stock can't go below units reserved by open/unpaid orders. */
export function stockBelowReservedError(stock: number, reserved: number): string | null {
  if (reserved > 0 && stock < reserved) {
    return `Stock can't be below ${reserved} — that many units are reserved in open or unpaid orders`;
  }
  return null;
}

/** Deal price must stay below the regular price (both whole rupees). */
export function salePriceError(price: number, salePrice: number | null | undefined): string | null {
  if (salePrice == null) return null;
  if (salePrice >= price) return "Deal price must be lower than the regular price";
  return null;
}

/** Whole-number "% off" for a deal price, 0 when not a discount. */
export function percentOff(price: number, salePrice: number | null | undefined): number {
  if (!salePrice || !price || salePrice >= price) return 0;
  return Math.round(((price - salePrice) / price) * 100);
}

// ---------------------------------------------------------------------------
// N9: which edits go live now and which wait for MandiBazaar review
// ---------------------------------------------------------------------------

export type ProductImageRef = { url: string; sortOrder: number };

/** The approved values currently live in the shop. */
export type LiveProduct = {
  status: string;
  name: string;
  categoryId: string;
  unit: string;
  description: string | null;
  shortDescription: string | null;
  price: number;
  salePrice: number | null;
  images: ProductImageRef[];
};

/** Fields that need review on an approved product. */
export type ReviewedFields = {
  name?: string;
  categoryId?: string;
  unit?: string;
  description?: string;
  shortDescription?: string;
  price?: number;
  salePrice?: number | null;
  images?: ProductImageRef[];
};

export type PendingChanges = ReviewedFields & {
  submittedById: string;
  submittedAt: string;
};

export const REVIEWED_KEYS = [
  "name",
  "categoryId",
  "unit",
  "description",
  "shortDescription",
  "price",
  "salePrice",
  "images",
] as const;
type ReviewedKey = (typeof REVIEWED_KEYS)[number];

/** Products a MandiBazaar already approved (ACTIVE or store-deactivated). */
export function isApprovedProduct(status: string): boolean {
  return status === "ACTIVE" || status === "INACTIVE";
}

/**
 * True when moving from `from` to `to` is more than ±20 %.
 * `from` <= 0 (no live value) counts as a big change.
 */
export function isLargePriceChange(from: number, to: number, threshold: number = PRODUCT_LIMITS.priceReviewThreshold): boolean {
  if (from === to) return false;
  if (!(from > 0)) return true;
  return Math.abs(to - from) / from > threshold + 1e-9;
}

function sameImages(a: ProductImageRef[], b: ProductImageRef[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.sortOrder - y.sortOrder).map((i) => i.url);
  const sb = [...b].sort((x, y) => x.sortOrder - y.sortOrder).map((i) => i.url);
  return sa.every((u, i) => u === sb[i]);
}

function sameValue(key: ReviewedKey, a: unknown, b: unknown): boolean {
  if (key === "images") {
    return sameImages((a as ProductImageRef[]) || [], (b as ProductImageRef[]) || []);
  }
  if (key === "unit") {
    const na = normalizeUnit(a) ?? String(a ?? "");
    const nb = normalizeUnit(b) ?? String(b ?? "");
    return na === nb;
  }
  if (key === "description" || key === "shortDescription" || key === "name") {
    return String(a ?? "").trim() === String(b ?? "").trim();
  }
  if (key === "price" || key === "salePrice") {
    if (a == null || b == null) return a == null && b == null;
    return Number(a) === Number(b);
  }
  return a === b;
}

export type EditPlan = {
  /** Apply to the live product now. */
  immediate: ReviewedFields;
  /**
   * Full pending set after this edit (old pending merged with new, minus keys
   * that now equal the live value). null = nothing waiting for review.
   */
  pending: ReviewedFields | null;
  /** Keys newly sent for review by THIS edit. */
  newlyPending: ReviewedKey[];
  /** Validation problem on the combined result (field → message). */
  errors: FieldErrors | null;
};

/**
 * Decide which of the reviewed fields go live and which wait for review (N9).
 *
 * - Product not yet approved (DRAFT): everything applies now (the whole
 *   listing is still waiting for its first approval).
 * - Approved product: name / category / unit / descriptions / photos always
 *   wait; price and deal price wait only when they move more than ±20 % from
 *   the live value (a new deal is compared with the live selling price).
 *   Ending a deal (deal → none) goes back to the approved regular price, so it
 *   applies now.
 * - The deal price must stay below the regular price both in the proposed
 *   listing and in what is live right after this edit.
 */
export function planProductEdit(
  live: LiveProduct,
  changes: ReviewedFields,
  existingPending: ReviewedFields | null
): EditPlan {
  const sent = REVIEWED_KEYS.filter((k) => changes[k] !== undefined);

  // What the listing will look like once everything (incl. old pending) is approved.
  const proposed = {
    price: changes.price ?? existingPending?.price ?? live.price,
    salePrice:
      changes.salePrice !== undefined
        ? changes.salePrice
        : existingPending?.salePrice !== undefined
          ? existingPending.salePrice
          : live.salePrice,
  };
  const errors: FieldErrors = {};
  const saleErr = salePriceError(proposed.price, proposed.salePrice ?? null);
  if (saleErr) errors.salePrice = saleErr;

  if (!isApprovedProduct(live.status)) {
    const immediate: ReviewedFields = {};
    for (const k of sent) {
      if (!sameValue(k, changes[k], live[k as keyof LiveProduct])) {
        (immediate as Record<string, unknown>)[k] = changes[k];
      }
    }
    const liveSale = immediate.salePrice !== undefined ? immediate.salePrice : live.salePrice;
    const livePrice = immediate.price ?? live.price;
    const liveErr = salePriceError(livePrice, liveSale ?? null);
    if (liveErr && !errors.salePrice) errors.salePrice = liveErr;
    return {
      immediate,
      pending: null,
      newlyPending: [],
      errors: Object.keys(errors).length ? errors : null,
    };
  }

  const immediate: ReviewedFields = {};
  const pending: Record<string, unknown> = { ...(existingPending || {}) };
  const newlyPending: ReviewedKey[] = [];

  for (const k of sent) {
    const next = changes[k];
    const liveVal = live[k as keyof LiveProduct];
    if (sameValue(k, next, liveVal)) {
      // Back to the live value: nothing to apply, drop any pending edit.
      delete pending[k];
      continue;
    }
    if (k === "price") {
      if (isLargePriceChange(live.price, next as number)) {
        if (!sameValue(k, next, existingPending?.price)) newlyPending.push(k);
        pending.price = next;
      } else {
        immediate.price = next as number;
        delete pending.price;
      }
      continue;
    }
    if (k === "salePrice") {
      const nextSale = next as number | null;
      if (nextSale == null) {
        // Ending a deal returns to the approved regular price.
        immediate.salePrice = null;
        delete pending.salePrice;
        continue;
      }
      const base = live.salePrice ?? live.price;
      if (isLargePriceChange(base, nextSale)) {
        if (!sameValue(k, next, existingPending?.salePrice)) newlyPending.push(k);
        pending.salePrice = nextSale;
      } else {
        immediate.salePrice = nextSale;
        delete pending.salePrice;
      }
      continue;
    }
    if (!sameValue(k, next, (existingPending as Record<string, unknown> | null)?.[k])) {
      newlyPending.push(k);
    }
    pending[k] = next;
  }

  // Live listing right after this edit must still be valid.
  const livePrice = immediate.price ?? live.price;
  const liveSale = immediate.salePrice !== undefined ? immediate.salePrice : live.salePrice;
  if (liveSale != null && liveSale >= livePrice) {
    // e.g. small price cut below an existing deal: hold both for review.
    if (immediate.price !== undefined) {
      pending.price = immediate.price;
      delete immediate.price;
      if (!newlyPending.includes("price")) newlyPending.push("price");
    }
    if (immediate.salePrice !== undefined) {
      pending.salePrice = immediate.salePrice;
      delete immediate.salePrice;
      if (!newlyPending.includes("salePrice")) newlyPending.push("salePrice");
    }
    const stillLivePrice = immediate.price ?? live.price;
    const stillLiveSale = immediate.salePrice !== undefined ? immediate.salePrice : live.salePrice;
    if (stillLiveSale != null && stillLiveSale >= stillLivePrice && !errors.salePrice) {
      errors.salePrice = "Deal price must be lower than the regular price. Clear or lower the deal price first.";
    }
  }

  const pendingKeys = Object.keys(pending).filter((k) =>
    (REVIEWED_KEYS as readonly string[]).includes(k)
  );
  const cleanPending: ReviewedFields = {};
  for (const k of pendingKeys) (cleanPending as Record<string, unknown>)[k] = pending[k];

  return {
    immediate,
    pending: pendingKeys.length ? cleanPending : null,
    newlyPending,
    errors: Object.keys(errors).length ? errors : null,
  };
}

/** Read `Product.pendingChanges` JSON safely. */
export function readPendingChanges(raw: unknown): PendingChanges | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of REVIEWED_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  if (!Object.keys(out).length) return null;
  return {
    ...(out as ReviewedFields),
    submittedById: String(obj.submittedById || ""),
    submittedAt: String(obj.submittedAt || ""),
  };
}

export const REVIEWED_FIELD_LABELS: Record<ReviewedKey, string> = {
  name: "name",
  categoryId: "category",
  unit: "unit",
  description: "description",
  shortDescription: "short description",
  price: "price",
  salePrice: "deal price",
  images: "photos",
};
