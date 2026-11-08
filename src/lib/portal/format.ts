/**
 * Small display helpers for the store / rider / customer portals (QA M11, O6).
 * Pure — safe on client and server.
 */

/** "1 order", "2 orders", "0 orders". Pass `pluralWord` for irregular words. */
export function plural(count: number, word: string, pluralWord?: string): string {
  const n = Number.isFinite(count) ? count : 0;
  const w = n === 1 ? word : pluralWord || `${word}s`;
  return `${n.toLocaleString("en-PK")} ${w}`;
}

/** Mask an account / phone / IBAN so only the last 4 characters show: "****4567". */
export function maskTail(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  const clean = String(value).replace(/[\s-]/g, "");
  if (!clean) return null;
  if (clean.length <= visible) return `****${clean}`;
  return `****${clean.slice(-visible)}`;
}
