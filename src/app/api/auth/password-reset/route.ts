import { prisma } from "@/lib/db";
import { apiError, apiFieldErrors, apiSuccess } from "@/lib/utils";
import { MSG, normalizeEmail } from "@/lib/validators/pk";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sendPasswordResetEmail } from "@/lib/auth/firebase-signup";
import { writeAuditLog } from "@/lib/audit";

const SUPER_ADMIN_RESET_MSG =
  "This account's password is managed by the MandiBazaar team and can't be reset here.";

/**
 * Forgot password (Firebase). Customer / Rider / Store Owner only — MandiBazaar
 * is refused on the server (not just the UI). Neutral success otherwise.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`pwd-reset:${ip}`, 5, 60_000);
  if (!rl.ok) return apiError("Too many requests. Try again in a minute.", 429);

  const neutral = apiSuccess({
    message: "If an account exists for this email, we've sent a password reset link.",
  });

  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return apiFieldErrors({ email: MSG.email });

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      include: { role: true },
    });

    // MandiBazaar can never reset via this flow (backend enforced)
    if (user?.role.name === "SUPER_ADMIN") {
      await writeAuditLog({
        userId: user.id,
        action: "PASSWORD_RESET_REFUSED_SUPER_ADMIN",
        entity: "User",
        entityId: user.id,
      }).catch(() => {});
      return apiError(SUPER_ADMIN_RESET_MSG, 403, "SUPER_ADMIN");
    }

    // No account for this email — tell the user plainly (per product choice).
    if (!user) return apiError("This account doesn't exist. Please check the email or create an account.", 404, "NO_ACCOUNT");

    const mail = await sendPasswordResetEmail(email);
    await writeAuditLog({
      userId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entity: "User",
      entityId: user.id,
    }).catch(() => {});

    return apiSuccess({
      message: neutral ? "If an account exists for this email, we've sent a password reset link." : "",
      ...(mail.devLink ? { devLink: mail.devLink } : {}),
    });
  } catch (e) {
    console.error("[password-reset]", e instanceof Error ? e.message : e);
    return neutral;
  }
}
