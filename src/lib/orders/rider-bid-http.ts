/** Error → response mapping for the customer's rider-bid routes. */
import { BiddingError } from "@/lib/orders/bidding";
import { apiError } from "@/lib/utils";
import { reportServerError } from "@/lib/monitoring/alerts";

export function riderBidErrorResponse(e: unknown, tag: string): Response {
  if (e instanceof BiddingError) return apiError(e.message, e.status, e.code);
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED") return apiError("Please sign in", 401);
  if (msg === "FORBIDDEN") return apiError("Not allowed", 403);
  console.error(`[${tag}]`, e);
  reportServerError(e, { source: `rider-bids/${tag}` });
  return apiError("Something went wrong. Please try again in a few moments.", 500);
}
