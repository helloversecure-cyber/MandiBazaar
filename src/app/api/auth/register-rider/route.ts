import { prisma } from "@/lib/db";
import { apiError, apiFieldErrors, apiSuccess } from "@/lib/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { validateRiderSignup } from "@/lib/validators/signup-forms";
import {
  DUPLICATE_EMAIL_MSG,
  DUPLICATE_PHONE_MSG,
  duplicateAccountErrors,
  findRiderIdsByPhone,
} from "@/lib/auth/user-lookup";
import {
  SignupAccountError,
  createSignupFirebaseUser,
  sendSignupVerificationEmail,
} from "@/lib/auth/firebase-signup";
import { deleteFirebaseUser } from "@/lib/firebase/admin";

/** Rider self-signup with docs — MandiBazaar must approve before deliveries. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`rider-register:${ip}`, 8, 60_000);
  if (!rl.ok) return apiError("Too many requests. Please try again later.", 429);

  let uid: string | null = null;
  try {
    const body = await req.json();
    const v = validateRiderSignup(body);
    if (!v.success) return apiFieldErrors(v.errors);

    const {
      fullName, phone, email, password, city, vehicleType, cnicNumber,
      accountNumber, accountTitle, bankName, jazzCashNumber,
      photoUrl, cnicUrl, cnicBackUrl, licenseUrl, bikeUrl, bikeCardUrl,
    } = v.data;
    if (!email) return apiFieldErrors({ email: "Email is required" });

    const dup = await duplicateAccountErrors({ phone, email });
    if (Object.keys(dup).length) return apiFieldErrors(dup, 409);

    const riderIds = await findRiderIdsByPhone(phone);
    const riderMatches = riderIds.length
      ? await prisma.rider.findMany({ where: { id: { in: riderIds } } })
      : [];
    if (riderMatches.some((r) => r.userId)) {
      return apiFieldErrors({ phone: "A rider account already exists for this phone. Sign in instead." }, 409);
    }
    const existingRiderPhone = riderMatches[0] || null;

    const cnicDigits = cnicNumber.replace(/-/g, "");
    const cnicOwner = await prisma.rider.findFirst({
      where: {
        cnicNumber: { in: [cnicNumber, cnicDigits] },
        ...(existingRiderPhone ? { id: { not: existingRiderPhone.id } } : {}),
      },
      select: { id: true },
    });
    if (cnicOwner) {
      return apiFieldErrors({ cnicNumber: "This CNIC is already registered to another rider." }, 409);
    }

    let riderRole = await prisma.role.findUnique({ where: { name: "RIDER" } });
    if (!riderRole) {
      riderRole = await prisma.role.create({ data: { name: "RIDER", description: "Delivery rider" } });
    }

    uid = await createSignupFirebaseUser(email, password, fullName);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName,
          phone,
          email,
          firebaseUid: uid!,
          roleId: riderRole!.id,
          onboardingCompleted: false,
          emailVerified: null,
        },
        select: { id: true, fullName: true, phone: true, email: true },
      });

      const riderData = {
        userId: user.id,
        name: fullName,
        phone,
        city,
        vehicleType,
        cnicNumber,
        photoUrl,
        cnicUrl,
        cnicBackUrl,
        licenseUrl,
        bikeUrl,
        bikeCardUrl,
        accountNumber: accountNumber || jazzCashNumber || null,
        accountTitle: accountTitle || fullName,
        bankName: bankName || null,
        jazzCashNumber: jazzCashNumber || null,
        approvalStatus: "PENDING" as const,
        isActive: false,
        status: "OFFLINE",
      };

      const rider =
        existingRiderPhone && !existingRiderPhone.userId
          ? await tx.rider.update({ where: { id: existingRiderPhone.id }, data: riderData })
          : await tx.rider.create({ data: riderData });

      return { user, rider };
    });

    await writeAuditLog({
      action: "RIDER_APPLICATION_SUBMITTED",
      entity: "Rider",
      entityId: result.rider.id,
      userId: result.user.id,
      newValue: { phone, city, vehicleType },
    });

    const mail = await sendSignupVerificationEmail(email, password);

    return apiSuccess(
      {
        ...result.user,
        riderId: result.rider.id,
        approvalStatus: "PENDING",
        needsVerification: true,
        emailSent: mail.sent,
        ...(mail.devLink ? { devLink: mail.devLink } : {}),
        message:
          "Application submitted. Verify your email, then MandiBazaar will review your photos & account details.",
      },
      201
    );
  } catch (e) {
    if (uid) await deleteFirebaseUser(uid).catch(() => {});
    if (e instanceof SignupAccountError) {
      return apiFieldErrors({ [e.field]: e.message }, 409);
    }
    console.error("[rider-register]", e);
    const msg = e instanceof Error ? e.message : "";
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
