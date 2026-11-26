import { requireAuth } from "@/lib/auth/auth";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { listErrorResponse } from "@/lib/lists/http";
import { createList, listCustomerLists } from "@/lib/lists/service";
import { createListSchema, firstIssue } from "@/lib/lists/validation";
import { apiSuccess, paginationMeta, parsePagination } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The signed-in customer's item lists, newest first. */
export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 10, maxLimit: 50 });
    const { total, items } = await listCustomerLists({ id: session.user.id }, { skip, take });
    return apiSuccess({ items, pagination: paginationMeta(page, limit, total) });
  } catch (e) {
    return listErrorResponse(e, "lists:get");
  }
}

/** Send a new list to nearby stores. Body: { addressId, note?, lines: [{ name, quantity, unit, categoryId?, productId?, note? }] } */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, error: "Invalid request" }, { status: 400 });
    }
    const parsed = createListSchema.safeParse(body);
    if (!parsed.success) {
      const { message, field } = firstIssue(parsed.error);
      return Response.json({ success: false, error: message, fieldErrors: { [field]: message } }, { status: 400 });
    }
    const list = await createList(
      { id: session.user.id, email: session.user.email },
      parsed.data,
      requestMetaFromHeaders(req.headers)
    );
    return apiSuccess(list, 201);
  } catch (e) {
    return listErrorResponse(e, "lists:post");
  }
}
