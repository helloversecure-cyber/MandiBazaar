/**
 * Admin form rules owned by D2 (QA S11, S14, U5, S15, P5, R5). Pure zod +
 * helpers — the same rules run in the browser (pre-check) and in the API.
 */
import { z } from "zod";
import {
  MSG,
  normalizeBankAccount,
  normalizeCnic,
  normalizePkIban,
  normalizePkMobile,
  optional,
  zBusinessName,
  zCity,
  zCnic,
  zEmail,
  zJazzCash,
  zMobile,
  zPassword,
  zPersonName,
  zPhone,
  zRupees,
  zText,
  zVehicleType,
} from "@/lib/validators/pk";

// ---------------------------------------------------------------------------
// Passwords for admin-created accounts
// ---------------------------------------------------------------------------

/** Old shared defaults that must never be (re)issued. */
export const KNOWN_WEAK_PASSWORDS = new Set(["rider@12345", "password", "12345678", "admin@12345"]);

export const WEAK_PASSWORD_MSG = "This password is publicly known. Leave it blank to generate a random one.";

/** Blank = generate a random one; typed = S0 password rule and not a known default. */
const zTempPassword = optional(
  zPassword.refine((v) => !KNOWN_WEAK_PASSWORDS.has(v.trim().toLowerCase()), { message: WEAK_PASSWORD_MSG })
);

// ---------------------------------------------------------------------------
// Phone lookups (legacy rows may hold "0300-1234567", "+92…")
// ---------------------------------------------------------------------------

/** All stored spellings of a normalised mobile ("03001234567") to match legacy rows. */
export function phoneLookupVariants(raw: string): string[] {
  const out = new Set<string>();
  const trimmed = String(raw || "").trim();
  if (trimmed) out.add(trimmed);
  const n = normalizePkMobile(raw);
  if (n) {
    const rest = n.slice(1); // 3001234567
    const a = n.slice(0, 4); // 0300
    const b = n.slice(4); // 1234567
    [
      n,
      `+92${rest}`,
      `92${rest}`,
      `0092${rest}`,
      `${a}-${b}`,
      `${a} ${b}`,
      `+92 ${rest.slice(0, 3)} ${b}`,
      `+92-${rest.slice(0, 3)}-${b}`,
      `+92 ${rest.slice(0, 3)}-${b}`,
    ].forEach((v) => out.add(v));
  }
  return Array.from(out);
}

/** True when a stored customer phone is missing or not a valid PK mobile (QA P10). */
export function isInvalidCustomerPhone(phone: string | null | undefined): boolean {
  return !normalizePkMobile(phone ?? null);
}

// ---------------------------------------------------------------------------
// Quick-add rider (Admin → Riders) and Create staff (Admin → Staff)
// ---------------------------------------------------------------------------

/** Rider payout account: bank account number (10–20 digits) or a PK IBAN. */
const zRiderAccountNumber = z
  .string()
  .transform((v, ctx) => {
    const n = normalizePkIban(v) || normalizeBankAccount(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a bank account number (10–20 digits) or an IBAN like PK36SCBL0000001123456702" });
      return z.NEVER;
    }
    return n;
  });

export const riderQuickAddSchema = z.object({
  name: zPersonName,
  phone: zMobile,
  email: optional(zEmail),
  password: zTempPassword,
  cnicNumber: zCnic,
  city: zCity,
  vehicleType: zVehicleType,
  accountTitle: optional(zPersonName),
  bankName: optional(zText(60, "Bank name")),
  accountNumber: optional(zRiderAccountNumber),
  jazzCashNumber: optional(zJazzCash),
});
export type RiderQuickAddInput = z.input<typeof riderQuickAddSchema>;

export const STAFF_ROLE_OPTIONS = ["ADMIN", "ORDER_MANAGER", "INVENTORY_MANAGER", "DELIVERY_MANAGER"] as const;

export const staffCreateSchema = z.object({
  fullName: zPersonName,
  phone: zMobile,
  email: optional(zEmail),
  password: zTempPassword,
  role: z.enum(STAFF_ROLE_OPTIONS, { message: "Choose a staff role from the list" }),
});

// ---------------------------------------------------------------------------
// Rider approval guard (QA P5)
// ---------------------------------------------------------------------------

