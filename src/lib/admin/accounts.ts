/**
 * Admin-created accounts: quick-add rider, create staff, rider review, and
 * their lists (QA P5 / S11 / Q7 / R6). Called from `src/app/api/admin/route.ts`.
 */
import { randomInt } from "crypto";
import { createFirebaseUser, deleteFirebaseUser, getFirebaseUserByEmail } from "@/lib/firebase/admin";
import { sendPasswordResetEmail, DUP_EMAIL_MSG } from "@/lib/auth/firebase-signup";
import { Prisma, RoleName, RiderApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess, apiZodError, paginationMeta, parsePagination } from "@/lib/utils";
import {
  phoneLookupVariants,
  riderApprovalProblems,
  riderQuickAddSchema,
  staffCreateSchema,
  STAFF_ROLE_OPTIONS,
} from "@/lib/admin/form-rules";
import { normalizePkMobile } from "@/lib/validators/pk";
import { parseRiderDocuments } from "@/lib/riders/documents";
import { unpaidByRider } from "@/lib/riders/earnings";
import { getRiderPaySettings, describeRiderPayRule } from "@/lib/riders/pay";

/** 10-char password from an unambiguous alphabet, always with a letter and a digit. */
export function generateTemporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [
    letters[randomInt(letters.length)],
    digits[randomInt(digits.length)],
    ...Array.from({ length: 8 }, () => all[randomInt(all.length)]),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const k = randomInt(i + 1);
    [chars[i], chars[k]] = [chars[k], chars[i]];
  }
  return chars.join("");
}

/** Field errors for phone / email already used by another account (any stored phone format). */
async function accountClashes(phone: string, email: string | undefined) {
  const phones = phoneLookupVariants(phone);
  const errors: Record<string, string> = {};
  const byPhone = await prisma.user.findFirst({ where: { phone: { in: phones } }, select: { id: true } });
  if (byPhone) errors.phone = "This mobile number is already registered";
  if (email) {
    const byEmail = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (byEmail) errors.email = "This email is already registered";
  }
  return { errors, phones };
}

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------

export async function createRiderWithLogin(actor: { id: string }, raw: unknown) {
  const parsed = riderQuickAddSchema.safeParse(raw ?? {});
  if (!parsed.success) return apiZodError(parsed.error);
  const d = parsed.data;
  // Optional documents (photo, CNIC front/back, licence, bike, bike card) so the
  // rider can be approved later without a separate signup.
  const docs = parseRiderDocuments(raw);
  if (Object.keys(docs.errors).length) return apiFieldErrors(docs.errors);

  const { errors, phones } = await accountClashes(d.phone, d.email);
  if (!errors.phone && (await prisma.rider.findFirst({ where: { phone: { in: phones } }, select: { id: true } }))) {
    errors.phone = "A rider with this mobile number already exists";
  }
  if (Object.keys(errors).length) return apiFieldErrors(errors, 409);

  if (!d.email) return apiFieldErrors({ email: "Email is required (used to sign in)" });
  if (await getFirebaseUserByEmail(d.email)) return apiFieldErrors({ email: DUP_EMAIL_MSG }, 409);

  let riderRole = await prisma.role.findUnique({ where: { name: "RIDER" } });
  if (!riderRole) {
    riderRole = await prisma.role.create({ data: { name: "RIDER", description: "Delivery rider" } });
  }

  // Firebase account (admin-vouched → email verified); the rider sets their own
  // password via the reset link we email them.
  const fb = await createFirebaseUser({
    email: d.email,
    password: generateTemporaryPassword(),
    emailVerified: true,
    displayName: d.name,
  });

  let rider;
  try {
    rider = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName: d.name,
        phone: d.phone,
        email: d.email,
        firebaseUid: fb.uid,
        roleId: riderRole!.id,
        onboardingCompleted: true,
        emailVerified: new Date(),
      },
    });
    return tx.rider.create({
      data: {
        userId: user.id,
        name: d.name,
        phone: d.phone,
        // Owner decision: quick-added riders start PENDING and get no jobs until a
        // Super Admin reviews their documents and approves them on the Riders page.
        isActive: false,
        status: "OFFLINE",
        approvalStatus: "PENDING",
        reviewNotes: "Added by admin (quick-add) — waiting for MandiBazaar approval",
        accountNumber: d.accountNumber || null,
        accountTitle: d.accountTitle || d.name,
        bankName: d.bankName || null,
        jazzCashNumber: d.jazzCashNumber || null,
        cnicNumber: d.cnicNumber,
        city: d.city,
        vehicleType: d.vehicleType,
        ...docs.value,
      },
      include: { user: { select: { id: true, email: true } } },
    });
    });
  } catch (e) {
    await deleteFirebaseUser(fb.uid).catch(() => {});
    throw e;
  }

  await sendPasswordResetEmail(d.email).catch(() => {});

  await writeAuditLog({
    userId: actor.id,
    action: "RIDER_CREATED_WITH_LOGIN",
    entity: "Rider",
    entityId: rider.id,
    newValue: {
      name: d.name,
      phone: d.phone,
      city: d.city,
      vehicleType: d.vehicleType,
      documents: Object.keys(docs.value),
    },
  });

  return apiSuccess(
    {
      ...rider,
      loginHint: {
        portal: "/login?portal=rider",
        identifier: d.email,
        setupEmailSent: true,
        message: "We emailed this rider a link to set their password.",
      },
    },
    201
  );
}

