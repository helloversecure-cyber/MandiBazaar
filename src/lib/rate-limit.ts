/**
 * Rate limiter for API routes, shared by every server instance.
 *
 * Counts live in Upstash Redis (connected through the Vercel Marketplace:
 * RATELIMIT_KV_REST_API_URL / RATELIMIT_KV_REST_API_TOKEN), so a limit holds
 * however many instances Vercel runs and across cold starts. Without Redis
 * (local dev, tests) or when Redis is slow or down, it falls back to an
 * in-memory count per instance: requests are never refused because Redis is
 * unavailable.
 *
 * Fixed window: one counter per key per window, expiring with the window.
 */

type Result = { ok: boolean; remaining: number };

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Longest we wait for Redis before using the in-memory count. */
const REDIS_TIMEOUT_MS = 800;
const KEY_PREFIX = "mb:rl:";

function memoryRateLimit(key: string, limit: number, windowMs: number): Result {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { ok: false, remaining: 0 };
  }

  entry.count += 1;
  return { ok: true, remaining: limit - entry.count };
}

function redisConfig(): { url: string; token: string } | null {
  const url =
    process.env.RATELIMIT_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.RATELIMIT_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

/** True when limits are shared through Redis (for /api/health). */
export function sharedRateLimitConfigured(): boolean {
  return redisConfig() !== null;
}

/** INCR the window's counter and set its expiry, in one round trip. */
async function redisCount(
  cfg: { url: string; token: string },
  key: string,
  windowMs: number,
): Promise<number> {
  const windowKey = `${KEY_PREFIX}${key}:${Math.floor(Date.now() / windowMs)}`;
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", windowKey],
      ["PEXPIRE", windowKey, String(windowMs)],
    ]),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Rate limit store HTTP ${res.status}`);
  const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  const count = Number(data?.[0]?.result);
  if (!Number.isFinite(count)) throw new Error(data?.[0]?.error || "Rate limit store: bad reply");
  return count;
}

let warned = false;

export async function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
): Promise<Result> {
  const cfg = redisConfig();
  if (!cfg) return memoryRateLimit(key, limit, windowMs);
  try {
    const count = await redisCount(cfg, key, windowMs);
    return { ok: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (e) {
    // Never refuse a request because the store is down; log once per instance.
    if (!warned) {
      warned = true;
      console.warn("[rate-limit] Redis unavailable, using in-memory limits:", (e as Error).message);
    }
    return memoryRateLimit(key, limit, windowMs);
  }
}

/** Test helper: forget in-memory counts. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  warned = false;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
