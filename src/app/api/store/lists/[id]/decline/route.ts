import { requireStorePortal } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { listErrorResponse } from "@/lib/lists/http";
import { declineList } from "@/lib/lists/store-bids";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** "Can't supply" this list. Body: { storeId? } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireStorePortal();
    const body = await req.json().catch(() => ({}));
    const storeId = typeof body?.storeId === "string" ? body.storeId : null;
    return apiSuccess(await declineList({ id: session.user.id }, params.id, storeId, requestMetaFromHeaders(req.headers)));
  } catch (e) {
    return listErrorResponse(e, "store:decline");
  }
}
