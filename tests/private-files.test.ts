/**
 * Private uploads: identity documents and proofs live in a private bucket and
 * are served by /api/files after an access check.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock("@/lib/auth/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/auth")>();
  return { ...real, getSession: async () => auth.session };
});

const store = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; mime: string }>(),
  publicKeys: [] as string[],
  privateOn: true,
}));
vi.mock("@/lib/uploads/neon-storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/uploads/neon-storage")>();
  return {
    ...real,
    readPrivateFromNeonStorage: async (key: string) => store.files.get(key) ?? null,
    neonStorageConfigured: () => true,
    neonPrivateStorageConfigured: () => store.privateOn,
    uploadPrivateToNeonStorage: async (p: { bytes: Buffer; key: string; mime: string }) => {
      store.files.set(p.key, { bytes: new Uint8Array(p.bytes), mime: p.mime });
    },
    uploadToNeonStorage: async (p: { key: string }) => {
      store.publicKeys.push(p.key);
      return { url: `https://bucket.example/public/${p.key}`, key: p.key };
    },
  };
});

import { NextRequest } from "next/server";
import { GET as filesRoute } from "@/app/api/files/[folder]/[name]/route";
import { POST as uploadPost } from "@/app/api/upload/route";
import {
  canViewPrivateFile,
  isPrivateFolder,
  parsePrivateFileUrl,
  previewAllowed,
  privateFileUrl,
  privateKey,
  privatePreviewUrl,
  PREVIEW_TTL_SECONDS,
} from "@/lib/uploads/private-files";
import { isOwnUploadUrl } from "@/lib/uploads/neon-storage";
import { isUsableImageUrl } from "@/lib/orders/proof-review";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const ORIGIN = "https://www.mandibazaar.pk";
process.env.NEXT_PUBLIC_APP_URL = ORIGIN;

describe("private file links", () => {
  it("only identity documents and proofs are private", () => {
    for (const f of ["cnic", "proofs", "riders", "payment-proofs", "remittance-proofs"]) expect(isPrivateFolder(f)).toBe(true);
    for (const f of ["products", "stores", "logos", "shops", "categories"]) expect(isPrivateFolder(f)).toBe(false);
  });

  it("links are on our own site, https, and accepted as our uploads", () => {
    const url = privateFileUrl("cnic", "1-abc.webp");
    expect(url).toBe(`${ORIGIN}/api/files/cnic/1-abc.webp`);
    expect(parsePrivateFileUrl(url)).toEqual({ folder: "cnic", name: "1-abc.webp" });
    expect(isUsableImageUrl(url)).toBe(true);
    expect(isOwnUploadUrl(url)).toBe(true);
  });

  it("refuses look-alike links", () => {
    for (const bad of [
      "https://evil.example/api/files/cnic/1-abc.webp",
      `${ORIGIN}/api/files/products/1-abc.webp`,
      `${ORIGIN}/api/files/cnic/../x.webp`,
      `${ORIGIN}/api/files/cnic/1-abc.webp?x=1`,
      `${ORIGIN}/api/files/cnic/a/b.webp`,
    ]) {
      expect(parsePrivateFileUrl(bad)).toBeNull();
      expect(isOwnUploadUrl(bad)).toBe(false);
    }
  });

  it("preview links work for 30 minutes and only for that file", () => {
    const now = Date.parse("2026-11-28T10:00:00Z");
    const q = new URL(privatePreviewUrl("cnic", "1-abc.webp", now)).searchParams;
    const exp = q.get("exp");
    const sig = q.get("sig");
    expect(previewAllowed("cnic", "1-abc.webp", exp, sig, now)).toBe(true);
    expect(previewAllowed("cnic", "1-abc.webp", exp, sig, now + (PREVIEW_TTL_SECONDS + 1) * 1000)).toBe(false);
    expect(previewAllowed("cnic", "2-other.webp", exp, sig, now)).toBe(false);
    expect(previewAllowed("cnic", "1-abc.webp", String(Number(exp) + 999), sig, now)).toBe(false);
    expect(previewAllowed("cnic", "1-abc.webp", exp, "forged", now)).toBe(false);
  });
});

describeDb("who may open a private file", () => {
  let f: Fixtures;
  const doc = "1-doc.webp";

  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
    const riderUserId = (await prisma.rider.findUniqueOrThrow({ where: { id: f.R1.id } })).userId!;
    await prisma.rider.update({
      where: { id: f.R1.id },
      data: { cnicUrl: privateFileUrl("riders", doc), photoUrl: privateFileUrl("riders", "1-face.webp") },
    });
    await prisma.storeDocument.create({
      data: { storeId: f.S1.id, type: "CNIC_FRONT", url: privateFileUrl("cnic", doc) },
    });
    store.files.set(privateKey("riders", doc), { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp" });
    store.files.set(privateKey("cnic", doc), { bytes: new Uint8Array([4, 5]), mime: "image/webp" });
    (globalThis as { riderUserId?: string }).riderUserId = riderUserId;
  });
  beforeEach(() => {
    auth.session = null;
    resetRateLimitsForTests();
  });

  const riderUser = () => ({ id: (globalThis as { riderUserId?: string }).riderUserId!, role: "RIDER" });
  const get = (folder: string, name: string, query = "") =>
    filesRoute(new NextRequest(`${ORIGIN}/api/files/${folder}/${name}${query}`), { params: { folder, name } });

  it("the rider sees their own CNIC; another user and a guest do not", async () => {
    expect(await canViewPrivateFile(riderUser(), "riders", doc)).toBe(true);
    expect(await canViewPrivateFile({ id: f.customerA.id, role: "CUSTOMER" }, "riders", doc)).toBe(false);
    expect(await canViewPrivateFile(null, "riders", doc)).toBe(false);
  });

  it("a rider's profile photo is visible to signed-in users (customers see it on orders)", async () => {
    expect(await canViewPrivateFile({ id: f.customerA.id, role: "CUSTOMER" }, "riders", "1-face.webp")).toBe(true);
    expect(await canViewPrivateFile(null, "riders", "1-face.webp")).toBe(false);
  });

  it("the store owner sees their store documents; another owner does not", async () => {
    const s1 = await prisma.store.findUniqueOrThrow({ where: { id: f.S1.id } });
    const s2 = await prisma.store.findUniqueOrThrow({ where: { id: f.S2.id } });
    expect(await canViewPrivateFile({ id: s1.ownerId, role: "STORE_OWNER" }, "cnic", doc)).toBe(true);
    expect(await canViewPrivateFile({ id: s2.ownerId, role: "STORE_OWNER" }, "cnic", doc)).toBe(false);
  });

  it("admins see everything", async () => {
    expect(await canViewPrivateFile({ id: f.admin.id, role: "SUPER_ADMIN" }, "cnic", doc)).toBe(true);
    expect(await canViewPrivateFile({ id: f.admin.id, role: "SUPER_ADMIN" }, "riders", doc)).toBe(true);
  });

  it("route: owner gets the image, private and not shared-cacheable", async () => {
    auth.session = { user: riderUser() };
    const res = await get("riders", doc);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("route: guest, other user, unknown file and public folder all get 404", async () => {
    expect((await get("riders", doc)).status).toBe(404);
    auth.session = { user: { id: f.customerA.id, role: "CUSTOMER" } };
    expect((await get("riders", doc)).status).toBe(404);
    auth.session = { user: { id: f.admin.id, role: "SUPER_ADMIN" } };
    expect((await get("riders", "9-missing.webp")).status).toBe(404);
    expect((await get("products", doc)).status).toBe(404);
    expect((await get("riders", "..%2Fx.webp")).status).toBe(404);
  });

  it("route: the upload's preview link works without an account", async () => {
    const q = new URL(privatePreviewUrl("cnic", doc)).search;
    expect((await get("cnic", doc, q)).status).toBe(200);
    expect((await get("cnic", doc, q.replace(/sig=[^&]+/, "sig=nope"))).status).toBe(404);
  });
});

describe("uploading a private document", () => {
  async function upload(folder: string) {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#336699" } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "doc.png");
    form.set("folder", folder);
    const res = await uploadPost(new NextRequest("http://localhost/api/upload", { method: "POST", body: form }));
    return { status: res.status, body: await res.json() };
  }
  beforeEach(() => {
    auth.session = null;
    resetRateLimitsForTests();
    store.publicKeys.length = 0;
    store.privateOn = true;
  });

  it("a guest's CNIC goes to the private bucket: protected link plus a working preview", async () => {
    const { status, body } = await upload("cnic");
    expect(status).toBe(200);
    expect(body.data.via).toBe("neon-private");
    const parsed = parsePrivateFileUrl(body.data.url);
    expect(parsed?.folder).toBe("cnic");
    expect(store.files.has(privateKey("cnic", parsed!.name))).toBe(true);
    expect(store.publicKeys).toEqual([]);
    const q = new URL(body.data.previewUrl).search;
    const res = await filesRoute(new NextRequest(`${body.data.url}${q}`), { params: parsed! });
    expect(res.status).toBe(200);
    // The saved link alone does not open it for a guest.
    expect((await filesRoute(new NextRequest(body.data.url), { params: parsed! })).status).toBe(404);
  });

  it("product and logo photos stay public", async () => {
    auth.session = { user: { id: "u1", role: "SUPER_ADMIN" } };
    const { body } = await upload("logos");
    expect(body.data.via).not.toBe("neon-private");
    expect(body.data.previewUrl).toBeUndefined();
  });

  it("without the private bucket set, uploads keep working (stored as before)", async () => {
    store.privateOn = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { status, body } = await upload("cnic");
    warn.mockRestore();
    expect(status).toBe(200);
    expect(body.data.via).not.toBe("neon-private");
    expect(store.publicKeys.length).toBe(1);
  });
});
