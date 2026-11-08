import { requireAuth } from "@/lib/auth/auth";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import {
  BiddingError,
  acceptBid,
  cancelRequest,
  getCustomerRequest,
  openDeliveryRequest,
} from "@/lib/orders/bidding";

function handle(e: unknown) {
  if (e instanceof BiddingError) return apiError(e.message, 400, e.code);
  if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
  console.error("[delivery-request]", e);
  return apiError(toUserMessage(e), 500);
}

/** Open (or refresh) the delivery request for the signed-in customer's cart. */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const rl = rateLimit(`bid-open:${session.user.id}`, 20, 60_000);
    if (!rl.ok) return apiError("Please wait a moment before trying again.", 429);
    const body = (await req.json().catch(() => ({}))) as { addressId?: unknown };
    if (typeof body.addressId !== "string" || !body.addressId) {
      return apiError("Please choose a delivery address first.", 400);
    }
    const r = await openDeliveryRequest(session.user.id, body.addressId);
    return apiSuccess({ requestId: r.id, expiresAt: r.expiresAt });
  } catch (e) {
    return handle(e);
  }
}

/** The customer's current request + live bids (polled by the "choose your rider" step). */
export async function GET() {
  try {
    const session = await requireAuth();
    const request = await getCustomerRequest(session.user.id);
    return apiSuccess({ request });
  } catch (e) {
    return handle(e);
  }
}

/** Accept a bid, or cancel the request. */
export async function PATCH(req: Request) {
  try {
    const session = await requireAuth();
    const rl = rateLimit(`bid-accept:${session.user.id}`, 30, 60_000);
    if (!rl.ok) return apiError("Please wait a moment before trying again.", 429);
    const body = (await req.json().catch(() => ({}))) as { action?: string; bidId?: string; requestId?: string };
    if (body.action === "accept") {
      if (!body.bidId) return apiError("Please choose a rider.", 400);
      const result = await acceptBid(session.user.id, body.bidId);
      return apiSuccess({ accepted: true, fee: result.amount, riderId: result.riderId });
    }
    if (body.action === "cancel") {
      if (!body.requestId) return apiError("Nothing to cancel.", 400);
      await cancelRequest(session.user.id, body.requestId);
      return apiSuccess({ cancelled: true });
    }
    return apiError("That action isn't supported.", 400);
  } catch (e) {
    return handle(e);
  }
}
