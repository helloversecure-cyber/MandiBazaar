import { NextRequest } from "next/server";
import { tickDueLists } from "@/lib/lists/broadcast";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Same rule as the other cron routes: Bearer CRON_SECRET, fail closed in production. */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret) return auth === `Bearer ${secret}`;
  if (process.env.NODE_ENV === "production") return false;
  const ua = req.headers.get("user-agent") || "";
  return req.headers.get("x-vercel-cron") === "1" || ua.startsWith("vercel-cron/");
}

/**
 * Widen / expire item lists that are due. Point an external cron (e.g. every
 * 5 minutes) at this with `Authorization: Bearer $CRON_SECRET`; lists also
 * advance whenever a customer or store opens them, and in the daily cron.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError("Unauthorized", 401);
  try {
    return apiSuccess(await tickDueLists({ limit: 200 }));
  } catch (e) {
    console.error("[cron/lists-tick]", e);
    return apiError("Lists tick failed", 500);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
