import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listErrorResponse } from "@/lib/lists/http";
import { LIST_STATUSES, adminListsOverview, adminNeedsRiderQueue, type AdminListStatusFilter } from "@/lib/lists/admin";
import { tickDuePostPackRequests } from "@/lib/orders/post-pack-bidding";
import { apiSuccess, paginationMeta, parsePagination } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Admin item-list oversight.
 *   ?view=needs-rider               after-packing requests with no rider bid (+ ones still bidding)
 *   ?status=BIDDING|…|ALL&q=&page=  every list with offer counts and its order
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(PERMISSIONS.ORDERS_READ);
    const sp = new URL(req.url).searchParams;
    if (sp.get("view") === "needs-rider") {
      // Lazy timers: move due requests to NO_BIDS before showing the queue.
      await tickDuePostPackRequests({ limit: 50 }).catch((e) => console.error("[admin-lists] tick", e));
      return apiSuccess(await adminNeedsRiderQueue());
    }
    const raw = (sp.get("status") || "ALL").toUpperCase();
    const status: AdminListStatusFilter = (LIST_STATUSES as readonly string[]).includes(raw) ? (raw as AdminListStatusFilter) : "ALL";
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
    const { total, counts, items } = await adminListsOverview({ status, q: sp.get("q"), skip, take });
    return apiSuccess({ items, counts, pagination: paginationMeta(page, limit, total) });
  } catch (e) {
    return listErrorResponse(e, "admin:lists:get");
  }
}
