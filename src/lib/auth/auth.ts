import { NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  isAdminRole,
  isPlatformAdminRole,
  isRiderRole,
  isStorePortalRole,
} from "@/lib/auth/permissions";
import { requestMetaFromHeaders, type RequestMeta } from "@/lib/auth/password-check";
import { signInWithPassword, storeOwnerApproved } from "@/lib/auth/sign-in";
import { sessionFromBearer } from "@/lib/auth/mobile-tokens";

type ReqLike = { headers?: Record<string, unknown> | Headers } | undefined;

/** ip / user-agent from the next-auth authorize() request, when available. */
function requestMeta(req: ReqLike): RequestMeta {
  return requestMetaFromHeaders(req?.headers);
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Credentials",
      credentials: {
        identifier: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        portal: { label: "Portal", type: "text" },
      },
      async authorize(credentials, req) {
        return signInWithPassword(credentials ?? {}, requestMeta(req));
      },
    }),
  ],
  callbacks: {
    // Keep every post-auth redirect (sign-in, sign-out, callbackUrl) on the
    // canonical site host. Without this a wrong NEXTAUTH_URL (e.g. the Vercel
    // preview address) makes logout land on that address (NEW-02). The real fix
    // is still to set NEXTAUTH_URL=https://www.mandibazaar.pk, but this prevents
    // users from being dropped on a different-looking copy of the site.
    async redirect({ url, baseUrl }) {
      const canonical = (process.env.NEXT_PUBLIC_APP_URL || baseUrl).replace(/\/+$/, "");
      if (url.startsWith("/")) return `${canonical}${url}`;
      try {
        const u = new URL(url);
        const c = new URL(canonical);
        // Same host as canonical, or the configured baseUrl (e.g. the Vercel URL):
        // rewrite onto the canonical host. Foreign hosts fall back to home (no open redirect).
        if (u.host === c.host || url.startsWith(baseUrl)) return `${canonical}${u.pathname}${u.search}`;
        return canonical;
      } catch {
        return canonical;
      }
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.sub = user.id;
        token.role = (user as { role?: RoleName }).role;
        token.phone = (user as { phone?: string | null }).phone;
        token.mustChangePassword = Boolean(
          (user as { mustChangePassword?: boolean }).mustChangePassword
        );
      }

      // Refresh role from DB after role upgrades (e.g. CUSTOMER → STORE_OWNER)
      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: { role: true },
        });
        if (dbUser) {
          token.role = dbUser.role.name;
          token.phone = dbUser.phone;
          token.mustChangePassword = dbUser.mustChangePassword;
        }
      }

      // storeApproved gates a pending store owner out of the customer site and
      // the store dashboard (middleware). Non-store-owners are never gated.
      // While a store owner is unapproved we re-check the DB on each read so the
      // flag flips automatically once MandiBazaar approves their store.
      if (token.id && token.role === "STORE_OWNER") {
        if (token.storeApproved !== true) {
          token.storeApproved = await storeOwnerApproved(token.id as string);
        }
      } else {
        token.storeApproved = true;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) || (token.sub as string);
        session.user.role = token.role as RoleName;
        session.user.phone = token.phone as string | null;
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
        session.user.storeApproved = token.storeApproved !== false;
      }
      return session;
    },
  },
  secret:
    process.env.NEXTAUTH_SECRET ||
    "discount-price-dev-secret-change-in-production",
};

/**
 * The signed-in session: the website's NextAuth cookie, or — for the Android
 * app — an `Authorization: Bearer <access token>` header (see mobile-tokens.ts).
 * Both resolve to the same session shape, so every requireX() guard below
 * applies the same role checks to the app.
 */
export async function getSession() {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) return session;
  try {
    const { headers } = await import("next/headers");
    const auth = headers().get("authorization");
    if (auth) return await sessionFromBearer(auth);
  } catch {
    // Called outside a request (scripts, tests): no header to read.
  }
  return session;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireAdmin(permission?: string) {
  const session = await requireAuth();
  const role = session.user.role;
  if (!isPlatformAdminRole(role)) {
    throw new Error("FORBIDDEN");
  }
  if (permission) {
    const { hasPermission } = await import("@/lib/auth/permissions");
    if (!hasPermission(role, permission as never)) {
      throw new Error("FORBIDDEN");
    }
  }
  return session;
}

export async function requireSuperAdmin() {
  const session = await requireAuth();
  if (session.user.role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export async function requireStorePortal() {
  const session = await requireAuth();
  if (!isStorePortalRole(session.user.role) && !isAdminRole(session.user.role)) {
    throw new Error("FORBIDDEN");
  }
  if (session.user.role === "STORE_OWNER") {
    const { getUserStoreIds } = await import("@/lib/stores/access");
    const storeIds = await getUserStoreIds(session.user.id);
    if (storeIds.length === 0) {
      throw new Error("STORE_NOT_APPROVED");
    }
  }
  return session;
}

export async function requireRider(opts?: { allowPending?: boolean }) {
  const session = await requireAuth();
  if (!isRiderRole(session.user.role)) {
    throw new Error("FORBIDDEN");
  }
  const rider = await prisma.rider.findUnique({
    where: { userId: session.user.id },
  });
  if (!rider) {
    throw new Error("FORBIDDEN");
  }
  if (opts?.allowPending) {
    return { session, rider };
  }
  if (rider.approvalStatus !== "APPROVED" || !rider.isActive) {
    throw new Error("RIDER_PENDING_APPROVAL");
  }
  return { session, rider };
}
