/**
 * Rider documents added by an admin (quick-add form and "Add / replace documents"
 * on the Riders page). Pure — client + server.
 * A document URL must be one of our uploads (/uploads/…) or an https URL.
 */
import { isUploadUrl } from "@/lib/validators/signup-forms";

export const RIDER_DOCUMENT_FIELDS = [
  { key: "photoUrl", label: "Rider photo", kind: "profile" as const },
  { key: "cnicUrl", label: "CNIC front", kind: "business" as const },
  { key: "cnicBackUrl", label: "CNIC back", kind: "business" as const },
  { key: "licenseUrl", label: "Driving licence", kind: "business" as const },
  { key: "bikeUrl", label: "Bike / vehicle photo", kind: "business" as const },
  { key: "bikeCardUrl", label: "Bike registration card", kind: "business" as const },
] as const;

export type RiderDocumentKey = (typeof RIDER_DOCUMENT_FIELDS)[number]["key"];
export type RiderDocumentValues = Partial<Record<RiderDocumentKey, string>>;

/**
 * Reads the document fields from a request body. Blank / missing = not given
 * (keeps what is saved). Returns field errors for anything that isn't an upload.
 */
export function parseRiderDocuments(raw: unknown): { errors: Record<string, string>; value: RiderDocumentValues } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const value: RiderDocumentValues = {};
  for (const f of RIDER_DOCUMENT_FIELDS) {
    const v = src[f.key];
    if (v == null) continue;
    if (typeof v !== "string") {
      errors[f.key] = `Upload the ${f.label.toLowerCase()} again`;
      continue;
    }
    const t = v.trim();
    if (!t) continue;
    if (!isUploadUrl(t)) {
      errors[f.key] = `Upload the ${f.label.toLowerCase()} again (use the upload button)`;
      continue;
    }
    value[f.key] = t;
  }
  return { errors, value };
}
