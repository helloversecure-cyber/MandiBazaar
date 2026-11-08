import { getSession } from "@/lib/auth/auth";
import { getStoreLoginBlockReason } from "@/lib/stores/access";
import { apiError, apiSuccess } from "@/lib/utils";

/** Lightweight check: can this user open the store portal? */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return apiError("Unauthorized", 401);
    }

    if (session.user.role === "SUPER_ADMIN") {
      return apiSuccess({ allowed: true, reason: null });
    }

    if (session.user.role !== "STORE_OWNER") {
      return apiSuccess({
        allowed: false,
        reason: "This account is not a store owner.",
      });
    }

    const reason = await getStoreLoginBlockReason(session.user.id);
    return apiSuccess({
      allowed: !reason,
      reason,
    });
  } catch {
    return apiError("Failed to check store access", 500);
  }
}
