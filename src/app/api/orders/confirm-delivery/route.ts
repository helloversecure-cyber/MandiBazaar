import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import {
  lookupDeliveryToken,
  confirmDelivery,
  type ConfirmOutcome,
} from "@/lib/orders/delivery-confirm";

export const dynamic = "force-dynamic";

/** Public, token-authenticated: the single-use token IS the authorization, so
 *  no session is required (the customer opens it from their notification link). */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const res = await lookupDeliveryToken(token);
  if (!res.ok) return apiError(res.reason, 400);
  return apiSuccess(res.order);
}

export async function POST(req: NextRequest) {
  let body: { token?: string; outcome?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid request", 400);
  }
  const token = (body.token || "").trim();
  const outcome = (body.outcome || "").trim().toUpperCase() as ConfirmOutcome;
  const note = (body.note || "").trim().slice(0, 500) || undefined;
  if (!token) return apiError("Missing confirmation link", 400);

  const res = await confirmDelivery(token, outcome, note);
  if (!res.ok) {
    const msg =
      res.reason === "bad_outcome"
        ? "Please choose an option"
        : res.reason === "used"
          ? "This confirmation link has already been used"
          : res.reason === "expired"
            ? "This confirmation link has expired"
            : "This confirmation link is not valid";
    return apiError(msg, 400);
  }
  return apiSuccess({ outcome: res.outcome, orderNumber: res.orderNumber });
}
