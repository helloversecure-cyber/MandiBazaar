import { requireAuth } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { acceptPostPackBid, acceptRiderBidSchema } from "@/lib/orders/post-pack-bidding";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess } from "@/lib/utils";
import { riderBidErrorResponse } from "@/lib/orders/rider-bid-http";

export const dynamic = "force-dynamic";

type Ctx = { params: { orderNumber: string; bidId: string } };

/**
 * Accept one rider's delivery bid. Body: { idempotencyKey, expectedAmount? }.
 * 201 on the first accept; 200 with reused: true when this bid already won.
 * 409 when another rider was chosen, the bid changed, or the rider is no longer available.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    if (!(await rateLimit(`rider-bid-accept:${session.user.id}`, 20, 60_000)).ok) return apiError("Too many requests", 429);
    const parsed = acceptRiderBidSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path?.[0] ?? "idempotencyKey");
      const message = issue?.message || "Invalid request";
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    const result = await acceptPostPackBid(
      { id: session.user.id },
      params.orderNumber,
      params.bidId,
      parsed.data,
      requestMetaFromHeaders(req.headers)
    );
    return apiSuccess(result, result.reused ? 200 : 201);
  } catch (e) {
    return riderBidErrorResponse(e, "orders:rider-bids:accept");
  }
}
