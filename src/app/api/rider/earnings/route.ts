/**
 * Rider "My earnings" (owner decision 7): pay per period, unpaid balance,
 * payout history and per-delivery pay. GET ?page=&payoutPage=
 */
import { NextRequest } from "next/server";
import { requireRider } from "@/lib/auth/auth";
import { apiError, apiSuccess, paginationMeta, parsePagination } from "@/lib/utils";
import { riderEarningsPeriods } from "@/lib/portal/rider-profile";
import { describeRiderPayRule, RIDER_PAYOUT_METHOD_LABELS, type RiderPayoutMethod } from "@/lib/riders/pay";
import { riderEarningsOverview } from "@/lib/riders/earnings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { rider } = await requireRider({ allowPending: true });
    const sp = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
    const payoutPage = Math.max(1, Math.min(10000, parseInt(sp.get("payoutPage") || "1", 10) || 1));
    const payoutLimit = 10;

    const o = await riderEarningsOverview(rider.id, riderEarningsPeriods(), {
      page,
      limit,
      payoutPage,
      payoutLimit,
    });

    return apiSuccess({
      pendingApproval: rider.approvalStatus !== "APPROVED" || !rider.isActive,
      payRule: describeRiderPayRule(o.settings),
      periods: o.summary.periods,
      unpaid: o.summary.unpaid,
      paid: o.summary.paid,
      deliveries: o.deliveries,
      deliveriesPagination: paginationMeta(page, limit, o.deliveriesTotal),
      payouts: o.payouts.map((p) => ({
        ...p,
        methodLabel: p.method ? RIDER_PAYOUT_METHOD_LABELS[p.method as RiderPayoutMethod] || p.method : null,
      })),
      payoutsPagination: paginationMeta(payoutPage, payoutLimit, o.payoutTotal),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[rider/earnings]", e);
    return apiError("Could not load your earnings", 500);
  }
}
