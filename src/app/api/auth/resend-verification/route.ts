import { apiError, apiSuccess } from "@/lib/utils";
import { normalizeEmail } from "@/lib/validators/pk";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getFirebaseUserByEmail } from "@/lib/firebase/admin";
import { sendSignupVerificationEmail } from "@/lib/auth/firebase-signup";

/**
 * Resend the email-verification link. Neutral response (doesn't reveal whether
 * the email exists). Only sends when the Firebase account exists and is unverified.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`resend-verify:${ip}`, 5, 60_000);
  if (!rl.ok) return apiError("Too many requests. Please wait a minute.", 429);

  const neutral = apiSuccess({ message: "If the account needs verification, we’ve sent a new link." });
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return neutral;
    const password = typeof body.password === "string" ? body.password : undefined;

    const fb = await getFirebaseUserByEmail(email);
    if (!fb || fb.emailVerified) return neutral;

    // Password (when the caller has it, e.g. the login form) lets Firebase send
    // the email directly; otherwise we fall back to Resend / a dev link.
    const mail = await sendSignupVerificationEmail(email, password);
    return apiSuccess({
      message: "Verification email sent.",
      ...(mail.devLink ? { devLink: mail.devLink } : {}),
    });
  } catch {
    return neutral;
  }
}
