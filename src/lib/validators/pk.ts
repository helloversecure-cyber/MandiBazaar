/**
 * Shared field rules for every form (QA report section S0).
 * Used on BOTH the server (API routes) and the client (form pre-checks), so the
 * rules and messages are identical everywhere.
 *
 * Every error message is plain English that tells the user what to type.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Fixed lists (use as dropdown options)
// ---------------------------------------------------------------------------

export const PK_PROVINCES = [
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Islamabad Capital Territory",
  "Gilgit-Baltistan",
  "Azad Jammu & Kashmir",
] as const;

export const PK_CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Gujranwala",
  "Sialkot",
  "Peshawar",
  "Quetta",
  "Hyderabad",
  "Bahawalpur",
  "Sargodha",
  "Sheikhupura",
  "Kasur",
  "Okara",
  "Sahiwal",
  "Gujrat",
  "Jhelum",
  "Rahim Yar Khan",
  "Dera Ghazi Khan",
  "Sukkur",
  "Larkana",
  "Nawabshah",
  "Mardan",
  "Abbottabad",
  "Mingora",
  "Muzaffarabad",
  "Mirpur",
  "Gilgit",
  "Other",
] as const;

export const VEHICLE_TYPES = ["Bike", "Bicycle", "Rickshaw", "Car", "Loader / Pickup"] as const;

// ---------------------------------------------------------------------------
// Plain normalisers (no zod) — usable anywhere
// ---------------------------------------------------------------------------

/** "+92 300-1234567", "0092 300 1234567", "923001234567", "03001234567" → "03001234567"; else null */
export function normalizePkMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.trim().replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("0092")) d = "0" + d.slice(4);
  else if (d.startsWith("92") && d.length === 12) d = "0" + d.slice(2);
  else if (d.startsWith("3") && d.length === 10) d = "0" + d;
  return /^03\d{9}$/.test(d) ? d : null;
}

/** Landline (area code + number, 10–11 digits starting 0), UAN (111XXXXXX) or a mobile. Returns digits. */
export function normalizePkPhone(raw: unknown): string | null {
  const mobile = normalizePkMobile(raw);
  if (mobile) return mobile;
  if (typeof raw !== "string") return null;
  let d = raw.trim().replace(/[\s\-().]/g, "");
  if (d.startsWith("+92")) d = "0" + d.slice(3);
  if (!/^\d+$/.test(d)) return null;
  if (/^111\d{6}$/.test(d)) return d; // UAN
  if (/^0[1-9]\d{8,9}$/.test(d)) return d; // landline 10–11 digits
  return null;
}

/** "3520212345671" or "35202-1234567-1" → "35202-1234567-1"; else null */
export function normalizeCnic(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^[1-7]\d{4}-?\d{7}-?\d$/.test(v)) return null;
  const d = v.replace(/-/g, "");
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/** "pk36 scbl 0000 0011 2345 6702" → "PK36SCBL0000001123456702"; else null */
export function normalizePkIban(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, "").toUpperCase();
  return /^PK\d{2}[A-Z]{4}\d{16}$/.test(v) ? v : null;
}

/** Digits only, 10–20 long (spaces/dashes removed); else null */
export function normalizeBankAccount(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/[\s-]/g, "");
  return /^\d{10,20}$/.test(v) ? v : null;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 100 || !EMAIL_RE.test(v) || v.includes("..")) return null;
  return v;
}

export function isSafeMapsUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  return (
    /^https:\/\/maps\.app\.goo\.gl\/\S+$/.test(v) ||
    /^https:\/\/goo\.gl\/maps\/\S+$/.test(v) ||
    /^https:\/\/(www\.)?google\.com(\.pk)?\/maps\S*$/.test(v) ||
    /^https:\/\/maps\.google\.com(\.pk)?\/\S*$/.test(v)
  );
}

/** Same rule the server applies to "email or phone" sign-in / reset fields. */
export function normalizeLoginIdentifier(raw: unknown): string | null {
  return normalizePkMobile(raw) || normalizeEmail(raw);
}

// Unicode-aware patterns (built with RegExp so the "u" flag works with the ES5 TS target)
const HAS_LETTER = new RegExp("\\p{L}", "u");
const NAME_CHARS = new RegExp("^[\\p{L}\\p{M} .'-]+$", "u");
const HAS_LETTER_OR_DIGIT = new RegExp("[\\p{L}\\d]", "u");

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MSG = {
  mobile: "Enter a valid mobile number, e.g. 03001234567",
  phone: "Enter a valid phone number, e.g. 042-35761234 or 03001234567",
  email: "Enter a valid email, e.g. ali@gmail.com",
  name: "Enter a name of 2–60 letters (no numbers or symbols)",
  password: "Password must be 8–64 characters with at least one letter and one number",
  cnic: "Enter a valid 13-digit CNIC, e.g. 35202-1234567-1",
  iban: "Enter a valid Pakistani IBAN, e.g. PK36SCBL0000001123456702",
  bankAccount: "Account number must be 10–20 digits",
  jazzCash: "Enter a valid JazzCash mobile number, e.g. 03001234567",
  city: "Choose a city from the list",
  province: "Choose a province from the list",
  mapsUrl: "Paste a Google Maps link starting with https://maps.app.goo.gl/ or https://www.google.com/maps",
  latitude: "Latitude must be between 23 and 37 (Pakistan)",
  longitude: "Longitude must be between 60 and 78 (Pakistan)",
  postalCode: "Postal code must be 5 digits",
  link: "Use a site page like /products or a link starting with https://",
  orderNumber: "Order number looks like ORD-20261031-000001",
  loginId: "Enter a valid email or mobile number, e.g. 03001234567",
} as const;

// ---------------------------------------------------------------------------
// Zod building blocks
// ---------------------------------------------------------------------------

