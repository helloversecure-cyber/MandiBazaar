/**
 * Shared rate limits (Upstash Redis over REST, in-memory fallback).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimitsForTests, sharedRateLimitConfigured } from "@/lib/rate-limit";

const ENV = ["RATELIMIT_KV_REST_API_URL", "RATELIMIT_KV_REST_API_TOKEN"] as const;

/** A fake Upstash REST pipeline: one counter store shared by all callers. */
function fakeUpstash() {
  const counts = new Map<string, number>();
  const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as string[][];
    calls.push({ url, auth: new Headers(init.headers).get("authorization"), body });
    const key = body[0][1];
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return new Response(JSON.stringify([{ result: n }, { result: 1 }]), { status: 200 });
  });
  return { counts, calls, fetchMock };
}

describe("rate limit", () => {
  beforeEach(() => resetRateLimitsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV) delete process.env[k];
  });

  it("without Redis: counts in memory and refuses after the limit", async () => {
    expect(sharedRateLimitConfigured()).toBe(false);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit("t:mem", 3, 60_000)).ok);
    expect(results).toEqual([true, true, true, false]);
  });

  describe("with Redis", () => {
    beforeEach(() => {
      process.env.RATELIMIT_KV_REST_API_URL = "https://redis.example/";
      process.env.RATELIMIT_KV_REST_API_TOKEN = "secret-token";
    });

    it("counts in Redis: the limit holds across server instances", async () => {
      const up = fakeUpstash();
      vi.stubGlobal("fetch", up.fetchMock);
      expect(sharedRateLimitConfigured()).toBe(true);
      // Five calls as if from different instances: memory is reset between
      // them, yet the shared count still refuses the 4th onwards.
      const results = [];
      for (let i = 0; i < 5; i++) {
        resetRateLimitsForTests();
        results.push((await rateLimit("t:shared", 3, 60_000)).ok);
      }
      expect(results).toEqual([true, true, true, false, false]);
      expect(up.calls[0].url).toBe("https://redis.example/pipeline");
      expect(up.calls[0].auth).toBe("Bearer secret-token");
      const [incr, expire] = up.calls[0].body as string[][];
      expect(incr[0]).toBe("INCR");
      expect(incr[1]).toMatch(/^mb:rl:t:shared:\d+$/);
      expect(expire).toEqual(["PEXPIRE", incr[1], "60000"]);
    });

    it("remaining counts down", async () => {
      vi.stubGlobal("fetch", fakeUpstash().fetchMock);
      expect((await rateLimit("t:rem", 5)).remaining).toBe(4);
      expect((await rateLimit("t:rem", 5)).remaining).toBe(3);
    });

    it("Redis down: falls back to memory, never refuses because of it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
      const results = [];
      for (let i = 0; i < 3; i++) results.push((await rateLimit("t:down", 2, 60_000)).ok);
      expect(results).toEqual([true, true, false]);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("network error or a bad reply also falls back", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
      expect((await rateLimit("t:err", 2)).ok).toBe(true);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ error: "ERR" }]))));
      expect((await rateLimit("t:err", 2)).ok).toBe(true);
      expect((await rateLimit("t:err", 2)).ok).toBe(false);
      warn.mockRestore();
    });
  });
});
