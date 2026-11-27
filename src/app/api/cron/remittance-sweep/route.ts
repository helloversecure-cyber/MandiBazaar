import { NextRequest } from "next/server";
import { sweepOverdueRemittances } from "@/lib/finance/remittance";
import { apiError, apiSuccess } from "@/lib/utils";
import { reportServerError } from "@/lib/monitoring/alerts";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Backend scheduled job (never depends on a browser): mark overdue COD remittances
 * and auto-restrict the owing riders from new delivery assignments. Idempotent.
 */
export async function GET(req: NextRequest) {
  try {
    if (!cronAuthorized(req)) return apiError("Unauthorized", 401);
    const result = await sweepOverdueRemittances();
    return apiSuccess(result);
  } catch (e) {
    console.error("[cron/remittance-sweep]", e);
    reportServerError(e, { source: "cron/remittance-sweep", method: req.method, route: "/api/cron/remittance-sweep" });
    return apiError("Remittance sweep failed", 500);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
