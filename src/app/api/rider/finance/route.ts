import { requireRider } from "@/lib/auth/auth";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { riderFinanceDashboard } from "@/lib/finance/rider-dashboard";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rider's own earnings dashboard (own data only). `?format=csv` downloads the statement. */
export async function GET(req: Request) {
  try {
    const { rider } = await requireRider({ allowPending: true });
    const data = await riderFinanceDashboard(rider.id);

    const url = new URL(req.url);
    if (url.searchParams.get("format") === "csv") {
      const header = ["Order", "Delivered", "Distance (km)", "Delivery fee (PKR)", "Status"];
      const rows = data.deliveries.map((d) =>
        [
          d.orderNumber,
          d.deliveredAt ? new Date(d.deliveredAt).toISOString().slice(0, 10) : "",
          d.distanceKm ?? "",
          d.pay,
          d.paid ? "Paid" : "Pending",
        ]
          .map(csvEscape)
          .join(",")
      );
      const csv = [header.join(","), ...rows].join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rider-earnings-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return apiSuccess(data);
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
      if (e.message === "FORBIDDEN") return apiError("Your rider account isn't active yet.", 403);
    }
    console.error("[rider-finance]", e);
    return apiError(toUserMessage(e), 500);
  }
}
