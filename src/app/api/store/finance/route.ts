import { requireStorePortal } from "@/lib/auth/auth";
import { getUserStoreIds } from "@/lib/stores/access";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { storeFinanceDashboard, storeOrderBreakdown } from "@/lib/finance/store-dashboard";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Store Owner financial dashboard data (own stores only — enforced on the backend).
 * `?format=csv` streams the order-wise statement as a downloadable CSV.
 */
export async function GET(req: Request) {
  try {
    const session = await requireStorePortal();
    const storeIds = await getUserStoreIds(session.user.id);
    if (storeIds.length === 0) {
      return apiSuccess({ empty: true, reason: "No approved store yet." });
    }
    const data = await storeFinanceDashboard(storeIds);
    if (!data) return apiSuccess({ empty: true });

    const url = new URL(req.url);
    if (url.searchParams.get("format") === "csv") {
      // The dashboard breakdown is capped (200) for a snappy UI; the CSV statement
      // should be complete, so pull the full order history for the export.
      const fullBreakdown = await storeOrderBreakdown(storeIds, 10000);
      const header = [
        "Order",
        "Date",
        "Status",
        "Payment",
        "Gross (PKR)",
        "Discount",
        "Commission",
        "Net (PKR)",
        "Settlement",
        "Payout Ref",
      ];
      const rows = fullBreakdown.map((o) =>
        [
          o.orderNumber,
          new Date(o.date).toISOString().slice(0, 10),
          o.orderStatus,
          o.paymentStatus,
          o.gross,
          o.discount,
          o.commission,
          o.net,
          o.settled ? "Settled" : "Pending",
          o.payoutReference ?? "",
        ]
          .map(csvEscape)
          .join(",")
      );
      const csv = [header.join(","), ...rows].join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="store-earnings-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return apiSuccess(data);
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
      if (e.message === "FORBIDDEN" || e.message === "STORE_NOT_APPROVED") {
        return apiError("Your store isn't approved yet.", 403);
      }
    }
    console.error("[store-finance]", e);
    return apiError(toUserMessage(e), 500);
  }
}