/** Treat "", null and undefined as "not provided" before running `schema`. */
export function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    schema.optional()
  );
}

function normalized(normalize: (v: unknown) => string | null, message: string) {
  return z.string({ message }).transform((v, ctx) => {
    const n = normalize(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return n;
  });
}

export const zMobile = normalized(normalizePkMobile, MSG.mobile);
export const zPhone = normalized(normalizePkPhone, MSG.phone);
export const zJazzCash = normalized(normalizePkMobile, MSG.jazzCash);
export const zEmail = normalized(normalizeEmail, MSG.email);
export const zCnic = normalized(normalizeCnic, MSG.cnic);
export const zIban = normalized(normalizePkIban, MSG.iban);
export const zBankAccount = normalized(normalizeBankAccount, MSG.bankAccount);
export const zLoginIdentifier = normalized(normalizeLoginIdentifier, MSG.loginId);

/** 2–60 chars, letters (any script incl. Urdu), spaces and . ' - only; collapses spaces. */
export const zPersonName = z
  .string({ message: MSG.name })
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .refine((v) => v.length >= 2 && v.length <= 60 && NAME_CHARS.test(v) && HAS_LETTER.test(v), {
    message: MSG.name,
  });

/** Business / store / account-title names: letters, digits and common punctuation; 2–80. */
export const zBusinessName = z
  .string({ message: "Enter a name of 2–80 characters" })
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .refine((v) => v.length >= 2 && v.length <= 80 && HAS_LETTER.test(v) && !/[<>]/.test(v), {
    message: "Enter a name of 2–80 characters (must include letters, no < or >)",
  });

export const zPassword = z
  .string({ message: MSG.password })
  .refine((v) => v.length >= 8 && v.length <= 64 && v.trim().length > 0 && /[A-Za-z]/.test(v) && /\d/.test(v), {
    message: MSG.password,
  });

export const zCity = z.enum(PK_CITIES, { message: MSG.city });
export const zProvince = z.enum(PK_PROVINCES, { message: MSG.province });
export const zVehicleType = z.enum(VEHICLE_TYPES, { message: "Choose a vehicle type from the list" });

/** Address lines (house, street, area): 3–120 characters, not only spaces/symbols. */
export function zAddressLine(label = "Address") {
  return z
    .string({ message: `${label} is required` })
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => v.length >= 3 && v.length <= 120 && HAS_LETTER_OR_DIGIT.test(v), {
      message: `${label} must be 3–120 characters`,
    });
}

export const zPostalCode = z.string().trim().regex(/^\d{5}$/, { message: MSG.postalCode });

export const zLatitude = z.coerce
  .number({ message: MSG.latitude })
  .refine((v) => Number.isFinite(v) && v >= 23 && v <= 37, { message: MSG.latitude });
export const zLongitude = z.coerce
  .number({ message: MSG.longitude })
  .refine((v) => Number.isFinite(v) && v >= 60 && v <= 78, { message: MSG.longitude });

export const zMapsUrl = z
  .string()
  .trim()
  .refine((v) => isSafeMapsUrl(v), { message: MSG.mapsUrl });

/** Whole rupees in [min, max]. Accepts numeric strings. */
export function zRupees(opts: { min?: number; max?: number; label?: string } = {}) {
  const { min = 1, max = 1_000_000, label = "Amount" } = opts;
  const message = `${label} must be a whole number of rupees from ${min.toLocaleString("en-PK")} to ${max.toLocaleString("en-PK")}`;
  return z.coerce
    .number({ message })
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, { message });
}

/** Stock / quantity: whole number in [min, max]. */
export function zQuantity(opts: { min?: number; max?: number; label?: string } = {}) {
  const { min = 0, max = 100_000, label = "Quantity" } = opts;
  const message = `${label} must be a whole number from ${min.toLocaleString("en-PK")} to ${max.toLocaleString("en-PK")}`;
  return z.coerce
    .number({ message })
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, { message });
}

/** Free text with a maximum length (notes 500, descriptions 2000, …). */
export function zText(max: number, label = "Text", min = 0) {
  return z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= min && v.length <= max, {
      message: min > 0 ? `${label} must be ${min}–${max} characters` : `${label} can be at most ${max} characters`,
    });
}

/** Coupon code: 3–20 capital letters/numbers (input is upper-cased). */
export const zCouponCode = z
  .string({ message: "Coupon code is required" })
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => /^[A-Z0-9]{3,20}$/.test(v), {
    message: "Coupon code must be 3–20 letters or numbers, no spaces",
  });

/** Category name: 2–40 characters, must include letters. */
export const zCategoryName = z
  .string({ message: "Category name is required" })
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .refine((v) => v.length >= 2 && v.length <= 40 && HAS_LETTER.test(v) && !/[<>]/.test(v), {
    message: "Category name must be 2–40 characters with letters (no < or >)",
  });

export const zOrderNumber = z
  .string({ message: MSG.orderNumber })
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => /^ORD-\d{8}-\d{6}$/.test(v), { message: MSG.orderNumber });

/** Banner / button links: internal "/page" or https:// only (blocks javascript:). */
export const zSafeLink = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (!v || v.length > 500 || /[\s<>"'`\\]/.test(v)) return false;
      if (v.startsWith("/")) return !v.startsWith("//");
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: MSG.link }
  );

// ---------------------------------------------------------------------------
// Field-error helpers (shared by server + client)
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

/** Flatten a ZodError into { "owner.phone": "Enter a valid mobile…" } (first message per field). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Client-side pre-check: returns field errors, or null when valid. */
export function validateFields<T extends z.ZodTypeAny>(schema: T, values: unknown): FieldErrors | null {
  const r = schema.safeParse(values);
  return r.success ? null : zodFieldErrors(r.error);
}
