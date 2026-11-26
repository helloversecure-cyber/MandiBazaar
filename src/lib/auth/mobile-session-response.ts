import type { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { issueAccessToken, issueRefreshToken } from "@/lib/auth/mobile-tokens";
import { storeOwnerApproved } from "@/lib/auth/sign-in";

/** Body returned by app login and refresh: a token pair plus who signed in. */
export async function buildMobileSession(
  userId: string,
  refresh?: { token: string; expiresAt: Date },
  deviceName?: string | null
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      mustChangePassword: true,
      role: { select: { name: true } },
    },
  });
  const role: RoleName = user.role.name;
  const access = await issueAccessToken({
    id: user.id,
    role,
    phone: user.phone,
    mustChangePassword: user.mustChangePassword,
  });
  const r = refresh ?? (await issueRefreshToken(user.id, { deviceName }));
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: r.token,
    refreshTokenExpiresAt: r.expiresAt.toISOString(),
    user: {
      id: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role,
      mustChangePassword: user.mustChangePassword,
      storeApproved: role === "STORE_OWNER" ? await storeOwnerApproved(user.id) : true,
    },
  };
}
