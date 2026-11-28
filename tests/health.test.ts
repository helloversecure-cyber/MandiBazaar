/**
 * /api/health for uptime monitors: 200 with a reachable database, 503 without,
 * and nothing more than that in the reply.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { describeDb } from "./helpers/describe-db";

describeDb("health", () => {
  it("database reachable: 200, not cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
  });
});

describe("health without a database", () => {
  const original = prisma.$queryRaw;
  afterEach(() => {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
  });

  it("database down: 503 and no error details", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=secret"));
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "error", db: "unreachable" });
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("secret");
    err.mockRestore();
  });
});
