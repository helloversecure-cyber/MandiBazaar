import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listErrorResponse } from "@/lib/lists/http";
import { getListSettingsForAdmin, listSettingsSchema, saveListSettings } from "@/lib/lists/admin";
import { apiSuccess, apiZodError } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** List-bidding switch, radius / window / store limits, and the beta testers (read-only, from env). */
export async function GET() {
  try {
    await requireAdmin(PERMISSIONS.SETTINGS_WRITE);
    return apiSuccess(await getListSettingsForAdmin());
  } catch (e) {
    return listErrorResponse(e, "admin:lists:settings:get");
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.SETTINGS_WRITE);
    const parsed = listSettingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiZodError(parsed.error);
    return apiSuccess(await saveListSettings({ id: session.user.id }, parsed.data));
  } catch (e) {
    return listErrorResponse(e, "admin:lists:settings:put");
  }
}
