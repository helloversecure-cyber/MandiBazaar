import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string compare (hashes first, so lengths never leak or throw). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Who may run a cron route. Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
 * when CRON_SECRET is set; that header is compared in constant time.
 * No secret: fail CLOSED in production — the x-vercel-cron header is
 * client-spoofable and must not be the only gate. Set CRON_SECRET in production.
 */
export function cronAuthorized(req: { headers: Headers }): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret) return safeEqual(auth, `Bearer ${secret}`);
  if (process.env.NODE_ENV === "production") return false;
  const ua = req.headers.get("user-agent") || "";
  return req.headers.get("x-vercel-cron") === "1" || ua.startsWith("vercel-cron/");
}
