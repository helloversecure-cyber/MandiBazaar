import { requireAuth } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { listErrorResponse } from "@/lib/lists/http";
import { cancelList, getCustomerList, updateList } from "@/lib/lists/service";
import { firstIssue, updateListSchema } from "@/lib/lists/validation";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    return apiSuccess(await getCustomerList({ id: session.user.id }, params.id));
  } catch (e) {
    return listErrorResponse(e, "lists:id:get");
  }
}

/** Edit while stores are still bidding. Body: { note?, lines? } — lines is the full new list (keep `id` on unchanged lines). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, error: "Invalid request" }, { status: 400 });
    }
    const parsed = updateListSchema.safeParse(body);
    if (!parsed.success) {
      const { message, field } = firstIssue(parsed.error);
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    const list = await updateList({ id: session.user.id }, params.id, parsed.data, requestMetaFromHeaders(req.headers));
    return apiSuccess(list);
  } catch (e) {
    return listErrorResponse(e, "lists:id:patch");
  }
}

/** Cancel while stores are still bidding. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const session = await requireAuth();
    return apiSuccess(await cancelList({ id: session.user.id }, params.id, requestMetaFromHeaders(req.headers)));
  } catch (e) {
    return listErrorResponse(e, "lists:id:delete");
  }
}
