import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { RemittanceError } from "@/lib/finance/remittance";
import {
  codOverview,
  riderCashLedger,
  codReconciliation,
  pendingRemittanceSubmissions,
  reviewSubmission,
  confirmCashHandover,
  clearRiderRestriction,
} from "@/lib/finance/admin-remittance";

function handle(e: unknown) {
  if (e instanceof RemittanceError) return apiError(e.message, 400, e.code);
  if (e instanceof Error && e.message === "FORBIDDEN") return apiError("You don't have access to this.", 403);
  if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
  console.error("[admin-remittances]", e);
  return apiError(toUserMessage(e), 500);
}

/** COD cash-collection control center (read). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(PERMISSIONS.REMITTANCES_WRITE);
    const resource = req.nextUrl.searchParams.get("resource") || "overview";
    if (resource === "overview") return apiSuccess(await codOverview());
    if (resource === "ledger") return apiSuccess({ riders: await riderCashLedger() });
    if (resource === "queue") return apiSuccess({ submissions: await pendingRemittanceSubmissions() });
    if (resource === "orders") {
      const status = req.nextUrl.searchParams.get("status") || undefined;
      return apiSuccess({ orders: await codReconciliation({ status }) });
    }
    return apiError("Unknown resource", 400);
  } catch (e) {
    return handle(e);
  }
}

/** Supervisor actions: verify/reject proof, confirm cash handover, clear restriction. */
export async function POST(req: NextRequest) {
  try {
    // REMITTANCES_WRITE is the "supervisor" permission — only roles granted it may
    // verify money or physically confirm cash (not every platform admin).
    const session = await requireAdmin(PERMISSIONS.REMITTANCES_WRITE);
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      submissionId?: string;
      riderId?: string;
      decision?: "APPROVE" | "REJECT";
      confirmedAmount?: number;
      rejectionReason?: string;
      reason?: string;
    };
    const decision = body.decision === "REJECT" ? "REJECT" : "APPROVE";

    if (body.action === "REVIEW_PROOF") {
      if (!body.submissionId) return apiError("Missing submission.", 400);
      if (decision === "REJECT" && !(body.rejectionReason || "").trim()) {
        return apiError("Give a reason for rejecting.", 400);
      }
      return apiSuccess(await reviewSubmission(session.user.id, body.submissionId, decision, { rejectionReason: body.rejectionReason }));
    }
    if (body.action === "CONFIRM_HANDOVER") {
      if (!body.submissionId) return apiError("Missing submission.", 400);
      if (decision === "REJECT" && !(body.rejectionReason || "").trim()) {
        return apiError("Give a reason for rejecting.", 400);
      }
      return apiSuccess(
        await confirmCashHandover(session.user.id, body.submissionId, decision, {
          confirmedAmount: typeof body.confirmedAmount === "number" ? body.confirmedAmount : undefined,
          rejectionReason: body.rejectionReason,
        })
      );
    }
    if (body.action === "CLEAR_RESTRICTION") {
      if (!body.riderId) return apiError("Missing rider.", 400);
      if (!(body.reason || "").trim()) return apiError("Give a reason for clearing the restriction.", 400);
      return apiSuccess(await clearRiderRestriction(session.user.id, body.riderId, body.reason!));
    }
    return apiError("Unsupported action.", 400);
  } catch (e) {
    return handle(e);
  }
}
