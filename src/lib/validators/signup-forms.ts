/**
 * Store signup / store profile / rider signup rules (QA L3, S2, S3, S10, N7).
 * Shared by the forms (client pre-check) and the API routes (source of truth).
 */
import { z } from "zod";
import {
  MSG,
  normalizeBankAccount,
  normalizePkIban,
  optional,
  zAddressLine,
  zBankAccount,
  zBusinessName,
  zCity,
  zCnic,
  zEmail,
  zIban,
  zJazzCash,
  zLatitude,
  zLongitude,
  zMapsUrl,
  zPhone,
  zPostalCode,
  zProvince,
  zText,
  zPassword,
  zVehicleType,
  zodFieldErrors,
  type FieldErrors,
} from "@/lib/validators/pk";
import { registerSchema } from "@/lib/validators/schemas";

export const PAYOUT_REQUIRED_MSG =
  "Add at least one payout method: bank account number, IBAN or JazzCash number";
export const LOCATION_REQUIRED_MSG =
  "Add your store location: tap “Use my current location” or paste a Google Maps link to your shop";
export const ACCOUNT_TITLE_REQUIRED_MSG = "Enter the name the bank account is registered in";
export const RIDER_PAYOUT_REQUIRED_MSG = "Add a bank account / IBAN or a JazzCash number";
export const CATEGORY_REQUIRED_MSG =
  "Select at least one category, or choose Others and type a name";

/** Upload URLs produced by /api/upload: local /uploads/…, https storage, or a local dev server. */
export function isUploadUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 1000 || /[\s<>"'`]/.test(v)) return false;
  return (
    v.startsWith("/uploads/") ||
    v.startsWith("https://") ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(v)
  );
}

/** Upload URL field (documents, photos, logo). */
export const zUploadUrl = (label: string) =>
  z
    .string({ message: `Please upload the ${label}` })
    .trim()
    .refine((v) => isUploadUrl(v), {
      message: `Please upload the ${label}`,
    });

const zBankName = zText(80, "Bank name").refine((v) => !/[<>]/.test(v), {
  message: "Bank name can't contain < or >",
});

/** Bank / JazzCash payout fields with the "at least one" rule. */
const payoutShape = {
  bankAccountTitle: optional(zBusinessName),
  bankName: optional(zBankName),
  bankAccountNumber: optional(zBankAccount),
  bankIban: optional(zIban),
  jazzCashNumber: optional(zJazzCash),
  jazzCashAccountTitle: optional(zBusinessName),
};

/** Raw form values: anything non-blank counts as "filled in". */
type RawValues = Record<string, unknown>;

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

/**
 * Cross-field rules, run on the RAW values so they appear together with the
 * per-field format errors (zod skips refinements once a field has failed).
 */
function payoutErrors(d: RawValues, out: FieldErrors) {
  if (!filled(d.bankAccountNumber) && !filled(d.bankIban) && !filled(d.jazzCashNumber)) {
    out.bankAccountNumber = PAYOUT_REQUIRED_MSG;
  }
  if ((filled(d.bankAccountNumber) || filled(d.bankIban)) && !filled(d.bankAccountTitle)) {
    out.bankAccountTitle = ACCOUNT_TITLE_REQUIRED_MSG;
  }
}

/**
 * Location rule. `requirePin` (server, after link extraction) demands lat+lng;
 * otherwise (client) a Maps link is accepted because the server will read it.
 */
function locationErrors(d: RawValues, out: FieldErrors, requirePin: boolean) {
  const hasLat = filled(d.latitude);
  const hasLng = filled(d.longitude);
  if (hasLat !== hasLng) {
    out[hasLat ? "longitude" : "latitude"] =
      "Enter both latitude and longitude, or tap “Use my current location”";
    return;
  }
  if (!hasLat && (requirePin || !filled(d.googleMapsUrl))) {
    out.latitude = LOCATION_REQUIRED_MSG;
  }
}

export type ValidationResult<T> =
  | { success: true; data: T; errors: null }
  | { success: false; data: null; errors: FieldErrors };

function run<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
  cross: (raw: RawValues, out: FieldErrors) => void
): ValidationResult<z.output<T>> {
  const raw = (values && typeof values === "object" ? values : {}) as RawValues;
  const crossOut: FieldErrors = {};
  cross(raw, crossOut);
  const r = schema.safeParse(values);
  const errors: FieldErrors = { ...crossOut, ...(r.success ? {} : zodFieldErrors(r.error)) };
  if (r.success && Object.keys(errors).length === 0) {
    return { success: true, data: r.data, errors: null };
  }
  return { success: false, data: null, errors };
}

/** Store fields common to signup and the store profile page. */
const storeBaseShape = {
  name: zBusinessName,
  description: optional(zText(1000, "Description")),
  phone: optional(zPhone),
  email: optional(zEmail),
  addressLine: zAddressLine("Shop address"),
  area: optional(zAddressLine("Area")),
  city: zCity,
  province: zProvince,
  postalCode: optional(zPostalCode),
  googleMapsUrl: optional(zMapsUrl),
  latitude: optional(zLatitude),
  longitude: optional(zLongitude),
  logoUrl: optional(zUploadUrl("logo")),
  ...payoutShape,
};

export const STORE_DOC_FIELDS = ["cnicFront", "cnicBack", "shopImage", "addressProof"] as const;
export type StoreDocField = (typeof STORE_DOC_FIELDS)[number];

