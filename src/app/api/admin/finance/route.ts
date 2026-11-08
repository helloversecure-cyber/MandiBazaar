import { requireSuperAdmin } from "@/lib/auth/auth";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { adminFinanceOverview } from "@/lib/finance/admin-dashboard";

/** Platform-wide financial control center (Super Admin only — enforced on the backend). */
export async function GET() {
  try {
    await requireSuperAdmin();
    return apiSuccess(await adminFinanceOverview());
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
      if (e.message === "FORBIDDEN") return apiError("You don't have access to this.", 403);
    }
    console.error("[admin-finance]", e);
    return apiError(toUserMessage(e), 500);
  }
}
