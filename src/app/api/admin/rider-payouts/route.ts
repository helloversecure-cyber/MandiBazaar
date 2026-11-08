/**
 * Admin → rider payouts (owner decision 7).
 * GET  ?riderId=…&preview=1        → unpaid deliveries + total for the "Pay rider" dialog
 * GET  ?riderId=…&page=…           → payout history (paginated)
 * POST { riderId, orderIds, expectedAmount, expectedCount, method, reference?, notes? }
 *      → creates the payout and links exactly those deliveries (409 if anything changed).
 * Permission: payouts:read / payouts:write (Super Admin and Admin).
 */
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { sendNotification } from "@/lib/notifications/service";
import { apiError, apiFieldErrors, apiSuccess, paginationMeta, parsePagination } from "@/lib/utils";
import { describeRiderPayRule, maskRiderPayoutAccount, payoutFieldErrors, RIDER_PAYOUT_METHOD_LABELS } from "@/lib/riders/pay";
import { createRiderPayout, listRiderPayouts, PayoutConflict, riderPayoutPreview } from "@/lib/riders/payouts";

export const dynamic = "force-dynamic";

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
  if (msg === "FORBIDDEN") return apiError("You don't have permission to pay riders", 403);
  return null;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(PERMISSIONS.PAYOUTS_READ);
    const sp = req.nextUrl.searchParams;
    const riderId = (sp.get("riderId") || "").trim();
    if (!riderId) return apiError("riderId required", 400);
    const rider = await prisma.rider.findUnique({
      where: { id: riderId },
      select: { id: true, name: true, phone: true, accountNumber: true, accountTitle: true, bankName: true, jazzCashNumber: true },
    });
    if (!rider) return apiError("Rider not found", 404);

    if (sp.get("preview") === "1") {
      const p = await riderPayoutPreview(riderId);
      return apiSuccess({
        rider: { id: rider.id, name: rider.name, phone: rider.phone },
        payoutAccount: maskRiderPayoutAccount(rider),
        payRule: describeRiderPayRule(p.settings),
        items: p.items,
        count: p.count,
        amount: p.amount,
      });
    }

    const { page, limit } = parsePagination(sp, { defaultLimit: 10, maxLimit: 50 });
    const h = await listRiderPayouts(riderId, page, limit);
    return apiSuccess({ items: h.items, pagination: paginationMeta(page, limit, h.total) });
  } catch (e) {
    const a = authError(e);
    if (a) return a;
    console.error("[admin/rider-payouts GET]", e);
    return apiError("Could not load rider payouts", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(PERMISSIONS.PAYOUTS_WRITE);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const riderId = typeof body.riderId === "string" ? body.riderId.trim() : "";
    if (!riderId) return apiError("riderId required", 400);
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.filter((x): x is string => typeof x === "string") : [];
    if (!orderIds.length || orderIds.length !== (body.orderIds as unknown[]).length) {
      return apiError("No deliveries selected to pay", 400);
    }
    const expectedAmount = Number(body.expectedAmount);
    const expectedCount = Number(body.expectedCount);
    if (!Number.isFinite(expectedAmount) || expectedAmount < 0 || !Number.isInteger(expectedCount) || expectedCount < 1) {
      return apiError("Confirmed amount and delivery count are required", 400);
    }
    const { errors, value } = payoutFieldErrors(body);
    if (Object.keys(errors).length) return apiFieldErrors(errors);

    const rider = await prisma.rider.findUnique({
      where: { id: riderId },
      select: { id: true, name: true, userId: true, accountNumber: true, accountTitle: true, bankName: true, jazzCashNumber: true },
    });
    if (!rider) return apiError("Rider not found", 404);

    let payout;
    try {
      payout = await createRiderPayout({
        riderId,
        orderIds,
        expectedAmount,
        expectedCount,
        method: value.method,
        reference: value.reference,
        notes: value.notes,
        paidById: session.user.id,
      });
    } catch (e) {
      if (e instanceof PayoutConflict) return apiError(e.message, e.status, e.status === 409 ? "PAYOUT_CHANGED" : undefined);
      throw e;
    }

    await writeAuditLog({
      userId: session.user.id,
      action: "RIDER_PAYOUT_CREATED",
      entity: "RiderPayout",
      entityId: payout.id,
      newValue: {
        riderId,
        riderName: rider.name,
        amount: payout.amount,
        deliveryCount: payout.deliveryCount,
        method: value.method,
        reference: value.reference,
        payoutAccount: maskRiderPayoutAccount(rider),
        orderIds,
      },
    });

    if (rider.userId) {
      try {
        await sendNotification({
          userId: rider.userId,
          type: "RIDER_PAYOUT",
          title: "Payment sent",
          body: `MandiBazaar paid you Rs ${payout.amount.toLocaleString("en-PK")} for ${payout.deliveryCount} ${
            payout.deliveryCount === 1 ? "delivery" : "deliveries"
          } (${RIDER_PAYOUT_METHOD_LABELS[value.method]}${value.reference ? `, ref ${value.reference}` : ""}).`,
          metadata: { riderPayoutId: payout.id },
        });
      } catch {
        /* never fail the payout because of a notification */
      }
    }

    return apiSuccess({ payout, message: `Paid ${rider.name} Rs ${payout.amount.toLocaleString("en-PK")}` }, 201);
  } catch (e) {
    const a = authError(e);
    if (a) return a;
    console.error("[admin/rider-payouts POST]", e);
    return apiError("Could not record the payout", 500);
  }
}