export type RiderDocs = {
  cnicNumber?: string | null;
  vehicleType?: string | null;
  photoUrl?: string | null;
  cnicUrl?: string | null;
  cnicBackUrl?: string | null;
  licenseUrl?: string | null;
  bikeUrl?: string | null;
  bikeCardUrl?: string | null;
  accountNumber?: string | null;
  jazzCashNumber?: string | null;
};

/** Problems that block approving a rider application ([] = can approve). */
export function riderApprovalProblems(r: RiderDocs): string[] {
  const problems: string[] = [];
  if (!normalizeCnic(r.cnicNumber ?? null)) problems.push("CNIC number is missing or invalid (13 digits)");
  const needsVehicleDocs = (r.vehicleType || "Bike") !== "Bicycle";
  const docs: [keyof RiderDocs, string, boolean][] = [
    ["photoUrl", "rider photo", true],
    ["cnicUrl", "CNIC front", true],
    ["cnicBackUrl", "CNIC back", true],
    ["licenseUrl", "driving license", needsVehicleDocs],
    ["bikeUrl", "vehicle photo", needsVehicleDocs],
    ["bikeCardUrl", "vehicle registration card", needsVehicleDocs],
  ];
  const missingDocs = docs.filter(([k, , req]) => req && !String(r[k] || "").trim()).map(([, label]) => label);
  if (missingDocs.length) problems.push(`Missing documents: ${missingDocs.join(", ")}`);
  const acct = r.accountNumber ?? null;
  const validAccount = Boolean(normalizeBankAccount(acct) || normalizePkIban(acct));
  const validJazz = Boolean(normalizePkMobile(r.jazzCashNumber ?? null));
  if (!validAccount && !validJazz) {
    problems.push("No valid payout account (bank account number, IBAN or JazzCash number)");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Settings (QA S14 / P8 / U5)
// ---------------------------------------------------------------------------

/** Number (decimals allowed, up to 2 places) in [min, max]. */
function zAmount(opts: { min: number; max: number; label: string; unit?: "Rs" | "%" }) {
  const { min, max, label, unit = "Rs" } = opts;
  const range =
    unit === "%"
      ? `${min}–${max}%`
      : `Rs ${min.toLocaleString("en-PK")}–${max.toLocaleString("en-PK")}`;
  const message = `${label} must be a number from ${range}`;
  return z.coerce
    .number({ message })
    .refine((v) => Number.isFinite(v) && v >= min && v <= max && Math.round(v * 100) === v * 100, {
      message,
    });
}

/** Empty input must fail (z.coerce turns "" into 0). */
function filled<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v), schema);
}

export const settingsSchema = z
  .object({
    businessName: zBusinessName,
    phone: optional(zPhone),
    email: optional(zEmail),
    address: optional(zText(200, "Address")),
    defaultDeliveryFee: filled(zRupees({ min: 0, max: 5000, label: "Default delivery fee" })),
    deliveryRatePerKm: filled(zAmount({ min: 0, max: 500, label: "Delivery rate per km" })),
    maxDeliveryFee: optional(zRupees({ min: 0, max: 10000, label: "Maximum delivery fee" })),
    freeDeliveryThreshold: optional(zRupees({ min: 0, max: 1_000_000, label: "Free-delivery threshold" })),
    minimumOrderAmount: filled(zRupees({ min: 0, max: 1_000_000, label: "Minimum order amount" })),
    platformCommissionPct: filled(zAmount({ min: 0, max: 50, label: "Platform commission", unit: "%" })),
    // Optional so older clients that don't send them keep the saved values
    fullCodMaxOrderAmount: optional(zRupees({ min: 0, max: 100_000, label: "Full cash-on-delivery limit" })),
    riderBaseFee: optional(zRupees({ min: 0, max: 5000, label: "Rider pay per delivery" })),
    riderPerKmFee: optional(zAmount({ min: 0, max: 500, label: "Rider pay per km" })),
    // COD remittance controls
    remittanceDeadlineHours: optional(
      z.coerce.number().int("Enter the remittance deadline in whole hours").min(1).max(168)
    ),
    remittanceMethods: optional(z.array(z.enum(["CASH_HANDOVER", "BANK", "JAZZCASH"])).max(3)),
    cashHandoverInstructions: optional(zText(500, "Cash handover instructions")),
  })
  .refine((d) => d.maxDeliveryFee == null || d.maxDeliveryFee >= d.defaultDeliveryFee, {
    message: "Maximum delivery fee can't be lower than the default delivery fee",
    path: ["maxDeliveryFee"],
  });
