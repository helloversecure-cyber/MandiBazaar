import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { deletePublicCopies, movePrivateFiles, privateFilesReport } from "@/lib/uploads/move-private";

/**
 * Moving old identity documents and proofs into the private bucket
 * (Super Admin only). GET: what is left. POST { action: "move" | "delete-public" }:
 * one batch; the page calls it again until nothing is left.
 */
export const dynamic = "force-dynamic";

function failure(e: unknown) {
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    if (e.message === "FORBIDDEN") return apiError("You don't have access to this.", 403);
    if (e.message === "PRIVATE_STORAGE_NOT_CONFIGURED")
      return apiError("The private bucket is not set up (NEON_STORAGE_PRIVATE_BUCKET).", 409);
  }
  console.error("[admin-private-files]", e);
  return apiError("Something went wrong. Please try again.", 500);
}

export async function GET() {
  try {
    await requireSuperAdmin();
    return apiSuccess(await privateFilesReport());
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSuperAdmin();
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "move") return apiSuccess(await movePrivateFiles(session.user.id));
    if (body.action === "delete-public") return apiSuccess(await deletePublicCopies(session.user.id));
    return apiError("Unknown action", 400);
  } catch (e) {
    return failure(e);
  }
}
