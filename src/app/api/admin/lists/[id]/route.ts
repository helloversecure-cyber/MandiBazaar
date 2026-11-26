import { requireAdmin } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listErrorResponse } from "@/lib/lists/http";
import { adminCancelList, adminListActionSchema, adminListDetail } from "@/lib/lists/admin";
import { firstIssue } from "@/lib/lists/validation";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** One list's full record: broadcasts (seen / declined), every offer, accept and audit history. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(PERMISSIONS.ORDERS_READ);
    return apiSuccess(await adminListDetail(params.id));
  } catch (e) {
    return listErrorResponse(e, "admin:lists:id:get");
  }
}

/**
 * I-03: admin action on a list. Body: { action: "CANCEL", reason }.
 * Cancels a BIDDING / NO_STORES list; 409 ORDER_PLACED once accepted, 409 LIST_CLOSED otherwise.
 * Returns the updated list detail.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireAdmin(PERMISSIONS.ORDERS_WRITE);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, error: "Invalid request" }, { status: 400 });
    }
    const parsed = adminListActionSchema.safeParse(body);
    if (!parsed.success) {
      const { message, field } = firstIssue(parsed.error);
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    return apiSuccess(
      await adminCancelList({ id: session.user.id }, params.id, parsed.data.reason, requestMetaFromHeaders(req.headers))
    );
  } catch (e) {
    return listErrorResponse(e, "admin:lists:id:patch");
  }
}
