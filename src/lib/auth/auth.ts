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
import { writeAuditLog } from "@/lib/audit";
import {
  portalAccessError,
  requestMetaFromHeaders,
  verifyPasswordWithLockout,
  type RequestMeta,
} from "@/lib/auth/password-check";

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
        if (!credentials?.identifier || !credentials?.password) {
          throw new Error("Please provide login credentials");
        }
        const meta = requestMeta(req);

        // Same lookup + lockout counting as POST /api/auth/2fa/start
        const user = await verifyPasswordWithLockout(credentials.identifier, credentials.password, meta);

        const portal = credentials.portal || "customer";
        const portalError = portalAccessError(portal, user.role.name);
        if (portalError) throw new Error(portalError);
        // A store owner whose store isn't approved can still sign in (like a
        // pending rider) so they land on the Pending Approval screen. Access to
        // the dashboard and the customer site is gated by middleware + the
        // store-portal layout, never by a login error.
        if (portal === "rider") {
          const rider = await prisma.rider.findUnique({
            where: { userId: user.id },
          });
          if (!rider) {
            throw new Error(
              "Rider profile not linked. Contact MandiBazaar."
            );
          }
          if (rider.approvalStatus === "REJECTED") {
            throw new Error(
              rider.reviewNotes
                ? `Application rejected: ${rider.reviewNotes}`
                : "Rider application was rejected. Contact MandiBazaar."
            );
          }
          // PENDING riders can login to see approval status; APPROVED can work
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
          },
        });

        // QA I2: record every admin / staff sign-in
        if (isPlatformAdminRole(user.role.name)) {
          await writeAuditLog({
            userId: user.id,
            action: "ADMIN_SIGN_IN",
            entity: "User",
            entityId: user.id,
            newValue: { role: user.role.name, portal },
            ...meta,
          }).catch((e) => console.error("[auth] audit failed", e));
        }

        return {
          id: user.id,
          email: user.email || user.phone || user.id,
          name: user.fullName,
          phone: user.phone,
          role: user.role.name,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
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
          const approved = await prisma.store.count({
            where: {
              status: "APPROVED",
              OR: [
                { ownerId: token.id as string },
                { members: { some: { userId: token.id as string, isActive: true } } },
              ],
            },
          });
          token.storeApproved = approved > 0;
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

export function getSession() {
  return getServerSession(authOptions);
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
