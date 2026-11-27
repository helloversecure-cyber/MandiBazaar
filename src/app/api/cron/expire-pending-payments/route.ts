import { NextRequest } from "next/server";
import { expirePendingPayments } from "@/lib/orders/expire-pending";
import { apiError, apiSuccess } from "@/lib/utils";
import { reportServerError } from "@/lib/monitoring/alerts";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron + manual: cancel every unpaid PENDING_PAYMENT order past the payment window */
export async function GET(req: NextRequest) {
  try {
    if (!cronAuthorized(req)) {
      return apiError("Unauthorized", 401);
    }
    const result = await expirePendingPayments({ limit: 50, maxOrders: 1000 });
    // Daily backstop for item lists (best effort; never fails this job).
    const lists = await import("@/lib/lists/broadcast")
      .then((m) => m.tickDueLists({ limit: 500 }))
      .catch((e) => {
        console.error("[cron] lists tick", e);
        reportServerError(e, { source: "cron/daily lists tick", route: "/api/cron/expire-pending-payments" });
        return null;
      });
    // Daily backstop for rider bidding after packing (re-open once / give up).
    const riderBids = await import("@/lib/orders/post-pack-bidding")
      .then((m) => m.tickDuePostPackRequests({ limit: 500 }))
      .catch((e) => {
        console.error("[cron] post-pack rider bids tick", e);
        reportServerError(e, { source: "cron/daily post-pack rider bids tick", route: "/api/cron/expire-pending-payments" });
        return null;
      });
    return apiSuccess({ ...result, lists, riderBids });
  } catch (e) {
    console.error("[cron/expire-pending-payments]", e);
    reportServerError(e, { source: "cron/expire-pending-payments", method: req.method, route: "/api/cron/expire-pending-payments" });
    return apiError("Expire job failed", 500);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
