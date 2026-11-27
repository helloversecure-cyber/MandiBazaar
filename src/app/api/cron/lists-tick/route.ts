import { NextRequest } from "next/server";
import { tickDueLists } from "@/lib/lists/broadcast";
import { tickDuePostPackRequests } from "@/lib/orders/post-pack-bidding";
import { apiError, apiSuccess } from "@/lib/utils";
import { reportServerError } from "@/lib/monitoring/alerts";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Widen / expire item lists that are due. Point an external cron (e.g. every
 * 5 minutes) at this with `Authorization: Bearer $CRON_SECRET`; lists also
 * advance whenever a customer or store opens them, and in the daily cron.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return apiError("Unauthorized", 401);
  try {
    const lists = await tickDueLists({ limit: 200 });
    // After-packing rider bidding on list orders: re-open once, then hand over to admin.
    const riderBids = await tickDuePostPackRequests({ limit: 200 });
    return apiSuccess({ ...lists, riderBids });
  } catch (e) {
    console.error("[cron/lists-tick]", e);
    reportServerError(e, { source: "cron/lists-tick", method: req.method, route: "/api/cron/lists-tick" });
    return apiError("Lists tick failed", 500);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
