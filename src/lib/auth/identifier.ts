/**
 * Pure helpers for matching a typed "email or phone" against stored users.
 *
 * New accounts store phones normalised (03XXXXXXXXX), but older rows may hold
 * "0300-1234567", "+923001234567", "92 300 1234567"… so look-ups compare the
 * DIGITS of the stored phone against every digit form of the typed number.
 */
import { normalizeEmail, normalizePkMobile } from "@/lib/validators/pk";

/** Digit-only forms a stored Pakistani mobile may reduce to. Input: "03XXXXXXXXX". */
export function phoneDigitVariants(mobile: string): string[] {
  const rest = mobile.replace(/^0/, ""); // 3XXXXXXXXX
  return [mobile, `92${rest}`, `0092${rest}`, rest];
}

/** Common literal spellings of a mobile (for exact-match fallbacks, e.g. Rider.phone). */
export function phoneLiteralVariants(mobile: string): string[] {
  const rest = mobile.replace(/^0/, "");
  const out = [
    mobile,
    `${mobile.slice(0, 4)}-${mobile.slice(4)}`,
    `${mobile.slice(0, 4)} ${mobile.slice(4)}`,
    `+92${rest}`,
    `92${rest}`,
    `0092${rest}`,
    `+92 ${rest.slice(0, 3)} ${rest.slice(3)}`,
    `+92-${rest.slice(0, 3)}-${rest.slice(3)}`,
    `+92 ${rest.slice(0, 3)}-${rest.slice(3)}`,
    rest,
  ];
  return Array.from(new Set(out));
}

export type ParsedIdentifier =
  | { kind: "phone"; normalized: string; raw: string }
  | { kind: "email"; normalized: string; raw: string }
  | { kind: "invalid"; normalized: null; raw: string };

/** Classify a sign-in / reset identifier. */
export function parseIdentifier(input: unknown): ParsedIdentifier {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw || raw.length > 100) return { kind: "invalid", normalized: null, raw };
  const mobile = normalizePkMobile(raw);
  if (mobile) return { kind: "phone", normalized: mobile, raw };
  const email = normalizeEmail(raw);
  if (email) return { kind: "email", normalized: email, raw };
  return { kind: "invalid", normalized: null, raw };
}

/**
 * Safe internal redirect target: must start with "/" and not "//" or "/\".
 * Anything else (absolute URLs, javascript:, protocol-relative) → fallback.
 */
export function safeCallbackUrl(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (v.length > 500 || /[\u0000-\u001f\s\\]/.test(v)) return fallback;
  // Never bounce back into the sign-in pages themselves
  if (/^\/(login|register|access-denied)(\/|\?|$)/.test(v)) return fallback;
  return v;
}
