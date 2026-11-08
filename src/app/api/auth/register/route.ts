import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validators/schemas";
import { apiError, apiFieldErrors, apiSuccess, apiZodError } from "@/lib/utils";
import {
  DUPLICATE_EMAIL_MSG,
  DUPLICATE_PHONE_MSG,
  duplicateAccountErrors,
} from "@/lib/auth/user-lookup";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  SignupAccountError,
  createSignupFirebaseUser,
  sendSignupVerificationEmail,
} from "@/lib/auth/firebase-signup";
import { deleteFirebaseUser } from "@/lib/firebase/admin";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`register:${ip}`, 10, 60_000);
  if (!rl.ok) return apiError("Too many requests. Please try again later.", 429);

  let uid: string | null = null;
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return apiZodError(parsed.error);

    const { fullName, phone, email, password } = parsed.data;
    if (!email) return apiFieldErrors({ email: "Email is required" });

    // Duplicate check in our DB (also matches legacy stored phone formats — QA L2)
    const dup = await duplicateAccountErrors({ phone, email });
    if (Object.keys(dup).length) return apiFieldErrors(dup, 409);

    let customerRole = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
    if (!customerRole) {
      customerRole = await prisma.role.create({ data: { name: "CUSTOMER", description: "Customer" } });
    }

    // Firebase is the source of truth for credentials + email verification
    uid = await createSignupFirebaseUser(email, password, fullName);

    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          phone,
          email,
          firebaseUid: uid!,
          roleId: customerRole!.id,
          emailVerified: null,
        },
        select: { id: true },
      });
      await tx.cart.create({ data: { userId: created.id } });
    });

    const mail = await sendSignupVerificationEmail(email, password);

    return apiSuccess(
      {
        needsVerification: true,
        email,
        emailSent: mail.sent,
        ...(mail.devLink ? { devLink: mail.devLink } : {}),
      },
      201
    );
  } catch (e) {
    // Roll back the Firebase user if the DB write failed after it was created
    if (uid) await deleteFirebaseUser(uid).catch(() => {});
    if (e instanceof SignupAccountError) {
      return apiFieldErrors({ [e.field]: e.message }, 409);
    }
    console.error("[register]", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Firebase Authentication is not configured")) {
      return apiError("Sign-up is temporarily unavailable. Please try again later.", 503);
    }
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return apiFieldErrors(
        msg.includes("email") ? { email: DUPLICATE_EMAIL_MSG } : { phone: DUPLICATE_PHONE_MSG },
        409
      );
    }
    return apiError(
      process.env.NODE_ENV === "development" && msg ? msg : "Something went wrong. Please try again.",
      500
    );
  }
}
