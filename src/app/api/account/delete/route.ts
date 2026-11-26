import { requireAuth } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { DeletionError, requestAccountDeletion } from "@/lib/account/deletion";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Close the signed-in account. Body: { confirm: "DELETE" } */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => null);
    if (body?.confirm !== "DELETE") return apiError('Type DELETE to confirm', 400, "CONFIRM_REQUIRED");
    return apiSuccess(await requestAccountDeletion(session.user.id, requestMetaFromHeaders(req.headers)));
  } catch (e) {
    if (e instanceof DeletionError) return apiError(e.message, e.status, e.code);
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in", 401);
    console.error("[account:delete]", e);
    return apiError("Something went wrong. Please try again in a few moments.", 500);
  }
}
