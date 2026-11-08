import { z } from "zod";
import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiFieldErrors, apiSuccess, apiZodError } from "@/lib/utils";
import { zPersonName, zMobile } from "@/lib/validators/pk";
import { writeAuditLog } from "@/lib/audit";

const profileSchema = z.object({ fullName: zPersonName, phone: zMobile });

/** Current profile for the signed-in user (prefills the edit form). */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in to continue.", 401);
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { fullName: true, phone: true, email: true },
  });
  if (!me) return apiError("Account not found.", 404);
  return apiSuccess(me);
}

/** Customer edits their own name / mobile. Email stays fixed (it's the sign-in id). */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in to continue.", 401);

  const body = await req.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);
  const { fullName, phone } = parsed.data; // phone normalized to 03XXXXXXXXX by zMobile

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, phone: true },
  });
  if (!me) return apiError("Account not found.", 404);

  // Phone is unique; allow keeping your own, block taking someone else's.
  if (phone !== me.phone) {
    const taken = await prisma.user.findFirst({
      where: { phone, id: { not: me.id } },
      select: { id: true },
    });
    if (taken) {
      return apiFieldErrors({ phone: "This phone number is already registered." });
    }
  }

  await prisma.user.update({
    where: { id: me.id },
    data: {
      fullName,
      phone,
      // Changing the number invalidates any prior phone verification.
      ...(phone !== me.phone ? { phoneVerified: null } : {}),
    },
  });
  await writeAuditLog({
    userId: me.id,
    action: "PROFILE_UPDATED",
    entity: "User",
    entityId: me.id,
  });

  return apiSuccess({ fullName, phone, message: "Your profile has been updated." });
}
