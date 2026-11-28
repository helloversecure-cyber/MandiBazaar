import { prisma } from "@/lib/db";
import {
  deletePublicFromNeonStorage,
  neonPrivateStorageConfigured,
  publicKeyFromUrl,
  readPrivateFromNeonStorage,
  readPublicFromNeonStorage,
  uploadPrivateToNeonStorage,
} from "@/lib/uploads/neon-storage";
import { isPrivateFolder, privateFileUrl, privateKey } from "@/lib/uploads/private-files";

/**
 * One-time move of identity documents and proofs uploaded before the
 * private bucket existed: copy each from the public bucket to the private
 * one, point the record at the new /api/files link, and log it. The public
 * copy is deleted later, in a separate step, once an admin has checked that
 * the documents open.
 */

type Target = { model: "rider" | "storeDocument" | "paymentProof" | "remittanceSubmission"; field: string };

export const TARGETS: Target[] = [
  { model: "rider", field: "photoUrl" },
  { model: "rider", field: "cnicUrl" },
  { model: "rider", field: "cnicBackUrl" },
  { model: "rider", field: "licenseUrl" },
  { model: "rider", field: "bikeUrl" },
  { model: "rider", field: "bikeCardUrl" },
  { model: "storeDocument", field: "url" },
  { model: "paymentProof", field: "imageUrl" },
  { model: "remittanceSubmission", field: "proofUrl" },
];

export const MOVED_ACTION = "PRIVATE_FILE_MOVED";
export const PUBLIC_DELETED_ACTION = "PRIVATE_FILE_PUBLIC_DELETED";
const ENTITY = "UploadFile";

// Prisma delegates share these two calls; typed loosely on purpose.
type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
const delegate = (m: Target["model"]) => (prisma as unknown as Record<string, Delegate>)[m];

/** `{ key, folder, name }` when [url] is a public copy that should be private. */
function privateCandidate(url: unknown): { key: string; folder: string; name: string } | null {
  const key = publicKeyFromUrl(typeof url === "string" ? url : null);
  if (!key) return null;
  const [, folder, name] = key.split("/");
  return isPrivateFolder(folder) ? { key, folder, name } : null;
}

async function publicLinks(t: Target): Promise<string[]> {
  const rows = await delegate(t.model).findMany({
    where: { [t.field]: { contains: "/mandibazaar/" } },
    select: { [t.field]: true },
  });
  return rows.map((r) => r[t.field]).filter((u): u is string => privateCandidate(u) !== null);
}

export type PrivateFilesReport = {
  configured: boolean;
  /** Records still pointing at a public copy, per "model.field". */
  pending: Record<string, number>;
  pendingTotal: number;
  /** Files moved whose public copy still exists. */
  publicCopiesLeft: number;
};

export async function privateFilesReport(): Promise<PrivateFilesReport> {
  const pending: Record<string, number> = {};
  let pendingTotal = 0;
  for (const t of TARGETS) {
    const n = (await publicLinks(t)).length;
    if (n) pending[`${t.model}.${t.field}`] = n;
    pendingTotal += n;
  }
  return {
    configured: neonPrivateStorageConfigured(),
    pending,
    pendingTotal,
    publicCopiesLeft: (await movedNotDeleted()).length,
  };
}

export type MoveResult = { moved: number; missing: string[]; failed: number; remaining: number };

/** Moves up to [limit] files (keeps each request short on Vercel). */
export async function movePrivateFiles(adminId: string, limit = 25): Promise<MoveResult> {
  if (!neonPrivateStorageConfigured()) throw new Error("PRIVATE_STORAGE_NOT_CONFIGURED");
  const seen = new Set<string>();
  let moved = 0;
  let failed = 0;
  const missing: string[] = [];
  for (const t of TARGETS) {
    for (const url of await publicLinks(t)) {
      if (moved + failed + missing.length >= limit) break;
      if (seen.has(url)) continue;
      seen.add(url);
      const c = privateCandidate(url)!;
      try {
        const file = await readPublicFromNeonStorage(c.key);
        if (!file) {
          missing.push(`${t.model}.${t.field}`);
          continue;
        }
        await uploadPrivateToNeonStorage({ bytes: Buffer.from(file.bytes), key: privateKey(c.folder, c.name), mime: file.mime });
        const next = privateFileUrl(c.folder, c.name);
        // Every record using this link, in any table, moves together.
        for (const other of TARGETS) {
          await delegate(other.model).updateMany({ where: { [other.field]: url }, data: { [other.field]: next } });
        }
        await prisma.auditLog.create({
          data: {
            userId: adminId,
            action: MOVED_ACTION,
            entity: ENTITY,
            entityId: c.key,
            previousValue: { url },
            newValue: { url: next },
          },
        });
        moved += 1;
      } catch (e) {
        console.error("[move-private] failed:", (e as Error).message);
        failed += 1;
      }
    }
  }
  const remaining = (await privateFilesReport()).pendingTotal;
  return { moved, missing, failed, remaining };
}

async function movedNotDeleted(): Promise<string[]> {
  const [moved, deleted] = await Promise.all([
    prisma.auditLog.findMany({ where: { action: MOVED_ACTION, entity: ENTITY }, select: { entityId: true } }),
    prisma.auditLog.findMany({ where: { action: PUBLIC_DELETED_ACTION, entity: ENTITY }, select: { entityId: true } }),
  ]);
  const gone = new Set(deleted.map((d) => d.entityId));
  return Array.from(new Set(moved.map((m) => m.entityId).filter((k): k is string => !!k && !gone.has(k))));
}

/**
 * Deletes the public copies of moved files, only where the private copy is
 * confirmed to exist. Up to [limit] per call.
 */
export async function deletePublicCopies(adminId: string, limit = 25): Promise<{ deleted: number; kept: number; remaining: number }> {
  if (!neonPrivateStorageConfigured()) throw new Error("PRIVATE_STORAGE_NOT_CONFIGURED");
  let deleted = 0;
  let kept = 0;
  for (const key of (await movedNotDeleted()).slice(0, limit)) {
    const [, folder, name] = key.split("/");
    const safe = await readPrivateFromNeonStorage(privateKey(folder, name)).catch(() => null);
    if (!safe) {
      kept += 1;
      continue;
    }
    try {
      await deletePublicFromNeonStorage(key);
      await prisma.auditLog.create({
        data: { userId: adminId, action: PUBLIC_DELETED_ACTION, entity: ENTITY, entityId: key },
      });
      deleted += 1;
    } catch (e) {
      console.error("[move-private] delete failed:", (e as Error).message);
      kept += 1;
    }
  }
  return { deleted, kept, remaining: (await movedNotDeleted()).length };
}
