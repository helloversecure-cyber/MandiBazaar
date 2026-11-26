import { signInWithPassword } from "@/lib/auth/sign-in";
import { requestMetaFromHeaders } from "@/lib/auth/password-check";
import { buildMobileSession } from "@/lib/auth/mobile-session-response";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

const APP_PORTALS = new Set(["customer", "store", "rider"]);

/**
 * Android app sign-in. Same checks as the website login (signInWithPassword),
 * returns a 1-hour access token and a 30-day refresh token instead of a cookie.
 * Body: { identifier, password, portal: "customer" | "store" | "rider", deviceName? }
 */
export async function POST(req: Request) {
  const rl = rateLimit(`mobile-login:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return apiError("Too many sign-in attempts. Please wait a minute and try again.", 429, "RATE_LIMITED");

  let body: { identifier?: unknown; password?: unknown; portal?: unknown; deviceName?: unknown };
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid request", 400);
  }
  const portal = typeof body.portal === "string" ? body.portal : "customer";
  // The admin panel stays on the website.
  if (!APP_PORTALS.has(portal)) return apiError("Admins sign in on the website.", 403, "PORTAL_NOT_IN_APP");

  let user;
  try {
    user = await signInWithPassword(
      {
        identifier: typeof body.identifier === "string" ? body.identifier : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
        portal,
      },
      requestMetaFromHeaders(req.headers)
    );
  } catch (e) {
    const msg = toUserMessage(e);
    const status = /^Unauthorized .* access$/.test(msg) ? 403 : msg.startsWith("Something went wrong") ? 500 : 401;
    if (status === 500) console.error("[mobile-login]", e);
    return apiError(msg, status, status === 403 ? "WRONG_PORTAL" : status === 401 ? "SIGN_IN_FAILED" : undefined);
  }

  try {
    const deviceName = typeof body.deviceName === "string" ? body.deviceName : null;
    return apiSuccess(await buildMobileSession(user.id, undefined, deviceName));
  } catch (e) {
    console.error("[mobile-login] session", e);
    return apiError("Something went wrong. Please try again in a few moments.", 500);
  }
}
