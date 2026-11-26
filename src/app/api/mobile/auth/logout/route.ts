import { revokeRefreshToken } from "@/lib/auth/mobile-tokens";
import { removeDevice } from "@/lib/notifications/push";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Sign the app out: revokes this sign-in's refresh tokens and stops push to this
 * install. Always succeeds. Body: { refreshToken, deviceToken? }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = typeof body?.refreshToken === "string" ? await revokeRefreshToken(body.refreshToken) : null;
    // Only the signed-out user's own install is removed (a valid refresh token proves who they are).
    if (userId && typeof body?.deviceToken === "string") await removeDevice(body.deviceToken, userId);
  } catch {
    /* nothing to revoke */
  }
  return apiSuccess({ signedOut: true });
}
