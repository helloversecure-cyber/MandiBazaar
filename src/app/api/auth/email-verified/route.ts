import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { normalizeEmail } from "@/lib/validators/pk";
import { getFirebaseUserByEmail } from "@/lib/firebase/admin";

/**
 * Called by /auth/action after the browser applies the verification oobCode.
 * The server RE-CHECKS with Firebase that the email is actually verified before
 * marking our DB, so this can't be spoofed.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return apiError("Invalid request", 400);

    const fb = await getFirebaseUserByEmail(email);
    if (!fb?.emailVerified) {
      return apiError("Email is not verified yet", 400);
    }

    await prisma.user.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, emailVerified: null },
      data: { emailVerified: new Date() },
    });
    return apiSuccess({ verified: true });
  } catch {
    return apiError("Could not update verification status", 500);
  }
}
