/**
 * Rejected riders: sign-in, work-action gating, POST /api/rider/reapply, and no
 * PII in the PATCH /api/rider SET_STATUS response.
 * Firebase is mocked (password "Correct#123", every email verified). The session
 * comes from a mocked getServerSession (website cookie) or a mocked
 * Authorization header (app bearer token).
 */
import { beforeEach, expect, it, vi } from "vitest";

const fb = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/firebase/admin", () => ({
  firebaseAuthEnabled: () => fb.enabled,
  getFirebaseUserByEmail: vi.fn(async (email: string) => ({ uid: `fb-${email}`, emailVerified: true, disabled: false })),
  verifyFirebasePassword: vi.fn(async (_email: string, password: string) =>
    password === "Correct#123" ? { ok: true } : { ok: false, reason: "INVALID_PASSWORD" }
  ),
  createFirebaseUser: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; name?: string; email?: string } },
  authorization: null as string | null,
}));
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => auth.session),
}));
vi.mock("next/headers", () => ({
  headers: () => new Headers(auth.authorization ? { authorization: auth.authorization } : {}),
}));

import { NextRequest } from "next/server";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { POST as mobileLogin } from "@/app/api/mobile/auth/login/route";
import { GET as riderGet, PATCH as riderPatch } from "@/app/api/rider/route";
import { POST as placeBid } from "@/app/api/rider/bids/route";
import { POST as reapply } from "@/app/api/rider/reapply/route";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";

const META = { ipAddress: "127.0.0.1", userAgent: "vitest" };

const VALID = {
  city: "Lahore",
  vehicleType: "Bike",
  cnicNumber: "35202-1234567-1",
  accountTitle: "Rider R3",
  accountNumber: "PK36 SCBL 0000 0011 2345 6702",
  bankName: "Standard Chartered",
  jazzCashNumber: "03111234567",
  photoUrl: "/uploads/riders/new-photo.jpg",
  cnicUrl: "/uploads/riders/new-cnic.jpg",
  cnicBackUrl: "/uploads/riders/new-cnic-back.jpg",
  licenseUrl: "/uploads/riders/new-licence.jpg",
  bikeUrl: "/uploads/riders/new-bike.jpg",
  bikeCardUrl: "/uploads/riders/new-bike-card.jpg",
};

