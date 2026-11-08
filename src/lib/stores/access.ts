/**
 * Geo helpers and store-scoped auth utilities for MandiBazaar marketplace.
 */
import { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/auth";
import { isPlatformAdminRole, isStorePortalRole } from "@/lib/auth/permissions";

export async function getUserStoreIds(userId: string): Promise<string[]> {
  const [owned, memberships] = await Promise.all([
    prisma.store.findMany({
      where: { ownerId: userId, status: "APPROVED" },
      select: { id: true },
    }),
    prisma.storeMember.findMany({
      where: { userId, isActive: true, store: { status: "APPROVED" } },
      select: { storeId: true },
    }),
  ]);
  return Array.from(
    new Set([...owned.map((s) => s.id), ...memberships.map((m) => m.storeId)])
  );
}

/** True when the user owns or is an active member of at least one APPROVED store. */
export async function hasApprovedStore(userId: string): Promise<boolean> {
  const n = await prisma.store.count({
    where: {
      status: "APPROVED",
      OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
    },
  });
  return n > 0;
}

/** null = allowed to use store portal login */
export async function getStoreLoginBlockReason(
  userId: string
): Promise<string | null> {
  const stores = await prisma.store.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId, isActive: true } } },
      ],
    },
    select: { status: true, rejectionReason: true, suspensionReason: true },
  });

  if (stores.some((s) => s.status === "APPROVED")) return null;
  const withReason = (base: string, reason: string | null | undefined) =>
    reason?.trim() ? `${base} Reason: ${reason.trim()}` : base;

  if (stores.some((s) => s.status === "PENDING")) {
    return "Your account is not approved by MandiBazaar yet. Please wait until your account is reviewed and approved.";
  }
  const suspended = stores.find((s) => s.status === "SUSPENDED");
  if (suspended) {
    return withReason("Your store has been suspended. Contact MandiBazaar support.", suspended.suspensionReason);
  }
  const rejected = stores.find((s) => s.status === "REJECTED");
  if (rejected) {
    return withReason("Your store application was not approved. Contact MandiBazaar support.", rejected.rejectionReason);
  }
  return "No approved store found. Submit a store application first.";
}

export async function requireStoreAccess(storeId?: string) {
  const session = await getSession();
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");

  const role = session.user.role as RoleName;
  if (isPlatformAdminRole(role) && role === "SUPER_ADMIN") {
    return { session, storeIds: storeId ? [storeId] : ("ALL" as const), role };
  }

  if (!isStorePortalRole(role) && !isPlatformAdminRole(role)) {
    throw new Error("FORBIDDEN");
  }

  const storeIds = await getUserStoreIds(session.user.id);
  if (role === "STORE_OWNER" && storeIds.length === 0) {
    throw new Error("STORE_NOT_APPROVED");
  }
  if (storeId && !storeIds.includes(storeId) && role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN");
  }

  return { session, storeIds, role };
}

export function slugifyStoreName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Stores of this user that are NOT approved, with the admin's reason (shown in the portal). */
export async function getUserStoreNotices(userId: string) {
  const stores = await prisma.store.findMany({
    where: {
      status: { not: "APPROVED" },
      OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
    },
    select: { id: true, name: true, status: true, rejectionReason: true, suspensionReason: true },
  });
  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    reason:
      s.status === "SUSPENDED"
        ? s.suspensionReason
        : s.status === "REJECTED"
          ? s.rejectionReason
          : null,
  }));
}
