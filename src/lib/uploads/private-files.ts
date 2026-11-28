import { createHmac, timingSafeEqual } from "crypto";
import { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlatformAdminRole } from "@/lib/auth/permissions";

/**
 * Private uploads: identity documents and payment / remittance proofs.
 *
 * They go to a private Neon bucket (NEON_STORAGE_PRIVATE_BUCKET) instead of
 * the public one, and the database keeps a link on our own site,
 * `<app>/api/files/<folder>/<file>`. That route checks who is asking and
 * streams the file; the bucket address is never handed out.
 *
 * Who may open a file:
 * - platform admins: everything;
 * - the person it belongs to (the rider for their documents and remittance
 *   proofs, the store owner for store documents, the customer for their
 *   order's receipt, whoever uploaded a receipt);
 * - any signed-in user for a rider's profile photo (customers see it on
 *   their order, as before);
 * - anyone holding the short-lived preview link returned by the upload,
 *   so sign-up forms can show the photo before an account exists.
 */

/** Folders whose files are private. Everything else stays public. */
export const PRIVATE_FOLDERS = new Set([
  "cnic",
  "proofs",
  "riders",
  "payment-proofs",
  "remittance-proofs",
]);

export function isPrivateFolder(folder: string): boolean {
  return PRIVATE_FOLDERS.has(folder.toLowerCase());
}

const NAME = /^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/i;

/** Storage key inside the private bucket. */
export function privateKey(folder: string, name: string): string {
  return `mandibazaar/${folder}/${name}`;
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.mandibazaar.pk").replace(
    /\/+$/,
    "",
  );
}

/** The link saved in the database for a private file. */
export function privateFileUrl(folder: string, name: string): string {
  return `${appOrigin()}/api/files/${folder}/${name}`;
}

/** `{ folder, name }` when [url] is one of our private-file links, else null. */
export function parsePrivateFileUrl(url: string | null | undefined): { folder: string; name: string } | null {
  const u = (url || "").trim();
  if (!u || u.length > 500) return null;
  let path: string;
  if (u.startsWith("/api/files/")) path = u;
  else {
    try {
      const parsed = new URL(u);
      if (parsed.origin !== new URL(appOrigin()).origin || parsed.search) return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  const m = /^\/api\/files\/([a-z0-9_-]+)\/([^/]+)$/i.exec(path);
  if (!m || !isPrivateFolder(m[1]) || !NAME.test(m[2])) return null;
  return { folder: m[1].toLowerCase(), name: m[2] };
}

// ---- short-lived preview links -------------------------------------------

/** How long the preview link returned by an upload works. */
export const PREVIEW_TTL_SECONDS = 30 * 60;

function previewSecret(): string {
  return process.env.NEXTAUTH_SECRET || "discount-price-dev-secret-change-in-production";
}

function previewSig(folder: string, name: string, exp: number): string {
  return createHmac("sha256", previewSecret())
    .update(`private-file:${folder}/${name}:${exp}`)
    .digest("base64url");
}

/** The upload's own preview link: `<file link>?exp=…&sig=…`. */
export function privatePreviewUrl(folder: string, name: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + PREVIEW_TTL_SECONDS;
  return `${privateFileUrl(folder, name)}?exp=${exp}&sig=${previewSig(folder, name, exp)}`;
}

export function previewAllowed(
  folder: string,
  name: string,
  exp: string | null,
  sig: string | null,
  nowMs = Date.now(),
): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isInteger(e) || e < Math.floor(nowMs / 1000)) return false;
  const want = Buffer.from(previewSig(folder, name, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---- who may open a file --------------------------------------------------

export type Viewer = { id: string; role: RoleName | string | null | undefined } | null;

/**
 * True when [viewer] may open the private file. Matches the stored link
 * (absolute or path form) against the records that use it.
 */
export async function canViewPrivateFile(viewer: Viewer, folder: string, name: string): Promise<boolean> {
  if (!viewer?.id) return false;
  if (viewer.role && isPlatformAdminRole(viewer.role as RoleName)) return true;

  const links = [privateFileUrl(folder, name), `/api/files/${folder}/${name}`];
  const anyOf = (field: string) => links.map((l) => ({ [field]: l }));

  switch (folder) {
    case "riders": {
      // A rider's profile photo is shown to customers on their orders.
      if (await prisma.rider.count({ where: { OR: anyOf("photoUrl") } })) return true;
      return (
        (await prisma.rider.count({
          where: {
            userId: viewer.id,
            OR: ["cnicUrl", "cnicBackUrl", "licenseUrl", "bikeUrl", "bikeCardUrl", "photoUrl"].flatMap(anyOf),
          },
        })) > 0
      );
    }
    case "cnic":
    case "proofs": {
      // Store sign-up documents (owner) and rider CNIC photos uploaded here.
      if (
        await prisma.storeDocument.count({
          where: { store: { ownerId: viewer.id }, OR: anyOf("url") },
        })
      )
        return true;
      return (
        (await prisma.rider.count({
          where: { userId: viewer.id, OR: ["cnicUrl", "cnicBackUrl", "licenseUrl"].flatMap(anyOf) },
        })) > 0
      );
    }
    case "payment-proofs": {
      return (
        (await prisma.paymentProof.count({
          where: {
            OR: anyOf("imageUrl"),
            AND: [{ OR: [{ uploadedById: viewer.id }, { order: { customerId: viewer.id } }] }],
          },
        })) > 0
      );
    }
    case "remittance-proofs": {
      return (
        (await prisma.remittanceSubmission.count({
          where: {
            OR: anyOf("proofUrl"),
            AND: [{ remittance: { rider: { userId: viewer.id } } }],
          },
        })) > 0
      );
    }
    default:
      return false;
  }
}
