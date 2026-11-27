/**
 * Security review fixes that don't belong to one feature suite:
 * M3 (website sessions end when an account is deactivated/deleted), L5 (payment
 * proof URLs + upload errors), L6 (one pending proof per order), L7 (cron secret).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string | null; role: string } },
}));
vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/auth")>();
  return { ...real, getSession: async () => auth.session };
});

import { encode } from "next-auth/jwt";
import { getServerSession } from "next-auth/next";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { SESSION_REVOKED, authOptions } from "@/lib/auth/auth";
import { SESSION_RECHECK_MS, forgetSessionAccountStatus } from "@/lib/auth/session-status";
import { requestAccountDeletion } from "@/lib/account/deletion";
import { isOwnUploadUrl } from "@/lib/uploads/neon-storage";
import { cronAuthorized, safeEqual } from "@/lib/cron-auth";
import { POST as paymentProofPost } from "@/app/api/orders/payment-proof/route";
import { POST as uploadPost } from "@/app/api/upload/route";
import { GET as listsTickGet } from "@/app/api/cron/lists-tick/route";
import { NextRequest } from "next/server";

type JwtCb = (p: { token: Record<string, unknown>; user?: unknown; trigger?: string }) => Promise<Record<string, unknown>>;
const jwt = authOptions.callbacks!.jwt as unknown as JwtCb;

describeDb("M3 website sessions follow the account", () => {
  let f: Fixtures;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    forgetSessionAccountStatus();
  });

  const tokenFor = (id: string, role: string, checkedAt?: number) => ({ id, sub: id, role, name: "x", checkedAt });

  it("M3 a token checked recently is trusted without a DB read", async () => {
    // (deactivated in the DB, but the token was checked a minute ago → not re-read yet)
    await prisma.user.update({ where: { id: f.customerA.id }, data: { isActive: false } });
    const out = await jwt({ token: tokenFor(f.customerA.id, "CUSTOMER", Date.now() - 60_000) });
    expect(out.id).toBe(f.customerA.id);
  });

  it("M3 after the re-check window a deactivated account's session is revoked", async () => {
    await prisma.user.update({ where: { id: f.customerA.id }, data: { isActive: false } });
    await expect(jwt({ token: tokenFor(f.customerA.id, "CUSTOMER", Date.now() - SESSION_RECHECK_MS - 1) })).rejects.toThrow(
      SESSION_REVOKED
    );
    // old tokens without checkedAt are checked on first use
    await expect(jwt({ token: tokenFor(f.customerA.id, "CUSTOMER") })).rejects.toThrow(SESSION_REVOKED);
  });

  it("M3 an active account is re-checked at most once per window (cached), and picks up role changes", async () => {
    const old = Date.now() - SESSION_RECHECK_MS - 1;
    const first = await jwt({ token: tokenFor(f.customerA.id, "CUSTOMER", old) });
    expect(first.checkedAt).toBeGreaterThan(old);
    // A second request still carrying the old cookie (server components can't
    // rewrite it) is answered from the per-user cache, not the DB: a change made
    // in between isn't seen until the window passes.
    await prisma.user.update({ where: { id: f.customerA.id }, data: { isActive: false } });
    expect((await jwt({ token: tokenFor(f.customerA.id, "CUSTOMER", old) })).id).toBe(f.customerA.id);
    // ...unless the cache entry is dropped (deactivation / deletion do that)
    forgetSessionAccountStatus(f.customerA.id);
    await expect(jwt({ token: tokenFor(f.customerA.id, "CUSTOMER", old) })).rejects.toThrow(SESSION_REVOKED);

    const storeOwner = await prisma.role.findUniqueOrThrow({ where: { name: "STORE_OWNER" } });
    await prisma.user.update({ where: { id: f.customerB.id }, data: { roleId: storeOwner.id } });
    const upgraded = await jwt({ token: tokenFor(f.customerB.id, "CUSTOMER", old) });
    expect(upgraded.role).toBe("STORE_OWNER");
  });

  it("M3 a token without a user is signed out", async () => {
    await expect(jwt({ token: {} })).rejects.toThrow(SESSION_REVOKED);
  });

  it("M3 the session endpoint answers 'no session' and clears the cookie after self-deletion", async () => {
    const cookieName = "next-auth.session-token";
    const value = await encode({
      secret: process.env.NEXTAUTH_SECRET!,
      token: tokenFor(f.customerA.id, "CUSTOMER", Date.now() - SESSION_RECHECK_MS - 1) as never,
    });
    const ask = async () => {
      const set: string[] = [];
      const res = {
        getHeader: (n: string) => (n.toLowerCase() === "set-cookie" ? set : undefined),
        setHeader: (_n: string, v: string | string[]) => set.splice(0, set.length, ...([] as string[]).concat(v)),
      };
      const req = { headers: { host: "localhost", cookie: `${cookieName}=${value}` }, cookies: { [cookieName]: value } };
      const body = await getServerSession(req as never, res as never, authOptions);
      return { body, setCookies: set };
    };
    const live = await ask();
    expect(live.body?.user?.id).toBe(f.customerA.id);

    await requestAccountDeletion(f.customerA.id, {});
    const after = await ask();
    expect(after.body).toBeNull();
    expect(after.setCookies.some((c) => c.startsWith(`${cookieName}=;`))).toBe(true);
  });
});

const NEON = {
  NEON_STORAGE_ACCESS_KEY: "test-key",
  NEON_STORAGE_SECRET_KEY: "test-secret",
  NEON_STORAGE_ENDPOINT: "http://127.0.0.1:9/storage",
  NEON_STORAGE_BUCKET: "bucket-1",
};
const stubNeon = () => Object.entries(NEON).forEach(([k, v]) => vi.stubEnv(k, v));

describe("L5 receipts must come from our own upload storage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("L5 isOwnUploadUrl accepts only our bucket's mandibazaar/ objects (or local /uploads)", () => {
    for (const k of Object.keys(NEON)) vi.stubEnv(k, "");
    expect(isOwnUploadUrl("/uploads/payment-proofs/1700-abc123.webp")).toBe(true);
    expect(isOwnUploadUrl("http://127.0.0.1:9/storage/bucket-1/mandibazaar/payment-proofs/a.webp")).toBe(false);
    stubNeon();
    expect(isOwnUploadUrl("http://127.0.0.1:9/storage/bucket-1/mandibazaar/payment-proofs/1700-abc123.webp")).toBe(true);
    for (const bad of [
      "https://evil.example/receipt.jpg",
      "http://127.0.0.1:9/storage/other-bucket/mandibazaar/payment-proofs/a.webp",
      "http://127.0.0.1:9/storage/bucket-1/elsewhere/a.webp",
      "http://127.0.0.1:9/storage/bucket-1/mandibazaar/../x/a.webp",
      "http://127.0.0.1:9/storage/bucket-1/mandibazaar/payment-proofs/a.webp?x=1",
      "http://127.0.0.1:9/storage/bucket-1.evil.example/mandibazaar/payment-proofs/a.webp",
      "/uploads/../secret.webp",
      "//evil.example/uploads/a/b.webp",
      "",
    ]) {
      expect(isOwnUploadUrl(bad), bad).toBe(false);
    }
  });
});

describe("L7 cron secret", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it("L7 safeEqual compares in constant time and handles length differences", () => {
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abd", "Bearer abc")).toBe(false);
    expect(safeEqual("Bearer ab", "Bearer abc")).toBe(false);
    expect(safeEqual("", "Bearer abc")).toBe(false);
  });

  it("L7 cron routes accept only the exact bearer secret; production without a secret fails closed", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(cronAuthorized(req({ authorization: "Bearer s3cret" }))).toBe(true);
    expect(cronAuthorized(req({ authorization: "Bearer s3creT" }))).toBe(false);
    expect(cronAuthorized(req({ authorization: "Bearer s3cretX" }))).toBe(false);
    expect(cronAuthorized(req({ "x-vercel-cron": "1" }))).toBe(false);
    const res = await listsTickGet(new NextRequest("http://localhost/api/cron/lists-tick", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(cronAuthorized(req({ "x-vercel-cron": "1" }))).toBe(false);
  });
});

describeDb("L5 / L6 payment receipts", () => {
  let f: Fixtures;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    auth.session = { user: { id: f.customerA.id, role: "CUSTOMER" } };
  });

  afterEach(() => {
    auth.session = null;
    vi.unstubAllEnvs();
  });

  const pendingOrder = () =>
    prisma.order.create({
      data: {
        orderNumber: `T-${Math.random().toString(36).slice(2, 9)}`,
        customerId: f.customerA.id,
        subtotal: 100,
        deliveryFee: 50,
        grandTotal: 150,
        remainingAmount: 150,
        paymentMethod: "JAZZCASH",
        orderStatus: "PENDING_PAYMENT",
        deliveryAddressSnapshot: {},
      },
    });
  const submit = (orderId: string, imageUrl: string) =>
    paymentProofPost(
      new Request("http://localhost/api/orders/payment-proof", {
        method: "POST",
        body: JSON.stringify({ orderId, imageUrl }),
      })
    );

  it("L5 a receipt URL on another host is refused", async () => {
    const order = await pendingOrder();
    const res = await submit(order.id, "https://evil.example/receipt.jpg");
    expect(res.status).toBe(400);
    expect(await prisma.paymentProof.count()).toBe(0);
  });

  it("L6 two receipts submitted at the same moment create one pending proof", async () => {
    const order = await pendingOrder();
    const results = await Promise.all(
      [1, 2, 3].map((i) => submit(order.id, `/uploads/payment-proofs/170000000${i}-abcdef.webp`))
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect(await prisma.paymentProof.count({ where: { orderId: order.id, status: "PENDING_REVIEW" } })).toBe(1);
  });

  it("L6 another customer's order is not found", async () => {
    const order = await pendingOrder();
    auth.session = { user: { id: f.customerB.id, role: "CUSTOMER" } };
    expect((await submit(order.id, "/uploads/payment-proofs/1700-abcdef.webp")).status).toBe(404);
  });

  it("L5 upload errors are generic (no optimizer or storage internals)", async () => {
    const upload = async (bytes: Uint8Array, name: string) => {
      const form = new FormData();
      form.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }), name);
      form.set("folder", "payment-proofs");
      const res = await uploadPost(new NextRequest("http://localhost/api/upload", { method: "POST", body: form }));
      return { status: res.status, body: await res.json() };
    };
    const junk = await upload(new TextEncoder().encode("definitely not an image"), "r.png");
    expect(junk.status).toBe(400);
    expect(junk.body.error).toBe("We couldn't read that image. Please try another JPG or PNG photo.");

    stubNeon();
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await upload(new Uint8Array(png), "r.png");
    errSpy.mockRestore();
    expect(failed.status).toBe(400);
    expect(failed.body.error).toBe("Upload failed. Please try again.");
    expect(JSON.stringify(failed.body)).not.toMatch(/127\.0\.0\.1|bucket-1|ECONNREFUSED|NEON/i);
  });
});
