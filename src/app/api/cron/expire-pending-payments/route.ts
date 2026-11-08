import { NextRequest } from "next/server";
import { expirePendingPayments } from "@/lib/orders/expire-pending";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
  if (secret) return auth === `Bearer ${secret}`;
  // No secret: fail CLOSED in production — the x-vercel-cron header is client-spoofable
  // and must not be trusted as the only gate. Set CRON_SECRET in production.
  if (process.env.NODE_ENV === "production") return false;
  const ua = req.headers.get("user-agent") || "";
  return req.headers.get("x-vercel-cron") === "1" || ua.startsWith("vercel-cron/");
}

/** Vercel Cron + manual: cancel every unpaid PENDING_PAYMENT order past the payment window */
export async function GET(req: NextRequest) {
  try {
    if (!authorized(req)) {
      return apiError("Unauthorized", 401);
    }
    const result = await expirePendingPayments({ limit: 50, maxOrders: 1000 });
    return apiSuccess(result);
  } catch (e) {
    console.error("[cron/expire-pending-payments]", e);
    return apiError("Expire job failed", 500);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
