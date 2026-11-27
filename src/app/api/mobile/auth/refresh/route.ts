import { revokeRefreshToken, rotateRefreshToken } from "@/lib/auth/mobile-tokens";
import { isPlatformAdminRole } from "@/lib/auth/permissions";
import { buildMobileSession } from "@/lib/auth/mobile-session-response";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Exchange a refresh token for a new access + refresh token pair. Body: { refreshToken } */
export async function POST(req: Request) {
  const rl = rateLimit(`mobile-refresh:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return apiError("Too many requests", 429, "RATE_LIMITED");

  let raw = "";
  try {
    const body = await req.json();
    raw = typeof body?.refreshToken === "string" ? body.refreshToken : "";
  } catch {
    return apiError("Invalid request", 400);
  }

  const result = await rotateRefreshToken(raw);
  if (!result.ok) return apiError("Please sign in again.", 401, `REFRESH_${result.reason}`);

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { isActive: true, role: { select: { name: true } } },
  });
  // Inactive accounts and admin roles (the app never holds admin sessions) end
  // here, and the token just issued by the rotation is revoked with its family.
  if (!user?.isActive || isPlatformAdminRole(user.role.name)) {
    await revokeRefreshToken(result.refresh.token);
    return apiError("Please sign in again.", 401, user?.isActive ? "PORTAL_NOT_IN_APP" : "ACCOUNT_INACTIVE");
  }

  return apiSuccess(await buildMobileSession(result.userId, result.refresh));
}
