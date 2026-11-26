import { requireAuth } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { acceptOffer, acceptOfferSchema } from "@/lib/lists/accept";
import { listErrorResponse } from "@/lib/lists/http";
import { firstIssue } from "@/lib/lists/validation";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Accept one store's offer: the list becomes a confirmed cash-on-delivery order.
 * Body: { bidId, addressId, idempotencyKey, listVersion?, expectedTotal? }.
 * Same idempotencyKey again → the same order (200, reused: true).
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    if (!rateLimit(`list-accept:${session.user.id}`, 20, 60_000).ok) return apiError("Too many requests", 429);
    const parsed = acceptOfferSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const { message, field } = firstIssue(parsed.error);
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    const result = await acceptOffer(
      { id: session.user.id, email: session.user.email },
      params.id,
      parsed.data,
      requestMetaFromHeaders(req.headers)
    );
    return apiSuccess(result, result.reused ? 200 : 201);
  } catch (e) {
    return listErrorResponse(e, "lists:accept");
  }
}
