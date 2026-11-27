/**
 * W2: Android app sign-in (test cases A-01 … A-14 in docs/plans/test-cases.md).
 * Firebase is mocked: a user's password is "Correct#123" and every email is verified.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fb = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/firebase/admin", () => ({
  firebaseAuthEnabled: () => fb.enabled,
  getFirebaseUserByEmail: vi.fn(async (email: string) => ({ uid: `fb-${email}`, emailVerified: true, disabled: false })),
  verifyFirebasePassword: vi.fn(async (_email: string, password: string) =>
    password === "Correct#123" ? { ok: true } : { ok: false, reason: "INVALID_PASSWORD" }
  ),
  createFirebaseUser: vi.fn(),
}));

import { encode } from "next-auth/jwt";
import { POST as login } from "@/app/api/mobile/auth/login/route";
import { POST as refresh } from "@/app/api/mobile/auth/refresh/route";
import { POST as logout } from "@/app/api/mobile/auth/logout/route";
import { sessionFromBearer } from "@/lib/auth/mobile-tokens";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, TEST_PASSWORD, type Fixtures } from "./helpers/fixtures";

let ipCounter = 0;
function post(handler: (r: Request) => Promise<Response>, body: unknown, ip?: string) {
  return handler(
    new Request("http://localhost/api/mobile/auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `10.0.0.${++ipCounter % 250}` },
      body: JSON.stringify(body),
    })
  );
}
const signIn = (identifier: string, password = "Correct#123", portal = "customer", ip?: string) =>
  post(login, { identifier, password, portal, deviceName: "Pixel test" }, ip);

describeDb("mobile auth", () => {
  let f: Fixtures;

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });

  beforeEach(async () => {
    await prisma.user.updateMany({ data: { failedLoginAttempts: 0, lockedUntil: null } });
  });

  it("A-01 right password returns an access token, a refresh token and the user", async () => {
    const res = await signIn("customer.a@test.local");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toEqual(expect.any(String));
    expect(data.user).toMatchObject({ id: f.customerA.id, role: "CUSTOMER", storeApproved: true });
    const ttl = new Date(data.accessTokenExpiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);
    const stored = await prisma.mobileRefreshToken.findMany({ where: { userId: f.customerA.id } });
    expect(stored.at(-1)?.tokenHash).not.toBe(data.refreshToken); // only the hash is stored
    expect(stored.at(-1)?.deviceName).toBe("Pixel test");
  });

  it("A-01 signing in with the phone number works too", async () => {
    const res = await signIn("03001234567");
    expect(res.status).toBe(200);
  });

  it("A-02 wrong password is 401 with the website's message and counts the attempt", async () => {
    const res = await signIn("customer.a@test.local", "nope");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid credentials");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: f.customerA.id } });
    expect(u.failedLoginAttempts).toBe(1);
  });

  it("A-03 five wrong passwords lock the account, even for the right password", async () => {
    for (let i = 0; i < 5; i++) await signIn("customer.b@test.local", "nope");
    const res = await signIn("customer.b@test.local");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Too many attempts, try again in \d+ minutes?/);
  });

  it("A-04 a customer can't use the rider portal", async () => {
    const res = await signIn("customer.a@test.local", "Correct#123", "rider");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Unauthorized rider access");
  });

  it("A-04 admins are sent to the website", async () => {
    const res = await signIn("admin@test.local", "Correct#123", "admin");
    expect(res.status).toBe(403);
  });

  it("A-04 admins can't get app tokens through the customer or store portal either", async () => {
    for (const portal of ["customer", "store"]) {
      const res = await signIn("admin@test.local", "Correct#123", portal);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("PORTAL_NOT_IN_APP");
      expect(body.data).toBeUndefined();
    }
    expect(await prisma.mobileRefreshToken.count({ where: { userId: f.admin.id } })).toBe(0);
  });

  it("L2 admin app sign-in is refused before any side effect, whatever the password", async () => {
    await prisma.user.update({ where: { id: f.admin.id }, data: { lastLoginAt: null, failedLoginAttempts: 0 } });
    const audits = () => prisma.auditLog.count({ where: { action: "ADMIN_SIGN_IN", userId: f.admin.id } });
    const before = await audits();
    const right = await signIn("admin@test.local", "Correct#123", "customer");
    const wrong = await signIn("admin@test.local", "nope", "customer");
    for (const res of [right, wrong]) {
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PORTAL_NOT_IN_APP");
    }
    const u = await prisma.user.findUniqueOrThrow({ where: { id: f.admin.id } });
    expect(u.lastLoginAt).toBeNull();
    expect(u.failedLoginAttempts).toBe(0);
    expect(await audits()).toBe(before);
  });

  it("L2 an admin can't use an app refresh token or bearer token", async () => {
    const { issueAccessToken, issueRefreshToken } = await import("@/lib/auth/mobile-tokens");
    const access = await issueAccessToken({ id: f.admin.id, role: "SUPER_ADMIN", phone: null, mustChangePassword: false });
    expect(await sessionFromBearer(`Bearer ${access.token}`)).toBeNull();
    const rt = await issueRefreshToken(f.admin.id);
    const res = await post(refresh, { refreshToken: rt.token });
    expect(res.status).toBe(401);
    expect((await res.json()).data).toBeUndefined();
    // nothing usable is left behind for that sign-in
    expect(await prisma.mobileRefreshToken.count({ where: { userId: f.admin.id, revokedAt: null, rotatedAt: null } })).toBe(0);
  });

  it("A-05 a pending rider can sign in", async () => {
    await prisma.rider.update({ where: { id: f.R3.id }, data: { approvalStatus: "PENDING" } });
    const res = await signIn("rider.r3@test.local", "Correct#123", "rider");
    expect(res.status).toBe(200);
    expect((await res.json()).data.user.role).toBe("RIDER");
  });

  it("A-05 a rejected rider can sign in (to see the reason and re-apply)", async () => {
    await prisma.rider.update({
      where: { id: f.R3.id },
      data: { approvalStatus: "REJECTED", reviewNotes: "CNIC unreadable" },
    });
    const res = await signIn("rider.r3@test.local", "Correct#123", "rider");
    expect(res.status).toBe(200);
    expect((await res.json()).data.user.role).toBe("RIDER");
    await prisma.rider.update({ where: { id: f.R3.id }, data: { approvalStatus: "APPROVED", reviewNotes: null } });
  });

  it("A-06 the access token resolves to the same session the website would have", async () => {
    const { data } = await (await signIn("owner.s1@test.local", "Correct#123", "store")).json();
    const session = await sessionFromBearer(`Bearer ${data.accessToken}`);
    expect(session?.user).toMatchObject({ id: f.S1.ownerId, role: "STORE_OWNER", storeApproved: true });
  });

  it("A-07 an expired access token is rejected", async () => {
    const token = await encode({
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: -10,
      token: { id: f.customerA.id, sub: f.customerA.id, role: "CUSTOMER", typ: "mobile-access" },
    });
    expect(await sessionFromBearer(`Bearer ${token}`)).toBeNull();
  });

  it("A-12 a tampered or foreign token is rejected", async () => {
    const { data } = await (await signIn("customer.a@test.local")).json();
    const t: string = data.accessToken;
    const tampered = t.slice(0, -4) + (t.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await sessionFromBearer(`Bearer ${tampered}`)).toBeNull();
    const otherSecret = await encode({
      secret: "someone-elses-secret",
      token: { id: f.customerA.id, role: "CUSTOMER", typ: "mobile-access" },
    });
    expect(await sessionFromBearer(`Bearer ${otherSecret}`)).toBeNull();
    // A website session cookie value is not accepted as an app bearer token.
    const cookieLike = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { id: f.customerA.id, role: "CUSTOMER" } });
    expect(await sessionFromBearer(`Bearer ${cookieLike}`)).toBeNull();
    expect(await sessionFromBearer("Basic abc")).toBeNull();
  });

  it("A-12 a deactivated user's token stops working immediately", async () => {
    const { data } = await (await signIn("customer.b@test.local")).json();
    await prisma.user.update({ where: { id: f.customerB.id }, data: { isActive: false } });
    expect(await sessionFromBearer(`Bearer ${data.accessToken}`)).toBeNull();
    await prisma.user.update({ where: { id: f.customerB.id }, data: { isActive: true } });
  });

  it("A-08 refresh rotates the token pair and the old refresh token stops working", async () => {
    const first = (await (await signIn("customer.a@test.local")).json()).data;
    const r1 = await post(refresh, { refreshToken: first.refreshToken });
    expect(r1.status).toBe(200);
    const second = (await r1.json()).data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(await sessionFromBearer(`Bearer ${second.accessToken}`)).not.toBeNull();
  });

  it("A-09 reusing an old refresh token revokes the whole sign-in", async () => {
    const first = (await (await signIn("customer.a@test.local")).json()).data;
    const second = (await (await post(refresh, { refreshToken: first.refreshToken })).json()).data;
    const replay = await post(refresh, { refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect((await replay.json()).code).toBe("REFRESH_REUSED");
    // The legitimate newer token is now revoked too.
    const after = await post(refresh, { refreshToken: second.refreshToken });
    expect(after.status).toBe(401);
  });

  it("A-09 two refreshes of the same token at once: only one wins", async () => {
    const first = (await (await signIn("customer.a@test.local")).json()).data;
    const [a, b] = await Promise.all([
      post(refresh, { refreshToken: first.refreshToken }),
      post(refresh, { refreshToken: first.refreshToken }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it("A-10 logout revokes the refresh token", async () => {
    const s = (await (await signIn("customer.a@test.local")).json()).data;
    expect((await post(logout, { refreshToken: s.refreshToken })).status).toBe(200);
    expect((await post(refresh, { refreshToken: s.refreshToken })).status).toBe(401);
  });

  it("A-10 refresh with garbage is 401, logout with garbage is still 200", async () => {
    expect((await post(refresh, { refreshToken: "not-a-token" })).status).toBe(401);
    expect((await post(logout, { refreshToken: "not-a-token" })).status).toBe(200);
  });

  it("A-14 sign-in is rate limited per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await signIn("customer.a@test.local", "x", "customer", "10.9.9.9")).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.indexOf(429)).toBe(20);
  });

  it("A-11 website sign-in (NextAuth authorize) behaves exactly as before the refactor", async () => {
    const { authOptions } = await import("@/lib/auth/auth");
    const provider = authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>, req: unknown) => Promise<unknown> };
    };
    const authorize = provider.options.authorize;
    await expect(
      authorize({ identifier: "customer.a@test.local", password: "Correct#123", portal: "customer" }, { headers: {} })
    ).resolves.toEqual({
      id: f.customerA.id,
      email: "customer.a@test.local",
      name: "Customer A",
      phone: "03001234567",
      role: "CUSTOMER",
      mustChangePassword: false,
    });
    await expect(
      authorize({ identifier: "customer.a@test.local", password: "bad", portal: "customer" }, { headers: {} })
    ).rejects.toThrow("Invalid credentials");
    await expect(
      authorize({ identifier: "customer.a@test.local", password: "Correct#123", portal: "store" }, { headers: {} })
    ).rejects.toThrow("Unauthorized store access");
    // Admin sign-in is still written to the audit log.
    const adminSignIns = () => prisma.auditLog.count({ where: { action: "ADMIN_SIGN_IN", userId: f.admin.id } });
    const before = await adminSignIns();
    await authorize({ identifier: "admin@test.local", password: "Correct#123", portal: "admin" }, { headers: {} });
    expect(await adminSignIns()).toBe(before + 1);
  });

  it("an unapproved store owner signs in with storeApproved=false", async () => {
    await prisma.store.update({ where: { id: f.S2.id }, data: { status: "PENDING" } });
    const { data } = await (await signIn("owner.s2@test.local", "Correct#123", "store")).json();
    expect(data.user.storeApproved).toBe(false);
    const session = await sessionFromBearer(`Bearer ${data.accessToken}`);
    expect(session?.user.storeApproved).toBe(false);
    await prisma.store.update({ where: { id: f.S2.id }, data: { status: "APPROVED" } });
  });
});

describeDb("local development sign-in without Firebase", () => {
  beforeAll(async () => {
    await resetDb();
    await seedStandardFixtures();
  });

  it("with no Firebase configured, the bcrypt password signs in (dev and tests only)", async () => {
    fb.enabled = false;
    try {
      const ok = await signIn("customer.a@test.local", TEST_PASSWORD);
      expect(ok.status).toBe(200);
      const bad = await signIn("customer.a@test.local", "wrong");
      expect(bad.status).toBe(401);
    } finally {
      fb.enabled = true;
    }
  });

  it("is never active in production", async () => {
    const { localDevWithoutFirebase } = await import("@/lib/auth/password-check");
    fb.enabled = false;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(localDevWithoutFirebase()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fb.enabled = true;
    }
  });
});

describe("mobile auth without a database", () => {
  it("rejects a missing or malformed Authorization header without touching the DB", async () => {
    expect(await sessionFromBearer(null)).toBeNull();
    expect(await sessionFromBearer("")).toBeNull();
    expect(await sessionFromBearer("Bearer")).toBeNull();
  });
});
