/**
 * Password sign-in shared by the website (NextAuth credentials provider) and the
 * Android app (POST /api/mobile/auth/login), so both apply exactly the same
 * lookup, lockout, Firebase check, portal rules and rider rules.
 */
import type { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { isPlatformAdminRole } from "@/lib/auth/permissions";
import {
  portalAccessError,
  verifyPasswordWithLockout,
  type RequestMeta,
} from "@/lib/auth/password-check";

export type SignedInUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: RoleName;
  mustChangePassword: boolean;
};

export async function signInWithPassword(
  credentials: { identifier?: string; password?: string; portal?: string },
  meta: RequestMeta
): Promise<SignedInUser> {
  if (!credentials?.identifier || !credentials?.password) {
    throw new Error("Please provide login credentials");
  }

  // Same lookup + lockout counting as POST /api/auth/2fa/start
  const user = await verifyPasswordWithLockout(credentials.identifier, credentials.password, meta);

  const portal = credentials.portal || "customer";
  const portalError = portalAccessError(portal, user.role.name);
  if (portalError) throw new Error(portalError);
  // A store owner whose store isn't approved can still sign in (like a
  // pending rider) so they land on the Pending Approval screen. Access to
  // the dashboard and the customer site is gated by middleware + the
  // store-portal layout, never by a login error.
  if (portal === "rider") {
    const rider = await prisma.rider.findUnique({
      where: { userId: user.id },
    });
    if (!rider) {
      throw new Error("Rider profile not linked. Contact MandiBazaar.");
    }
    // PENDING and REJECTED riders can sign in to see their approval status
    // (a rejected rider sees the reason and can re-apply via
    // POST /api/rider/reapply). Delivery work is gated by requireRider(),
    // which only lets APPROVED + active riders through.
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  // QA I2: record every admin / staff sign-in
  if (isPlatformAdminRole(user.role.name)) {
    await writeAuditLog({
      userId: user.id,
      action: "ADMIN_SIGN_IN",
      entity: "User",
      entityId: user.id,
      newValue: { role: user.role.name, portal },
      ...meta,
    }).catch((e) => console.error("[auth] audit failed", e));
  }

  return {
    id: user.id,
    email: user.email || user.phone || user.id,
    name: user.fullName,
    phone: user.phone,
    role: user.role.name,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Store owner has at least one APPROVED store (owner or active member). */
export async function storeOwnerApproved(userId: string): Promise<boolean> {
  const approved = await prisma.store.count({
    where: {
      status: "APPROVED",
      OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
    },
  });
  return approved > 0;
}