export function storeDocLabel(field: StoreDocField, isVirtual: boolean): string {
  switch (field) {
    case "cnicFront":
      return "CNIC front photo";
    case "cnicBack":
      return "CNIC back photo";
    case "shopImage":
      return isVirtual ? "warehouse photo" : "shop photo";
    case "addressProof":
      return "address proof";
  }
}

/** Which documents are required — mirrors the server rule (address proof optional for virtual stores). */
export function requiredStoreDocs(isVirtual: boolean): StoreDocField[] {
  return isVirtual ? ["cnicFront", "cnicBack", "shopImage"] : [...STORE_DOC_FIELDS];
}

/** Missing-document errors keyed by doc field (QA L4). */
export function missingStoreDocErrors(
  docs: Partial<Record<StoreDocField, string | null | undefined>>,
  isVirtual: boolean
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of requiredStoreDocs(isVirtual)) {
    if (!docs[f] || !String(docs[f]).trim()) {
      out[f] = `Please upload your ${storeDocLabel(f, isVirtual)}`;
    }
  }
  return out;
}

const storeSignupObject = z.object({
  ...storeBaseShape,
  cnicNumber: zCnic,
  isVirtual: z.boolean().optional(),
  requestedCategories: z
    .array(z.string())
    .max(20, { message: "Choose at most 20 categories" })
    .refine((a) => a.length > 0, { message: CATEGORY_REQUIRED_MSG }),
});

/** Store application. `server: true` requires lat/lng (after Maps-link extraction). */
export function validateStoreSignup(values: unknown, opts: { server: boolean }) {
  return run(storeSignupObject, values, (raw, out) => {
    payoutErrors(raw, out);
    locationErrors(raw, out, opts.server);
  });
}

/** Store owner account when applying while signed out. */
export const storeOwnerSchema = registerSchema;

/** Per-field schemas for live (on-blur) validation of the store signup / profile fields. */
const storeFieldSchemas: Record<string, z.ZodTypeAny> = {
  ...storeBaseShape,
  cnicNumber: zCnic,
};
const ownerFieldSchemas = registerSchema.shape as Record<string, z.ZodTypeAny>;

/**
 * Validate ONE store signup field as the user leaves it (QA S0: show the error while
 * typing, not only on submit). Owner fields are passed as "owner.<field>".
 * Only checks format: an empty value returns null here (required-field and cross-field
 * rules — payout, location, documents — are still enforced on submit and on the server).
 */
export function storeSignupFieldError(name: string, value: string): string | null {
  if (!value.trim()) return null;
  const schema = name.startsWith("owner.")
    ? ownerFieldSchemas[name.slice("owner.".length)]
    : storeFieldSchemas[name];
  if (!schema) return null;
  const r = schema.safeParse(value);
  return r.success ? null : r.error.issues[0]?.message ?? "Please check this field";
}

const storeProfileObject = z.object(storeBaseShape);

/** Store profile page / UPDATE_PROFILE (same rules as signup, minus CNIC/categories/docs). */
export function validateStoreProfile(values: unknown, opts: { server: boolean }) {
  return run(storeProfileObject, values, (raw, out) => {
    payoutErrors(raw, out);
    locationErrors(raw, out, opts.server);
  });
}

/** Bank account number OR IBAN in one field (rider form). Returns the normalised value. */
export const zBankAccountOrIban = z
  .string({ message: "Enter a 10–20 digit account number or a Pakistani IBAN (PK…)" })
  .transform((v, ctx) => {
    const n = normalizePkIban(v) || normalizeBankAccount(v);
    if (!n) {
      ctx.addIssue({
        code: "custom",
        message: `${MSG.bankAccount}, or enter a Pakistani IBAN like PK36SCBL0000001123456702`,
      });
      return z.NEVER;
    }
    return n;
  });

export const RIDER_DOC_FIELDS = [
  ["photoUrl", "rider photo (selfie)"],
  ["cnicUrl", "CNIC front photo"],
  ["cnicBackUrl", "CNIC back photo"],
  ["licenseUrl", "driving licence photo"],
  ["bikeUrl", "bike / vehicle photo"],
  ["bikeCardUrl", "bike card (registration) photo"],
] as const;

const riderDocShape = Object.fromEntries(
  RIDER_DOC_FIELDS.map(([key, label]) => [key, zUploadUrl(label)])
) as Record<(typeof RIDER_DOC_FIELDS)[number][0], ReturnType<typeof zUploadUrl>>;

const riderSignupObject = registerSchema.extend({
  city: zCity,
  vehicleType: zVehicleType,
  cnicNumber: zCnic,
  accountTitle: optional(zBusinessName),
  accountNumber: optional(zBankAccountOrIban),
  bankName: optional(zBankName),
  jazzCashNumber: optional(zJazzCash),
  ...riderDocShape,
});

/** Rider self-signup (QA S3 / H3). */
export function validateRiderSignup(values: unknown) {
  return run(riderSignupObject, values, (raw, out) => {
    if (!filled(raw.accountNumber) && !filled(raw.jazzCashNumber)) {
      out.accountNumber = RIDER_PAYOUT_REQUIRED_MSG;
    }
  });
}

/** Change password (any role; required when User.mustChangePassword). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { message: "Enter your current password" }).max(128),
    newPassword: zPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ["newPassword"],
    message: "Choose a new password that is different from the current one",
  });

