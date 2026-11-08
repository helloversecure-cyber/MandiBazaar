import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiFieldErrors, apiSuccess, apiZodError } from "@/lib/utils";
import { changePasswordSchema } from "@/lib/validators/signup-forms";
import {
  firebaseAuthEnabled,
  getFirebaseUserByEmail,
  setFirebasePassword,
  verifyFirebasePassword,
} from "@/lib/firebase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

/**
 * Change password while signed in (any role). Firebase is the source of truth:
 * verify the CURRENT password against it, then set the new one. Also clears the
 * stale bcrypt hash and the mustChangePassword flag.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in to continue.", 401);

  const ip = clientIp(req);
  const rl = rateLimit(`change-pw:${session.user.id}:${ip}`, 5, 60_000);
  if (!rl.ok) return apiError("Too many attempts. Try again in a minute.", 429);

  if (!firebaseAuthEnabled()) {
    return apiError("Password changes aren't available right now.", 503);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, isActive: true },
  });
  if (!user?.email || !user.isActive) return apiError("Account not found.", 404);

  // Verify the current password against Firebase before allowing a change.
  const check = await verifyFirebasePassword(user.email, currentPassword);
  if (!check.ok) {
    if (check.reason === "ERROR") {
      return apiError("Couldn't verify your password right now. Please try again.", 503);
    }
    if (check.reason === "DISABLED") {
      return apiError("This account is disabled. Contact support.", 403);
    }
    return apiFieldErrors({ currentPassword: "Current password is incorrect." });
  }

  const fb = await getFirebaseUserByEmail(user.email);
  if (!fb) return apiError("Account not found.", 404);

  await setFirebasePassword(fb.uid, newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false, passwordHash: null },
  });
  await writeAuditLog({
    userId: user.id,
    action: "PASSWORD_CHANGED",
    entity: "User",
    entityId: user.id,
    ...(ip ? { ipAddress: ip } : {}),
  });

  return apiSuccess({ message: "Your password has been updated." });
}