export type SettingsValues = z.output<typeof settingsSchema>;

/** Fields that change what customers or stores pay — confirm before saving. */
export const PRICE_SETTING_FIELDS = [
  "defaultDeliveryFee",
  "deliveryRatePerKm",
  "maxDeliveryFee",
  "freeDeliveryThreshold",
  "minimumOrderAmount",
  "platformCommissionPct",
  "fullCodMaxOrderAmount",
  "riderBaseFee",
  "riderPerKmFee",
] as const;

export const SETTING_LABELS: Record<string, string> = {
  businessName: "Business name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  defaultDeliveryFee: "Default delivery fee",
  deliveryRatePerKm: "Delivery rate per km",
  maxDeliveryFee: "Maximum delivery fee",
  freeDeliveryThreshold: "Free-delivery threshold",
  minimumOrderAmount: "Minimum order amount",
  platformCommissionPct: "Platform commission",
  fullCodMaxOrderAmount: "Full cash-on-delivery limit",
  riderBaseFee: "Rider pay per delivery",
  riderPerKmFee: "Rider pay per km",
};

export type SettingChange = { field: string; label: string; from: string | number | null; to: string | number | null };

function norm(field: string, v: unknown): string | number | null {
  if (v === undefined || v === null || v === "") return null;
  if (!(PRICE_SETTING_FIELDS as readonly string[]).includes(field)) return String(v);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : String(v);
}

/** old → new for every changed field (optionally only `fields`). */
export function settingsChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  fields: readonly string[] = Object.keys(SETTING_LABELS)
): SettingChange[] {
  const out: SettingChange[] = [];
  for (const f of fields) {
    if (!(f in after)) continue;
    const from = norm(f, before?.[f]);
    const to = norm(f, after[f]);
    if (from !== to) out.push({ field: f, label: SETTING_LABELS[f] || f, from, to });
  }
  return out;
}

export function formatSettingValue(field: string, v: string | number | null): string {
  if (v == null) return "not set";
  if (field === "platformCommissionPct") return `${v}%`;
  if ((PRICE_SETTING_FIELDS as readonly string[]).includes(field)) {
    return `Rs ${Number(v).toLocaleString("en-PK")}${field === "deliveryRatePerKm" || field === "riderPerKmFee" ? "/km" : ""}`;
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Inventory "Adjust stock" (QA S15)
// ---------------------------------------------------------------------------

export const MAX_STOCK = 100_000;

export const stockAdjustSchema = z
  .object({
    quantity: filled(
      z.coerce
        .number({ message: "Enter a whole number like 10 or -5" })
        .refine((v) => Number.isInteger(v), { message: "Enter a whole number like 10 or -5" })
        .refine((v) => v !== 0, { message: "Quantity can't be zero" })
        .refine((v) => Math.abs(v) <= MAX_STOCK, {
          message: `Change can be at most ${MAX_STOCK.toLocaleString("en-PK")} units`,
        })
    ),
    note: z
      .string()
      .optional()
      .transform((v) => (v || "").trim())
      .refine((v) => v.length <= 200, { message: "Reason can be at most 200 characters" }),
  })
  .refine((d) => !(d.quantity < 0) || d.note.length >= 3, {
    message: "Give a reason for reducing stock (at least 3 characters)",
    path: ["note"],
  });

/** Checks that need the current stock (server re-checks inside the transaction). */
export function stockAdjustLimitError(
  quantity: number,
  current: { stock: number; reserved: number }
): string | null {
  const next = current.stock + quantity;
  if (next < 0) return `Stock can't go below 0 (current stock ${current.stock})`;
  if (next < current.reserved) {
    return `Stock can't go below the ${current.reserved} unit(s) reserved for open orders (you can remove at most ${Math.max(0, current.stock - current.reserved)})`;
  }
  if (next > MAX_STOCK) return `Stock can be at most ${MAX_STOCK.toLocaleString("en-PK")} units`;
  return null;
}

export { MSG };
