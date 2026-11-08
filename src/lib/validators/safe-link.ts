/**
 * Links an admin can put behind a banner/button.
 * Allowed: internal paths ("/products", "/stores/x?y=1") or absolute https:// URLs.
 * Rejected: javascript:, data:, protocol-relative "//evil.com", http://, junk text.
 */
export function isSafeLink(raw: string | null | undefined): boolean {
  const v = (raw || "").trim();
  if (!v || v.length > 500) return false;
  if (/[\s<>"'`\\]/.test(v)) return false;
  if (v.startsWith("/")) return !v.startsWith("//");
  try {
    const u = new URL(v);
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** Returns the link if safe, else the fallback (used when rendering stored data). */
export function safeLinkOr(raw: string | null | undefined, fallback = "/products"): string {
  return isSafeLink(raw) ? (raw as string).trim() : fallback;
}
