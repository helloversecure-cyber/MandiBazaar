import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Uptime check for monitors (UptimeRobot / Better Stack): 200 when the site
 * can reach the database, 503 when it cannot. No details, versions or error
 * text in the reply; the cause goes to the server log only.
 */
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5_000;

export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database timeout")), DB_TIMEOUT_MS)),
    ]);
    return NextResponse.json(
      { status: "ok", db: "ok", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[health] database check failed:", (e as Error).message);
    return NextResponse.json(
      { status: "error", db: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
