/**
 * Moving documents uploaded before the private bucket existed.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.NEON_STORAGE_ACCESS_KEY = "k";
  process.env.NEON_STORAGE_SECRET_KEY = "s";
  process.env.NEON_STORAGE_ENDPOINT = "https://storage.example";
  process.env.NEON_STORAGE_BUCKET = "mandibazaar";
  process.env.NEON_STORAGE_PRIVATE_BUCKET = "mandibazaar-private";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.mandibazaar.pk";
  return {
    pub: new Map<string, { bytes: Uint8Array; mime: string }>(),
    priv: new Map<string, { bytes: Uint8Array; mime: string }>(),
  };
});

vi.mock("@/lib/uploads/neon-storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/uploads/neon-storage")>();
  return {
    ...real,
    readPublicFromNeonStorage: async (key: string) => env.pub.get(key) ?? null,
    readPrivateFromNeonStorage: async (key: string) => env.priv.get(key) ?? null,
    uploadPrivateToNeonStorage: async (p: { bytes: Buffer; key: string; mime: string }) => {
      env.priv.set(p.key, { bytes: new Uint8Array(p.bytes), mime: p.mime });
    },
    deletePublicFromNeonStorage: async (key: string) => {
      env.pub.delete(key);
    },
  };
});

import { deletePublicCopies, movePrivateFiles, privateFilesReport } from "@/lib/uploads/move-private";
import { privateFileUrl } from "@/lib/uploads/private-files";
import { prisma, resetDb } from "./helpers/db";
import { describeDb } from "./helpers/describe-db";
import { seedStandardFixtures, type Fixtures } from "./helpers/fixtures";

const PUB = "https://storage.example/mandibazaar/mandibazaar";
const img = { bytes: new Uint8Array([9, 9]), mime: "image/webp" };

describeDb("moving old documents to the private bucket", () => {
  let f: Fixtures;
  beforeAll(async () => {
    await resetDb();
    f = await seedStandardFixtures();
  });
  afterAll(() => {
    for (const k of [
      "NEON_STORAGE_ACCESS_KEY",
      "NEON_STORAGE_SECRET_KEY",
      "NEON_STORAGE_ENDPOINT",
      "NEON_STORAGE_BUCKET",
      "NEON_STORAGE_PRIVATE_BUCKET",
    ]) {
      delete process.env[k];
    }
  });
  beforeEach(async () => {
    env.pub.clear();
    env.priv.clear();
    await prisma.auditLog.deleteMany({ where: { entity: "UploadFile" } });
    await prisma.storeDocument.deleteMany({});
    await prisma.rider.update({
      where: { id: f.R1.id },
      data: { cnicUrl: `${PUB}/riders/1-cnic.webp`, photoUrl: `${PUB}/riders/1-face.webp`, licenseUrl: null },
    });
    await prisma.storeDocument.createMany({
      data: [
        { storeId: f.S1.id, type: "CNIC_FRONT", url: `${PUB}/cnic/1-front.webp` },
        // Shop photos stay public.
        { storeId: f.S1.id, type: "SHOP_IMAGE", url: `${PUB}/shops/1-shop.webp` },
      ],
    });
    for (const k of ["riders/1-cnic.webp", "riders/1-face.webp", "cnic/1-front.webp", "shops/1-shop.webp"]) {
      env.pub.set(`mandibazaar/${k}`, img);
    }
  });

  it("reports what is still public, leaving shop photos alone", async () => {
    const r = await privateFilesReport();
    expect(r.configured).toBe(true);
    expect(r.pending).toEqual({ "rider.photoUrl": 1, "rider.cnicUrl": 1, "storeDocument.url": 1 });
    expect(r.pendingTotal).toBe(3);
    expect(r.publicCopiesLeft).toBe(0);
  });

  it("moves: private copy written, records point at /api/files, logged; public copy kept", async () => {
    const res = await movePrivateFiles(f.admin.id);
    expect(res).toMatchObject({ moved: 3, failed: 0, remaining: 0 });
    const rider = await prisma.rider.findUniqueOrThrow({ where: { id: f.R1.id } });
    expect(rider.cnicUrl).toBe(privateFileUrl("riders", "1-cnic.webp"));
    expect(env.priv.has("mandibazaar/riders/1-cnic.webp")).toBe(true);
    expect(env.pub.has("mandibazaar/riders/1-cnic.webp")).toBe(true);
    const shop = await prisma.storeDocument.findFirstOrThrow({ where: { type: "SHOP_IMAGE" } });
    expect(shop.url).toBe(`${PUB}/shops/1-shop.webp`);
    expect(await prisma.auditLog.count({ where: { action: "PRIVATE_FILE_MOVED" } })).toBe(3);
    expect((await privateFilesReport()).publicCopiesLeft).toBe(3);
  });

  it("a file already gone from storage is reported, not moved", async () => {
    env.pub.delete("mandibazaar/cnic/1-front.webp");
    const res = await movePrivateFiles(f.admin.id);
    expect(res.moved).toBe(2);
    expect(res.missing).toEqual(["storeDocument.url"]);
  });

  it("removes public copies only where the private copy exists", async () => {
    await movePrivateFiles(f.admin.id);
    env.priv.delete("mandibazaar/riders/1-face.webp");
    const res = await deletePublicCopies(f.admin.id);
    expect(res).toEqual({ deleted: 2, kept: 1, remaining: 1 });
    expect(env.pub.has("mandibazaar/riders/1-cnic.webp")).toBe(false);
    expect(env.pub.has("mandibazaar/riders/1-face.webp")).toBe(true);
    expect(env.pub.has("mandibazaar/shops/1-shop.webp")).toBe(true);
  });

  it("works in small batches", async () => {
    const res = await movePrivateFiles(f.admin.id, 2);
    expect(res.moved).toBe(2);
    expect(res.remaining).toBe(1);
  });
});
