/** Shared error → response mapping for the list routes. */
import { ListError } from "@/lib/lists/service";
import { apiError } from "@/lib/utils";

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
  console.error(`[${logTag}]`, e);
  return apiError("Something went wrong. Please try again in a few moments.", 500);
}
