import { NextRequest } from "next/server";
import { requireRider } from "@/lib/auth/auth";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import { BiddingError, listRequestsForRider, submitBid } from "@/lib/orders/bidding";
import { withdrawPostPackBid } from "@/lib/orders/post-pack-bidding";
import { parseRiderLocation, saveRiderLocation } from "@/lib/riders/location";

function handle(e: unknown) {
  if (e instanceof BiddingError) return apiError(e.message, e.status, e.code);
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    if (
      e.message === "FORBIDDEN" ||
      e.message === "RIDER_NOT_APPROVED" ||
      e.message === "RIDER_PENDING_APPROVAL"
    ) {
      return apiError("Your rider account is awaiting MandiBazaar approval.", 403);
    }
  }
  console.error("[rider-bids]", e);
  return apiError(toUserMessage(e), 500);
}

/**
 * Open delivery requests this rider can bid on (+ their own bid, if any).
 * Optional `?lat=&lng=` saves the rider's current position first, so nearby
 * after-packing requests (item-list orders) are matched by distance.
 */
export async function GET(req: NextRequest) {
  try {
    const { rider } = await requireRider();
    const lat = req.nextUrl.searchParams.get("lat");
    const lng = req.nextUrl.searchParams.get("lng");
    if (lat != null && lng != null) {
      const loc = parseRiderLocation({ latitude: lat, longitude: lng });
      if (!loc) return apiError("Invalid location.", 400, "BAD_LOCATION");
      await saveRiderLocation(rider.id, loc);
    }
    return apiSuccess(await listRequestsForRider(rider.id));
  } catch (e) {
    return handle(e);
  }
}

/** Submit or update a delivery-fee bid. */
export async function POST(req: Request) {
  try {
    const { rider } = await requireRider();
    const rl = rateLimit(`bid-submit:${rider.id}`, 60, 60_000);
    if (!rl.ok) return apiError("Please slow down a little.", 429);
    const body = (await req.json().catch(() => ({}))) as { requestId?: string; amount?: unknown; note?: string };
    if (!body.requestId) return apiError("Missing delivery request.", 400);
    const bid = await submitBid({
      riderId: rider.id,
      requestId: body.requestId,
      amount: Number(body.amount),
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return apiSuccess({ bidId: bid.id, amount: Number(bid.amount), status: bid.status });
  } catch (e) {
    return handle(e);
  }
}

/** Withdraw this rider's bid on an after-packing request: `?requestId=` or body `{ requestId }`. */
export async function DELETE(req: Request) {
  try {
    const { rider } = await requireRider();
    const rl = rateLimit(`bid-submit:${rider.id}`, 60, 60_000);
    if (!rl.ok) return apiError("Please slow down a little.", 429);
    const fromQuery = new URL(req.url).searchParams.get("requestId");
    const body = fromQuery ? {} : ((await req.json().catch(() => ({}))) as { requestId?: string });
    const requestId = fromQuery || body.requestId;
    if (!requestId) return apiError("Missing delivery request.", 400);
    return apiSuccess(await withdrawPostPackBid(rider.id, requestId));
  } catch (e) {
    return handle(e);
  }
}
