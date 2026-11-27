/** Shared error → response mapping for the list routes. */
import { ListError } from "@/lib/lists/service";
import { apiError } from "@/lib/utils";
import { reportServerError } from "@/lib/monitoring/alerts";

export function listErrorResponse(e: unknown, logTag: string): Response {
  if (e instanceof ListError) {
    return Response.json(
      { success: false, error: e.message, code: e.code, ...(e.field ? { fieldErrors: { [e.field]: e.message } } : {}) },
      { status: e.status }
    );
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED") return apiError("Please sign in", 401);
  if (msg === "FORBIDDEN") return apiError("Not allowed", 403);
  if (msg === "STORE_NOT_APPROVED") return apiError("Your store isn't approved yet.", 403, "STORE_NOT_APPROVED");
  console.error(`[${logTag}]`, e);
  reportServerError(e, { source: `lists/${logTag}` });
  return apiError("Something went wrong. Please try again in a few moments.", 500);
}
