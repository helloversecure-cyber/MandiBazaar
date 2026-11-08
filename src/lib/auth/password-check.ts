/**
 * Password check with account lockout — shared by the NextAuth credentials
 * `authorize` and the admin 2-step pre-check (POST /api/auth/2fa/start), so both
 * count failures the same way. Wrong admin sign-in codes count too
 * (`recordFailedSignIn`).
 */
import bcrypt from "bcryptjs";
import type { Prisma, RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { MSG, normalizeEmail } from "@/lib/validators/pk";
import { isPlatformAdminRole, isRiderRole, isStorePortalRole } from "@/lib/auth/permissions";
import {
  createFirebaseUser,
  getFirebaseUserByEmail,
  verifyFirebasePassword,
} from "@/lib/firebase/admin";

export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export type RequestMeta = { ipAddress?: string; userAgent?: string };

export type SignInUser = Prisma.UserGetPayload<{ include: { role: true } }>;

export function lockedMessage(minutes: number): string {
  return `Too many attempts, try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Count one failed attempt (wrong password or wrong sign-in code). Locks the
 * account for 15 minutes on the 5th. Returns the new count and whether it locked.
 */
export async function recordFailedSignIn(
  user: Pick<SignInUser, "id" | "failedLoginAttempts" | "lockedUntil">,
  meta: RequestMeta,
  now: number = Date.now()
): Promise<{ attempts: number; locked: boolean; attemptsLeft: number }> {
  // An expired lock starts a fresh count
  const base = user.lockedUntil ? 0 : user.failedLoginAttempts;
  const attempts = base + 1;
  const locked = attempts >= MAX_FAILED_LOGINS;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      lockedUntil: locked ? new Date(now + LOCK_MINUTES * 60 * 1000) : null,
    },
  });
  if (locked) {
    await writeAuditLog({
      userId: user.id,
      action: "ACCOUNT_LOCKED",
      entity: "User",
      entityId: user.id,
      newValue: { attempts, minutes: LOCK_MINUTES },
      ...meta,
    }).catch(() => {});
  }
  return { attempts, locked, attemptsLeft: Math.max(0, MAX_FAILED_LOGINS - attempts) };
}

/**
 * Email + password login via Firebase Authentication (the source of truth).
 *  - New users: created in Firebase at signup; must verify their email first.
 *  - Existing users (no Firebase account yet): LAZY-MIGRATED — their bcrypt
 *    password is checked once, then a verified Firebase account is created.
 * Throws Error(message): MSG.email · "Invalid credentials" · EMAIL_NOT_VERIFIED ·
 * "Too many attempts, try again in N minutes" · "This account is disabled…".
 */
export async function verifyPasswordWithLockout(
  identifier: unknown,
  password: unknown,
  meta: RequestMeta
): Promise<SignInUser> {
  if (typeof identifier !== "string" || typeof password !== "string" || !identifier || !password) {
    throw new Error("Please provide login credentials");
  }
  if (password.length > 128) throw new Error("Invalid credentials");

  const email = normalizeEmail(identifier);
  if (!email) throw new Error(MSG.email);

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, isActive: true },
    include: { role: true },
  });
  // Don't reveal which part is wrong
  if (!user) throw new Error("Invalid credentials");

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now) / 60000));
    throw new Error(lockedMessage(mins));
  }

  const fbUser = await getFirebaseUserByEmail(email);

  if (fbUser) {
    const check = await verifyFirebasePassword(email, password);
    if (!check.ok) {
      if (check.reason === "DISABLED") throw new Error("This account is disabled. Contact support.");
      const r = await recordFailedSignIn(user, meta, now);
      if (r.locked) throw new Error(lockedMessage(LOCK_MINUTES));
      throw new Error("Invalid credentials");
    }
    if (!fbUser.emailVerified) throw new Error(EMAIL_NOT_VERIFIED);
    // Keep our link + verified flag in sync
    if (user.firebaseUid !== fbUser.uid || !user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { firebaseUid: fbUser.uid, emailVerified: user.emailVerified ?? new Date() },
      });
    }
    return user;
  }

  // Lazy migration: no Firebase account yet — verify the old bcrypt password once.
  if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    const r = await recordFailedSignIn(user, meta, now);
    if (r.locked) throw new Error(lockedMessage(LOCK_MINUTES));
    throw new Error("Invalid credentials");
  }
  // Grandfather existing users: create a verified Firebase account with this password.
  const created = await createFirebaseUser({ email, password, emailVerified: true, displayName: user.fullName });
  await prisma.user.update({
    where: { id: user.id },
    data: { firebaseUid: created.uid, emailVerified: user.emailVerified ?? new Date() },
  });
  return user;
}

/** Role vs portal check (no DB). null = allowed. */
export function portalAccessError(portal: string, role: RoleName): string | null {
  if (portal === "admin" && !isPlatformAdminRole(role)) return "Unauthorized admin access";
  if (portal === "store" && !isStorePortalRole(role)) return "Unauthorized store access";
  if (portal === "rider" && !isRiderRole(role)) return "Unauthorized rider access";
  return null;
}

/** ip / user-agent from a Headers object or a plain header record. */
export function requestMetaFromHeaders(h: Headers | Record<string, unknown> | undefined): RequestMeta {
  const get = (name: string): string | undefined => {
    if (!h) return undefined;
    if (typeof (h as Headers).get === "function") return (h as Headers).get(name) || undefined;
    const v = (h as Record<string, unknown>)[name];
    return Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : undefined;
  };
  const ip = (get("x-forwarded-for") || get("x-real-ip") || "").split(",")[0].trim();
  const ua = get("user-agent");
  return {
    ...(ip ? { ipAddress: ip.slice(0, 100) } : {}),
    ...(ua ? { userAgent: ua.slice(0, 300) } : {}),
  };
}