export async function reviewRider(actor: { id: string }, id: string, data: Record<string, unknown>) {
  const decision = String(data.decision || "").toUpperCase();
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return apiError("decision must be APPROVED or REJECTED", 400);
  }
  const existing = await prisma.rider.findUnique({ where: { id } });
  if (!existing) return apiError("Rider not found", 404);
  const notes = typeof data.notes === "string" ? data.notes.trim().slice(0, 500) : "";

  if (decision === "APPROVED") {
    const problems = riderApprovalProblems(existing);
    if (problems.length) {
      return Response.json(
        {
          success: false,
          error: `Can't approve this rider yet: ${problems.join("; ")}.`,
          code: "RIDER_INCOMPLETE",
          problems,
        },
        { status: 400 }
      );
    }
  } else if (notes.length < 5) {
    return apiFieldErrors({ notes: "Give a reason of at least 5 characters (the rider will see it)" });
  }

  const rider = await prisma.rider.update({
    where: { id },
    data: {
      approvalStatus: decision as RiderApprovalStatus,
      approvedAt: decision === "APPROVED" ? new Date() : null,
      reviewedById: actor.id,
      reviewNotes: notes || null,
      isActive: decision === "APPROVED",
      status: decision === "APPROVED" ? "AVAILABLE" : "OFFLINE",
    },
  });
  await writeAuditLog({
    userId: actor.id,
    action: `RIDER_${decision}`,
    entity: "Rider",
    entityId: id,
    previousValue: { approvalStatus: existing.approvalStatus },
    newValue: { decision, notes: notes || undefined },
  });
  return apiSuccess(rider);
}

/** Add / replace documents of a pending rider (Riders page). Blank fields keep the saved file. */
export async function updateRiderDocuments(actor: { id: string }, id: string, data: Record<string, unknown>) {
  const existing = await prisma.rider.findUnique({ where: { id } });
  if (!existing) return apiError("Rider not found", 404);
  if (existing.approvalStatus !== "PENDING") {
    return apiError("Documents can be changed here only while the rider is pending approval", 400);
  }
  const docs = parseRiderDocuments(data);
  if (Object.keys(docs.errors).length) return apiFieldErrors(docs.errors);
  const keys = Object.keys(docs.value) as (keyof typeof docs.value)[];
  if (!keys.length) return apiError("Upload at least one document", 400);

  const rider = await prisma.rider.update({ where: { id }, data: docs.value });
  await writeAuditLog({
    userId: actor.id,
    action: "RIDER_DOCUMENTS_UPDATED",
    entity: "Rider",
    entityId: id,
    previousValue: Object.fromEntries(keys.map((k) => [k, existing[k] ?? null])),
    newValue: docs.value,
  });
  return apiSuccess({ ...rider, approvalProblems: riderApprovalProblems(rider) });
}

