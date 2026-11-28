import { requireAuth } from "@/lib/auth/auth";
import { apiError, apiSuccess, apiZodError } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import { StoreReviewError, createStoreReview, storeReviewSchema } from "@/lib/stores/reviews";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Same as POST /api/store-reviews, with the store taken from the path
 * (the route name in the bidding plan). Body: { orderId, rating, comment? }.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    const rl = await rateLimit(`store-review:${session.user.id}`, 10, 60_000);
    if (!rl.ok) return apiError("Too many ratings — please wait a minute.", 429);
    const body = await req.json().catch(() => ({}));
    const parsed = storeReviewSchema.safeParse({ ...(body && typeof body === "object" ? body : {}), storeId: params.id });
    if (!parsed.success) return apiZodError(parsed.error);
    return apiSuccess(await createStoreReview({ id: session.user.id }, parsed.data), 201);
  } catch (e) {
    if (e instanceof StoreReviewError) return apiError(e.message, e.status, e.code);
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return apiError("Please sign in", 401);
    console.error("[stores:reviews:POST]", e);
    return apiError("Something went wrong. Please try again in a few moments.", 500);
  }
}
