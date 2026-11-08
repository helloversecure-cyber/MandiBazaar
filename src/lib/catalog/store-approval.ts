/**
 * Store approval guard (QA N7 / P4). Pure — safe for the client and the server.
 *
 * A store may only be approved (or reactivated) when the platform can pay it
 * (valid bank account number OR IBAN OR JazzCash number) and when its map
 * location is known (latitude + longitude inside Pakistan), so distance-based
 * delivery fees work.
 */
import { normalizeBankAccount, normalizePkIban, normalizePkMobile } from "@/lib/validators/pk";

export type StoreApprovalFields = {
  bankAccountNumber?: string | null;
  bankIban?: string | null;
  jazzCashNumber?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type StoreApprovalGap = "payout" | "location";

export const STORE_APPROVAL_GAP_LABEL: Record<StoreApprovalGap, string> = {
  payout: "payout details",
  location: "map location",
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasValidPayoutMethod(s: StoreApprovalFields): boolean {
  return Boolean(
    normalizeBankAccount(s.bankAccountNumber ?? null) ||
      normalizePkIban(s.bankIban ?? null) ||
      normalizePkMobile(s.jazzCashNumber ?? null)
  );
}

export function hasValidLocation(s: StoreApprovalFields): boolean {
  const lat = num(s.latitude);
  const lng = num(s.longitude);
  return lat != null && lng != null && lat >= 23 && lat <= 37 && lng >= 60 && lng <= 78;
}

/** What is still missing before this store can be approved ([] = ready). */
export function storeApprovalGaps(s: StoreApprovalFields): StoreApprovalGap[] {
  const gaps: StoreApprovalGap[] = [];
  if (!hasValidPayoutMethod(s)) gaps.push("payout");
  if (!hasValidLocation(s)) gaps.push("location");
  return gaps;
}

/** "Missing: payout details, map location" (or "" when ready). */
export function storeApprovalMissingText(gaps: StoreApprovalGap[]): string {
  if (!gaps.length) return "";
  return `Missing: ${gaps.map((g) => STORE_APPROVAL_GAP_LABEL[g]).join(", ")}`;
}

/** Full sentence for API errors / tooltips. */
export function storeApprovalErrorMessage(gaps: StoreApprovalGap[]): string {
  if (!gaps.length) return "";
  const parts: string[] = [];
  if (gaps.includes("payout")) {
    parts.push("payout details (a valid bank account number, IBAN or JazzCash number)");
  }
  if (gaps.includes("location")) {
    parts.push("map location (latitude and longitude)");
  }
  return `This store can't be approved yet. Missing: ${parts.join(" and ")}. Ask the owner to add them in Store profile.`;
}
