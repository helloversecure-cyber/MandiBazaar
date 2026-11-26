import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listErrorResponse } from "@/lib/lists/http";
import { adminListDetail } from "@/lib/lists/admin";
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
