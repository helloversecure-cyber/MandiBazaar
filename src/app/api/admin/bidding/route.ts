import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { BiddingError, listDeliveryRequestsForAdmin, adminCancelRequest } from "@/lib/orders/bidding";

function handle(e: unknown) {
  if (e instanceof BiddingError) return apiError(e.message, 400, e.code);
  if (e instanceof Error && e.message === "FORBIDDEN") return apiError("You don't have access to this.", 403);
  if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
  console.error("[admin-bidding]", e);
  return apiError(toUserMessage(e), 500);
}

/** Live rider-bidding oversight (read). */
export async function GET() {
  try {
    await requireAdmin(PERMISSIONS.RIDERS_WRITE);
    return apiSuccess({ requests: await listDeliveryRequestsForAdmin() });
  } catch (e) {
    return handle(e);
  }
}

/** Admin cancel/intervene on a live delivery request. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(PERMISSIONS.RIDERS_WRITE);
    const body = (await req.json().catch(() => ({}))) as { action?: string; requestId?: string };
    if (body.action === "CANCEL") {
      if (!body.requestId) return apiError("Missing request.", 400);
      const result = await adminCancelRequest(body.requestId);
      await writeAuditLog({
        userId: session.user.id,
        action: "DELIVERY_REQUEST_CANCELLED",
        entity: "DeliveryRequest",
        entityId: body.requestId,
        newValue: { by: "admin" },
      });
      return apiSuccess(result);
    }
    return apiError("Unsupported action.", 400);
  } catch (e) {
    return handle(e);
  }
}