function json(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const callReapply = (body: unknown) => reapply(json("http://localhost/api/rider/reapply", "POST", body));
const asUser = (u: { id: string }, role: string) => {
  auth.authorization = null;
  auth.session = { user: { id: u.id, role } };
};

describeDb("rejected riders and re-apply", () => {
  let f: Fixtures;
  let r3UserId: string;

  beforeEach(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    r3UserId = f.R3.userId!;
    await prisma.rider.update({
      where: { id: f.R3.id },
      data: {
        approvalStatus: "REJECTED",
        reviewNotes: "CNIC unreadable",
        isActive: false,
        status: "OFFLINE",
        cnicNumber: "35202-7654321-9",
        photoUrl: "/uploads/riders/old.jpg",
      },
    });
    auth.session = null;
    auth.authorization = null;
  });

  it("a rejected rider can sign in with signInWithPassword", async () => {
    const u = await signInWithPassword(
      { identifier: "rider.r3@test.local", password: "Correct#123", portal: "rider" },
      META
    );
    expect(u).toMatchObject({ id: r3UserId, role: "RIDER" });
  });

  it("security blocks still apply: an inactive rejected rider can't sign in", async () => {
    await prisma.user.update({ where: { id: r3UserId }, data: { isActive: false } });
    await expect(
      signInWithPassword({ identifier: "rider.r3@test.local", password: "Correct#123", portal: "rider" }, META)
    ).rejects.toThrow();
  });

  it("app login → bearer → profile shows the rejection → re-apply works", async () => {
    const res = await mobileLogin(
      json("http://localhost/api/mobile/auth/login", "POST", {
        identifier: "rider.r3@test.local",
        password: "Correct#123",
        portal: "rider",
      })
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.user.role).toBe("RIDER");

    auth.authorization = `Bearer ${data.accessToken}`;
    const prof = await riderGet(new NextRequest("http://localhost/api/rider?resource=profile"));
    expect(prof.status).toBe(200);
    const p = (await prof.json()).data.rider;
    expect(p).toMatchObject({ approvalStatus: "REJECTED", reviewNotes: "CNIC unreadable" });

    const r = await callReapply(VALID);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ riderId: f.R3.id, approvalStatus: "PENDING" });
  });

  it("a rejected rider gets 403 on work actions and an empty dashboard", async () => {
    asUser({ id: r3UserId }, "RIDER");
    const set = await riderPatch(json("http://localhost/api/rider", "PATCH", { action: "SET_STATUS", status: "AVAILABLE" }));
    expect(set.status).toBe(403);
    expect((await prisma.rider.findUniqueOrThrow({ where: { id: f.R3.id } })).status).toBe("OFFLINE");

    const bid = await placeBid(json("http://localhost/api/rider/bids", "POST", { requestId: "x", amount: 150 }));
    expect(bid.status).toBe(403);

    const deliver = await riderPatch(json("http://localhost/api/rider", "PATCH", { action: "START_DELIVERY", orderId: "x" }));
    expect(deliver.status).toBe(403);

    const dash = await riderGet(new NextRequest("http://localhost/api/rider?resource=dashboard"));
    const d = (await dash.json()).data;
    expect(d.pendingApproval).toBe(true);
    expect(d.rider.approvalStatus).toBe("REJECTED");
    expect(d.recent).toEqual([]);
  });

  it("re-apply updates the fields, sets PENDING, clears reviewNotes and writes an audit row", async () => {
    asUser({ id: r3UserId }, "RIDER");
    const res = await callReapply({ ...VALID, vehicleType: "Car" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ riderId: f.R3.id, approvalStatus: "PENDING" });

    const r = await prisma.rider.findUniqueOrThrow({ where: { id: f.R3.id } });
    expect(r).toMatchObject({
      approvalStatus: "PENDING",
      reviewNotes: null,
      isActive: false,
      status: "OFFLINE",
      city: "Lahore",
      vehicleType: "Car",
      cnicNumber: "35202-1234567-1",
      accountNumber: "PK36SCBL0000001123456702",
      accountTitle: "Rider R3",
      bankName: "Standard Chartered",
      jazzCashNumber: "03111234567",
      photoUrl: VALID.photoUrl,
      cnicUrl: VALID.cnicUrl,
      cnicBackUrl: VALID.cnicBackUrl,
      licenseUrl: VALID.licenseUrl,
      bikeUrl: VALID.bikeUrl,
      bikeCardUrl: VALID.bikeCardUrl,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "RIDER_REAPPLIED", entityId: f.R3.id } });
    expect(log.userId).toBe(r3UserId);

    // A second submit is refused now that it's PENDING.
    expect((await callReapply(VALID)).status).toBe(403);
  });

  it("re-apply is 403 for a pending or approved rider and for a non-rider, 401 signed out", async () => {
    await prisma.rider.update({ where: { id: f.R3.id }, data: { approvalStatus: "PENDING" } });
    asUser({ id: r3UserId }, "RIDER");
    expect((await callReapply(VALID)).status).toBe(403);

    asUser({ id: f.R1.userId! }, "RIDER"); // APPROVED
    expect((await callReapply(VALID)).status).toBe(403);

    asUser(f.customerA, "CUSTOMER");
    expect((await callReapply(VALID)).status).toBe(403);

    auth.session = null;
    expect((await callReapply(VALID)).status).toBe(401);

    const r = await prisma.rider.findUniqueOrThrow({ where: { id: f.R1.id } });
    expect(r.approvalStatus).toBe("APPROVED");
    expect(await prisma.auditLog.count({ where: { action: "RIDER_REAPPLIED" } })).toBe(0);
  });

  it("re-apply is 400 with fieldErrors for invalid input (same rules as signup)", async () => {
    asUser({ id: r3UserId }, "RIDER");
    const res = await callReapply({
      ...VALID,
      city: "12345",
      vehicleType: "Aeroplane",
      cnicNumber: "872164872xb129874",
      accountNumber: "",
      jazzCashNumber: "",
      bikeCardUrl: "",
      photoUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    for (const k of ["city", "vehicleType", "cnicNumber", "accountNumber", "bikeCardUrl", "photoUrl"]) {
      expect(body.fieldErrors[k]).toBeTruthy();
    }
    const r = await prisma.rider.findUniqueOrThrow({ where: { id: f.R3.id } });
    expect(r.approvalStatus).toBe("REJECTED");
  });

  it("re-apply is 409 when the CNIC belongs to another rider (dashed or digits)", async () => {
    await prisma.rider.update({ where: { id: f.R1.id }, data: { cnicNumber: "3520212345671" } });
    asUser({ id: r3UserId }, "RIDER");
    const res = await callReapply(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).fieldErrors.cnicNumber).toBe("This CNIC is already registered to another rider.");
    // Keeping their own CNIC is fine.
    const own = await callReapply({ ...VALID, cnicNumber: "35202-7654321-9" });
    expect(own.status).toBe(200);
  });

  it("SET_STATUS returns only status fields, no CNIC or payout numbers", async () => {
    await prisma.rider.update({
      where: { id: f.R1.id },
      data: { cnicNumber: "35202-1111111-1", accountNumber: "PK36SCBL0000001123456702", jazzCashNumber: "03119999999" },
    });
    asUser({ id: f.R1.userId! }, "RIDER");
    const res = await riderPatch(json("http://localhost/api/rider", "PATCH", { action: "SET_STATUS", status: "BUSY" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual({ id: f.R1.id, status: "BUSY", isActive: true, approvalStatus: "APPROVED" });
    const text = JSON.stringify(data);
    for (const secret of ["35202-1111111-1", "PK36SCBL", "03119999999"]) expect(text).not.toContain(secret);
  });
});
