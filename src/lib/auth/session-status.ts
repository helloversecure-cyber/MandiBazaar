import type { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * How often a website session re-checks its account in the database (M3): a
 * deactivated or deleted account is signed out within this window, and a role
 * change reaches the session. The result is cached per user in-process too —
 * server components can't rewrite the session cookie, so the token's own
 * checkedAt alone would not stop a DB read on every request.
 */
export const SESSION_RECHECK_MS = 5 * 60 * 1000;
const SESSION_STATUS_CACHE_MAX = 10_000;

type AccountStatus = { active: boolean; role: RoleName | null; at: number };
const accountStatusCache = new Map<string, AccountStatus>();

/** Drop the cached account status (call after deactivating / deleting a user). */
export function forgetSessionAccountStatus(userId?: string) {
  if (userId) accountStatusCache.delete(userId);
  else accountStatusCache.clear();
}

export async function accountStatus(userId: string, now: number): Promise<AccountStatus> {
  const cached = accountStatusCache.get(userId);
  if (cached && now - cached.at < SESSION_RECHECK_MS) return cached;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: { select: { name: true } } },
  });
  const status: AccountStatus = { active: Boolean(u?.isActive), role: u?.role.name ?? null, at: now };
  if (accountStatusCache.size >= SESSION_STATUS_CACHE_MAX) accountStatusCache.clear();
  accountStatusCache.set(userId, status);
  return status;
}
