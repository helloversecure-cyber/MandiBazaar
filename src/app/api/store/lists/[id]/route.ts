import { requireStorePortal } from "@/lib/auth/auth";
import { listErrorResponse } from "@/lib/lists/http";
import { listForStore } from "@/lib/lists/store-bids";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** One list as my store sees it, with my offer. ?storeId= when I have several stores. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireStorePortal();
    const storeId = new URL(req.url).searchParams.get("storeId");
    return apiSuccess(await listForStore({ id: session.user.id }, params.id, storeId));
  } catch (e) {
    return listErrorResponse(e, "store:lists:id:get");
  }
}
