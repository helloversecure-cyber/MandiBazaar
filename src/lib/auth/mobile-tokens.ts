/**
 * Android app sign-in tokens.
 *
 * - Access token: a 1-hour NextAuth-format JWT (same secret, same claims as the
 *   website session) sent as `Authorization: Bearer <token>`. getSession() in
 *   auth.ts turns it into the normal session, so every existing API route works.
 * - Refresh token: 30 days, random, only its SHA-256 hash is stored
 *   (MobileRefreshToken). Each use rotates it; using an already-rotated or
 *   revoked token revokes the whole sign-in (token family).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { decode, encode } from "next-auth/jwt";
import type { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { storeOwnerApproved } from "@/lib/auth/sign-in";

export const ACCESS_TOKEN_TTL_SECS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
const TOKEN_TYPE = "mobile-access";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "discount-price-dev-secret-change-in-production";
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type TokenUser = {
  id: string;
  role: RoleName;
  phone: string | null;
  mustChangePassword: boolean;
};

export async function issueAccessToken(user: TokenUser): Promise<{ token: string; expiresAt: Date }> {
  const storeApproved = user.role === "STORE_OWNER" ? await storeOwnerApproved(user.id) : true;
  const token = await encode({
    secret: secret(),
    maxAge: ACCESS_TOKEN_TTL_SECS,
    token: {
      sub: user.id,
      id: user.id,
      role: user.role,
      phone: user.phone,
      mustChangePassword: user.mustChangePassword,
      storeApproved,
      typ: TOKEN_TYPE,
    },
  });
  return { token, expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECS * 1000) };
}

/**
 * Resolve an `Authorization` header to a session. Returns null for anything that
 * isn't a valid, unexpired app access token of an active user.
 */
export async function sessionFromBearer(authorization: string | null | undefined): Promise<Session | null> {
  const m = /^Bearer\s+(\S+)$/i.exec((authorization || "").trim());
  if (!m) return null;
  let claims: Awaited<ReturnType<typeof decode>>;
  try {
    claims = await decode({ token: m[1], secret: secret() });
  } catch {
    return null;
  }
  if (!claims || claims.typ !== TOKEN_TYPE || typeof claims.id !== "string") return null;
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  if (!exp || exp <= Date.now()) return null;

  // A deactivated account loses access immediately, not after the token expires.
  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    select: { id: true, isActive: true, fullName: true, email: true, phone: true, role: { select: { name: true } } },
  });
  if (!user || !user.isActive) return null;

  return {
    expires: new Date(exp).toISOString(),
    user: {
      id: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      mustChangePassword: Boolean(claims.mustChangePassword),
      storeApproved: claims.storeApproved !== false,
    },
  };
}

/** New refresh token for a fresh sign-in (new family) or a rotation (same family). */
export async function issueRefreshToken(
  userId: string,
  opts: { familyId?: string; deviceName?: string | null } = {}
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  await prisma.mobileRefreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      familyId: opts.familyId ?? randomUUID(),
      deviceName: opts.deviceName?.slice(0, 100) || null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export type RotateResult =
  | { ok: true; userId: string; refresh: { token: string; expiresAt: Date } }
  | { ok: false; reason: "INVALID" | "EXPIRED" | "REUSED" | "REVOKED" };

/** Exchange a refresh token for a new one. Reuse of a rotated token revokes the family. */
export async function rotateRefreshToken(raw: string): Promise<RotateResult> {
  if (!raw || raw.length > 200) return { ok: false, reason: "INVALID" };
  const row = await prisma.mobileRefreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row) return { ok: false, reason: "INVALID" };
  if (row.revokedAt) return { ok: false, reason: "REVOKED" };
  if (row.rotatedAt) {
    // Someone is replaying an old token: end this whole sign-in.
    await revokeFamily(row.familyId);
    return { ok: false, reason: "REUSED" };
  }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  // Claim it atomically so two parallel refreshes can't both succeed.
  const claimed = await prisma.mobileRefreshToken.updateMany({
    where: { id: row.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await revokeFamily(row.familyId);
    return { ok: false, reason: "REUSED" };
  }
  const refresh = await issueRefreshToken(row.userId, { familyId: row.familyId, deviceName: row.deviceName });
  return { ok: true, userId: row.userId, refresh };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.mobileRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Sign out: revoke the sign-in this refresh token belongs to. Unknown tokens are ignored. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  if (!raw || raw.length > 200) return;
  const row = await prisma.mobileRefreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    select: { familyId: true },
  });
  if (row) await revokeFamily(row.familyId);
}
