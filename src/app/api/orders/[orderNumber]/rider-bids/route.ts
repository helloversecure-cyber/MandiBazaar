import { requireAuth } from "@/lib/auth/auth";
import { getOrderRiderBids } from "@/lib/orders/post-pack-bidding";
import { apiSuccess } from "@/lib/utils";
import { riderBidErrorResponse } from "@/lib/orders/rider-bid-http";

export const dynamic = "force-dynamic";

type Ctx = { params: { orderNumber: string } };

/**
 * Rider bids on the customer's own item-list order (after the store packed it).
 * Rider name, vehicle, completed deliveries and fee; the rider's phone only
 * once the customer has chosen them. Other people's orders and cart orders → 404.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    return apiSuccess(await getOrderRiderBids(session.user.id, params.orderNumber));
  } catch (e) {
    return riderBidErrorResponse(e, "orders:rider-bids");
  }
}
