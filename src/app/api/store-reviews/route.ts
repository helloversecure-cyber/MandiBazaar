import { requireAuth } from "@/lib/auth/auth";
import { apiError, apiSuccess, apiZodError } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import {
  StoreReviewError,
  createStoreReview,
  findOwnStoreReview,
  storeReviewSchema,
} from "@/lib/stores/reviews";

export const dynamic = "force-dynamic";

function errorResponse(e: unknown, tag: string): Response {
  if (e instanceof StoreReviewError) return apiError(e.message, e.status, e.code);
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED") return apiError("Please sign in", 401);
  if (msg === "FORBIDDEN") return apiError("Not allowed", 403);
  console.error(`[${tag}]`, e);
  return apiError("Something went wrong. Please try again in a few moments.", 500);
}

/**
 * W9: the customer's rating of the store on their own order.
 * GET ?orderId=… (or ?orderNumber=…) → { orderId, orderNumber, canRate, stores, review }
 * Another customer's order → 404.
 */
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const orderId = sp.get("orderId")?.trim();
    const orderNumber = sp.get("orderNumber")?.trim();
    if (!orderId && !orderNumber) return apiError("orderId is required", 400);
    return apiSuccess(await findOwnStoreReview(session.user.id, { orderId, orderNumber }));
  } catch (e) {
    return errorResponse(e, "store-reviews:GET");
  }
}

/**
 * POST { orderId, rating 1-5, comment?, storeId? } → 201 with the rating and the
 * store's new average. Not delivered → 400, not yours → 404, rated already → 409.
 */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const rl = await rateLimit(`store-review:${session.user.id}`, 10, 60_000);
    if (!rl.ok) return apiError("Too many ratings — please wait a minute.", 429);
    const parsed = storeReviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return apiZodError(parsed.error);
    return apiSuccess(await createStoreReview({ id: session.user.id }, parsed.data), 201);
  } catch (e) {
    return errorResponse(e, "store-reviews:POST");
  }
}
