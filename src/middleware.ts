import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const AUTH_SECRET = process.env.NEXTAUTH_SECRET;

if (!AUTH_SECRET && process.env.NODE_ENV === "production") {
  console.error(
    "[middleware] NEXTAUTH_SECRET is required in production — auth will fail closed"
  );
}

const PLATFORM_ADMIN_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "ORDER_MANAGER",
  "INVENTORY_MANAGER",
  "DELIVERY_MANAGER",
]);

const STORE_PORTAL_ROLES = new Set(["STORE_OWNER", "SUPER_ADMIN"]);

/** Path + query of the current request (used as callbackUrl, QA F4). */
function currentPath(req: NextRequest) {
  return req.nextUrl.pathname + (req.nextUrl.search || "");
}

function toLogin(req: NextRequest, portal?: "admin" | "store" | "rider") {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (portal) url.searchParams.set("portal", portal);
  url.searchParams.set("callbackUrl", currentPath(req));
  return NextResponse.redirect(url);
}

/** Wrong portal for this role → explain instead of silently going home (QA O5). */
function toAccessDenied(req: NextRequest, area: "admin" | "store" | "rider") {
  const url = req.nextUrl.clone();
  url.pathname = "/access-denied";
  url.search = "";
  url.searchParams.set("area", area);
  url.searchParams.set("from", currentPath(req));
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Fail closed in production without a real secret
  const secret =
    AUTH_SECRET ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "discount-price-dev-secret-change-in-production");

  if (!secret) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const token = await getToken({
    req,
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  });
  const signedIn = Boolean(token?.id || token?.sub);
  const role = String(token?.role || "");
  const mustChangePassword = Boolean(
    (token as { mustChangePassword?: boolean } | null)?.mustChangePassword
  );

  // Temporary-password lock: a user created with a temp password (staff/rider) must
  // change it before using anything. Hold them on the change-password screen until
  // the flag clears (the change-password endpoint clears it).
  const CHANGE_PW_PATH = "/account/security";
  if (signedIn && mustChangePassword) {
    const onChangePw = pathname === CHANGE_PW_PATH;
    const onAuth =
      pathname === "/login" ||
      pathname === "/logout" ||
      pathname.startsWith("/auth/");
    if (!onChangePw && !onAuth) {
      const url = req.nextUrl.clone();
      url.pathname = CHANGE_PW_PATH;
      url.search = "";
      url.searchParams.set("forced", "1");
      return NextResponse.redirect(url);
    }
  }

  // An unapproved store owner is held on the Pending Approval screen: no access
  // to the customer website or the store dashboard until MandiBazaar approves.
  // The store-portal paths are allowed through so the layout can show the pending
  // screen (and the full dashboard the moment the store is approved).
  if (signedIn && role === "STORE_OWNER" && token?.storeApproved === false) {
    const onPortal = pathname === "/store-portal" || pathname.startsWith("/store-portal/");
    const onAuth =
      pathname === "/login" ||
      pathname === "/logout" ||
      pathname.startsWith("/auth/");
    if (!onPortal && !onAuth) {
      const url = req.nextUrl.clone();
      url.pathname = "/store-portal";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!signedIn) return toLogin(req, "admin");
    if (!PLATFORM_ADMIN_ROLES.has(role)) return toAccessDenied(req, "admin");
    return NextResponse.next();
  }

  if (pathname === "/store-portal" || pathname.startsWith("/store-portal/")) {
    if (!signedIn) return toLogin(req, "store");
    if (!STORE_PORTAL_ROLES.has(role)) return toAccessDenied(req, "store");
    return NextResponse.next();
  }

  if (pathname === "/rider-portal" || pathname.startsWith("/rider-portal/")) {
    if (!signedIn) return toLogin(req, "rider");
    if (role !== "RIDER") return toAccessDenied(req, "rider");
    return NextResponse.next();
  }

  // Account pages: send to sign-in with the exact page to come back to (QA F4)
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    if (!signedIn) return toLogin(req);
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // All pages (needed for the temporary-password lock); skips APIs, Next.js
  // internals and static files.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|uploads|fonts|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
