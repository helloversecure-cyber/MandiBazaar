import { requireStorePortal } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { listErrorResponse } from "@/lib/lists/http";
import { bidSchema, submitBid, withdrawBid } from "@/lib/lists/store-bids";
import { firstIssue } from "@/lib/lists/validation";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };

/** Make or update my offer. Body: { storeId?, lines: [{ lineId, available, unitPrice? }], discount?, prepMinutes?, note? } */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireStorePortal();
    if (!rateLimit(`store-bid:${session.user.id}`, 60, 60_000).ok) return apiError("Too many requests", 429);
    const parsed = bidSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const { message, field } = firstIssue(parsed.error);
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    const bid = await submitBid({ id: session.user.id }, params.id, parsed.data, requestMetaFromHeaders(req.headers));
    return apiSuccess(bid);
  } catch (e) {
    return listErrorResponse(e, "store:bid:put");
  }
}

/** Withdraw my open offer. ?storeId= when I have several stores. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const session = await requireStorePortal();
    const storeId = new URL(req.url).searchParams.get("storeId");
    return apiSuccess(await withdrawBid({ id: session.user.id }, params.id, storeId, requestMetaFromHeaders(req.headers)));
  } catch (e) {
    return listErrorResponse(e, "store:bid:delete");
  }
}
