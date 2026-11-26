import { revokeRefreshToken } from "@/lib/auth/mobile-tokens";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Sign the app out: revokes this sign-in's refresh tokens. Always succeeds. Body: { refreshToken } */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body?.refreshToken === "string") await revokeRefreshToken(body.refreshToken);
  } catch {
    /* nothing to revoke */
  }
  return apiSuccess({ signedOut: true });
}
