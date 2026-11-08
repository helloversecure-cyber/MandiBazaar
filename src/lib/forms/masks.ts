/**
 * Input masks for form fields (shared across signup forms).
 * They only shape what the user types; the zod rules in `@/lib/validators/pk`
 * still validate the result on blur and on the server.
 */

/** CNIC: digits only, max 13, auto-dashed as 5-7-1 (e.g. 35202-1234567-1). */
export function formatCnic(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/**
 * Pakistani mobile: either `+92` then 10 national digits (`+923001234567`),
 * or `0` then up to 11 digits (`03001234567`). Letters and symbols are dropped.
 */
export function formatMobile(raw: string): string {
  const hasPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (hasPlus) {
    // +92 + 10 national digits = 12 digits after the +
    const d = (digits.startsWith("92") ? digits : `92${digits}`).slice(0, 12);
    return `+${d}`;
  }
  // 0XXXXXXXXXX → 11 digits
  return digits.slice(0, 11);
}
