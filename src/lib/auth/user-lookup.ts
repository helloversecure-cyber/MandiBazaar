/**
 * Server-only user look-ups by phone/email that tolerate legacy phone formats.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseIdentifier, phoneDigitVariants } from "@/lib/auth/identifier";

/** Ids of users whose stored phone (any format) is this mobile. */
export async function findUserIdsByPhone(mobile: string): Promise<string[]> {
  const digits = phoneDigitVariants(mobile);
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "User" WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(digits)}) LIMIT 10`
  );
  return rows.map((r) => r.id);
}

/** Ids of riders whose stored phone (any format) is this mobile. */
export async function findRiderIdsByPhone(mobile: string): Promise<string[]> {
  const digits = phoneDigitVariants(mobile);
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Rider" WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(digits)}) LIMIT 10`
  );
  return rows.map((r) => r.id);
}

/** True when another account already uses this phone (any stored format). */
export async function phoneTaken(mobile: string): Promise<boolean> {
  return (await findUserIdsByPhone(mobile)).length > 0;
}

/** True when another account already uses this email (case-insensitive). */
export async function emailTaken(email: string): Promise<boolean> {
  const n = await prisma.user.count({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  return n > 0;
}

/**
 * Prisma where-clause matching a typed identifier: the raw value, the normalised
 * value, and (for phones) every legacy stored format. Returns null for junk input.
 */
export async function userWhereForIdentifier(
  input: unknown
): Promise<Prisma.UserWhereInput | null> {
  const id = parseIdentifier(input);
  if (id.kind === "invalid") return null;
  if (id.kind === "email") {
    return {
      OR: [
        { email: id.raw },
        { email: { equals: id.normalized, mode: "insensitive" } },
      ],
    };
  }
  const ids = await findUserIdsByPhone(id.normalized);
  return {
    OR: [{ phone: id.raw }, { phone: id.normalized }, ...(ids.length ? [{ id: { in: ids } }] : [])],
  };
}

/** Field errors for duplicate phone / email at signup (QA L2). */
export async function duplicateAccountErrors(opts: {
  phone?: string | null;
  email?: string | null;
}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const [p, e] = await Promise.all([
    opts.phone ? phoneTaken(opts.phone) : Promise.resolve(false),
    opts.email ? emailTaken(opts.email) : Promise.resolve(false),
  ]);
  if (p) out.phone = DUPLICATE_PHONE_MSG;
  if (e) out.email = DUPLICATE_EMAIL_MSG;
  return out;
}

export const DUPLICATE_PHONE_MSG =
  "This phone number is already registered. Sign in or reset your password.";
export const DUPLICATE_EMAIL_MSG = "This email is already in use.";
