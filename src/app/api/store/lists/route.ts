import { requireStorePortal } from "@/lib/auth/auth";
import { listErrorResponse } from "@/lib/lists/http";
import { listsForStore } from "@/lib/lists/store-bids";
import { apiSuccess, paginationMeta, parsePagination } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Lists sent to my store(s). ?filter=open (default) | all, ?storeId= */
export async function GET(req: Request) {
  try {
    const session = await requireStorePortal();
    const sp = new URL(req.url).searchParams;
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
    const filter = sp.get("filter") === "all" ? "all" : "open";
    const { total, items } = await listsForStore({ id: session.user.id }, { storeId: sp.get("storeId"), filter, skip, take });
    return apiSuccess({ items, pagination: paginationMeta(page, limit, total) });
  } catch (e) {
    return listErrorResponse(e, "store:lists:get");
  }
}
