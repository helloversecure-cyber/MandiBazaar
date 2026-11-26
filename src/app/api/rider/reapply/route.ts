import { requireRider } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, apiFieldErrors, apiSuccess, toUserMessage } from "@/lib/utils";
import { validateRiderReapply } from "@/lib/validators/signup-forms";

export const dynamic = "force-dynamic";

const CNIC_TAKEN_MSG = "This CNIC is already registered to another rider.";

/**
 * A REJECTED rider fixes their details and documents and sends the application
 * back for review (cookie session or app bearer token). Same field rules as
 * POST /api/auth/register-rider, minus the account fields (name, phone, email,
 * password) which stay as they are.
 *
 * Body: { city, vehicleType, cnicNumber, accountTitle?, accountNumber?, bankName?,
 *         jazzCashNumber?, photoUrl, cnicUrl, cnicBackUrl, licenseUrl, bikeUrl, bikeCardUrl }
 * 200 { riderId, approvalStatus: "PENDING" } · 400 { fieldErrors } · 401 · 403 not a
 * rider / not rejected · 409 { fieldErrors: { cnicNumber } } · 429
 */
export async function POST(req: Request) {
  try {
    const { session, rider } = await requireRider({ allowPending: true });
    if (rider.approvalStatus !== "REJECTED") {
      return apiError("Only a rejected application can be sent again.", 403, "NOT_REJECTED");
    }

    const rl = rateLimit(`rider-reapply:${rider.id}`, 10, 60 * 60_000);
    if (!rl.ok) return apiError("Too many requests. Please try again later.", 429);

    const body = await req.json().catch(() => null);
    const v = validateRiderReapply(body);
    if (!v.success) return apiFieldErrors(v.errors);
    const d = v.data;

    const cnicDigits = d.cnicNumber.replace(/-/g, "");
    const cnicOwner = await prisma.rider.findFirst({
      where: { cnicNumber: { in: [d.cnicNumber, cnicDigits] }, id: { not: rider.id } },
      select: { id: true },
    });
    if (cnicOwner) return apiFieldErrors({ cnicNumber: CNIC_TAKEN_MSG }, 409);

    // Conditional on REJECTED so two concurrent submits can't both go through.
    const updated = await prisma.rider.updateMany({
      where: { id: rider.id, approvalStatus: "REJECTED" },
      data: {
        city: d.city,
        vehicleType: d.vehicleType,
        cnicNumber: d.cnicNumber,
        photoUrl: d.photoUrl,
        cnicUrl: d.cnicUrl,
        cnicBackUrl: d.cnicBackUrl,
        licenseUrl: d.licenseUrl,
        bikeUrl: d.bikeUrl,
        bikeCardUrl: d.bikeCardUrl,
        accountNumber: d.accountNumber || d.jazzCashNumber || null,
        accountTitle: d.accountTitle || rider.name,
        bankName: d.bankName || null,
        jazzCashNumber: d.jazzCashNumber || null,
        approvalStatus: "PENDING",
        reviewNotes: null,
        approvedAt: null,
        isActive: false,
        status: "OFFLINE",
      },
    });
    if (updated.count === 0) {
      return apiError("Only a rejected application can be sent again.", 403, "NOT_REJECTED");
    }

    // The admin Riders page badge counts PENDING riders, so the re-application
    // shows up there the same way a new one does (there is no separate admin alert).
    await writeAuditLog({
      action: "RIDER_REAPPLIED",
      entity: "Rider",
      entityId: rider.id,
      userId: session.user.id,
      previousValue: { approvalStatus: "REJECTED", reviewNotes: rider.reviewNotes },
      newValue: { city: d.city, vehicleType: d.vehicleType, approvalStatus: "PENDING" },
    });

    return apiSuccess({ riderId: rider.id, approvalStatus: "PENDING" as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    if (msg === "FORBIDDEN") return apiError("Only riders can re-apply.", 403);
    console.error("[rider-reapply]", e);
    return apiError(toUserMessage(e), 500);
  }
}
