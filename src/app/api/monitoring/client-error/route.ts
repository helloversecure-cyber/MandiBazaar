import { NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/monitoring/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 8_000;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Crash reports from app/global-error.tsx (the whole page failed to render).
 * Accepts only a small JSON body {name, message, digest, stack, path}; nothing
 * else from the request is used. Rate limited per IP and throttled by the
 * alerter, so it cannot be used to flood the inbox. Always answers 204.
 */
export async function POST(req: NextRequest) {
  const done = () => new Response(null, { status: 204 });
  try {
    if (!(await rateLimit(`client-error:${clientIp(req)}`, 5, 60_000)).ok) return done();
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) return done();
    const raw = await req.text();
    if (!raw || raw.length > MAX_BODY) return done();
    const body = JSON.parse(raw) as Record<string, unknown>;
    const err = new Error(str(body.message, 500) || "(no message)");
    err.name = str(body.name, 80) || "ClientError";
    err.stack = `${err.name}: ${err.message}\n${str(body.stack, 4000)}`;
    const path = str(body.path, 200).split("?")[0] || "/";
    const digest = str(body.digest, 40);
    reportServerError(err, {
      source: "client/global-error",
      kind: "client crash",
      route: path,
      requestId: digest ? `digest ${digest}` : undefined,
    });
  } catch {
    // ignore malformed reports
  }
  return done();
}