export async function listRiders(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const q = sp.get("q")?.trim();
  const status = sp.get("status"); // PENDING | APPROVED | REJECTED | INACTIVE
  const and: Prisma.RiderWhereInput[] = [];
  if (q) {
    const phones = normalizePkMobile(q) ? phoneLookupVariants(q) : [];
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\s/g, "") } },
        ...(phones.length ? [{ phone: { in: phones } }] : []),
        { city: { contains: q, mode: "insensitive" } },
        { cnicNumber: { contains: q } },
      ],
    });
  }
  if (status === "INACTIVE") and.push({ approvalStatus: "APPROVED", isActive: false });
  else if (status === "PENDING" || status === "APPROVED" || status === "REJECTED") {
    and.push({ approvalStatus: status });
  }
  const where: Prisma.RiderWhereInput = { AND: and };
  const [total, items, pendingCount] = await Promise.all([
    prisma.rider.count({ where }),
    prisma.rider.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, isActive: true } },
        reviewedBy: { select: { fullName: true } },
        _count: { select: { orders: true } },
      },
      orderBy: [{ approvalStatus: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.rider.count({ where: { approvalStatus: "PENDING" } }),
  ]);
  // Rider pay: unpaid deliveries + amount per rider on this page.
  const paySettings = await getRiderPaySettings(prisma);
  const unpaid = await unpaidByRider(
    items.map((r) => r.id),
    paySettings
  );
  return apiSuccess({
    items: items.map((r) => ({
      ...r,
      approvalProblems: riderApprovalProblems(r),
      unpaid: unpaid[r.id] || { count: 0, amount: 0 },
    })),
    pagination: paginationMeta(page, limit, total),
    pendingCount,
    payRule: describeRiderPayRule(paySettings),
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function createStaff(actor: { id: string }, raw: unknown) {
  const input = (raw ?? {}) as Record<string, unknown>;
  const parsed = staffCreateSchema.safeParse({
    ...input,
    role: typeof input.role === "string" ? input.role.toUpperCase() : input.role,
  });
  if (!parsed.success) return apiZodError(parsed.error);
  const d = parsed.data;

  const { errors } = await accountClashes(d.phone, d.email);
  if (Object.keys(errors).length) return apiFieldErrors(errors, 409);

  const roleName = d.role as RoleName;
  let role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    role = await prisma.role.create({ data: { name: roleName, description: roleName.replace(/_/g, " ") } });
  }

  if (!d.email) return apiFieldErrors({ email: "Email is required (used to sign in)" });
  if (await getFirebaseUserByEmail(d.email)) return apiFieldErrors({ email: DUP_EMAIL_MSG }, 409);

  const fb = await createFirebaseUser({
    email: d.email,
    password: generateTemporaryPassword(),
    emailVerified: true,
    displayName: d.fullName,
  });

  let user;
  try {
    user = await prisma.user.create({
      data: {
        fullName: d.fullName,
        phone: d.phone,
        email: d.email,
        firebaseUid: fb.uid,
        roleId: role.id,
        onboardingCompleted: true,
        isActive: true,
        emailVerified: new Date(),
      },
      include: { role: { select: { name: true } } },
    });
  } catch (e) {
    await deleteFirebaseUser(fb.uid).catch(() => {});
    throw e;
  }

  await sendPasswordResetEmail(d.email).catch(() => {});

  await writeAuditLog({
    userId: actor.id,
    action: "STAFF_CREATED",
    entity: "User",
    entityId: user.id,
    newValue: { role: roleName, fullName: d.fullName },
  });

  return apiSuccess(
    {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      loginHint: {
        portal: "/login?portal=admin",
        identifier: user.email,
        setupEmailSent: true,
        message: "We emailed this staff member a link to set their password.",
      },
    },
    201
  );
}

export async function listStaff(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const q = sp.get("q")?.trim();
  const role = sp.get("role");
  const roles: RoleName[] = [...STAFF_ROLE_OPTIONS];
  const and: Prisma.UserWhereInput[] = [
    { role: { name: { in: role && (roles as string[]).includes(role) ? [role as RoleName] : roles } } },
  ];
  if (q) {
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\s/g, "") } },
      ],
    });
  }
  const where: Prisma.UserWhereInput = { AND: and };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        lastLoginAt: true,
        role: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);
  return apiSuccess({ items, pagination: paginationMeta(page, limit, total) });
}
