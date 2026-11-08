import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { RoleName } from "@prisma/client";
import { getSession } from "@/lib/auth/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  optimizeImageBuffer,
  parseImageKind,
} from "@/lib/uploads/optimize-image";
import {
  neonStorageConfigured,
  uploadToNeonStorage,
} from "@/lib/uploads/neon-storage";
import { canUploadToFolder } from "@/lib/uploads/upload-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Incoming file size before runtime optimize (user may pick a large phone photo). */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type UploadFile = {
  name?: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function getUploadFile(value: FormDataEntryValue | null): UploadFile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as UploadFile;
  if (typeof candidate.arrayBuffer !== "function") return null;
  if (typeof candidate.size !== "number") return null;
  return candidate;
}

function isAllowedImage(file: UploadFile): boolean {
  const type = file.type?.toLowerCase() || "";
  if (ALLOWED.has(type)) return true;
  const name = file.name?.toLowerCase() || "";
  return /\.(jpe?g|png|webp|heic|heif)$/.test(name);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const role = (session?.user?.role as RoleName | undefined) || null;
    const userId = session?.user?.id || null;
    const ip = clientIp(req);

    // Rate limit: tighter for guests (signup docs), higher for signed-in users.
    const rl = userId
      ? rateLimit(`upload:user:${userId}`, 30, 60_000)
      : rateLimit(`upload:ip:${ip}`, 8, 60_000);
    if (!rl.ok) {
      return apiError("Too many uploads. Please wait a minute and try again.", 429);
    }
    // Shared IP ceiling even when authenticated (shared NAT abuse).
    const ipRl = rateLimit(`upload:ip-all:${ip}`, 40, 60_000);
    if (!ipRl.ok) {
      return apiError("Too many uploads from this network. Please wait.", 429);
    }

    const form = await req.formData();
    const file = getUploadFile(form.get("file"));

    if (!file) {
      return apiError("Please choose an image file", 400);
    }

    if (!isAllowedImage(file)) {
      return apiError("Only image files are allowed (JPG, PNG, WEBP, HEIC)", 400);
    }

    if (file.size > MAX_INPUT_BYTES) {
      return apiError("Image must be under 25MB before optimization", 400);
    }

    const folder = String(form.get("folder") || "stores").replace(
      /[^a-z0-9_-]/gi,
      ""
    );
    if (!folder) {
      return apiError("Invalid upload folder", 400);
    }

    const access = canUploadToFolder(folder, role);
    if (!access.ok) {
      return apiError(access.error, access.status);
    }

    const kind = parseImageKind(String(form.get("kind") || ""), folder);
    const bytes = Buffer.from(await file.arrayBuffer());

    let optimized;
    try {
      optimized = await optimizeImageBuffer(bytes, kind);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Image optimization failed";
      return apiError(message, 400);
    }

    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${optimized.ext}`;
    const key = `mandibazaar/${folder}/${name}`;

    // Production / Vercel: Neon Object Storage is required (ephemeral disk).
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      if (!neonStorageConfigured()) {
        return apiError(
          "Image uploads require Neon Object Storage. In Neon Console create a public_read bucket + storage credential, then set NEON_STORAGE_ACCESS_KEY, NEON_STORAGE_SECRET_KEY, NEON_STORAGE_ENDPOINT, NEON_STORAGE_REGION, and NEON_STORAGE_BUCKET on Vercel.",
          503
        );
      }
      try {
        const uploaded = await uploadToNeonStorage({
          bytes: optimized.buffer,
          key,
          mime: optimized.mime,
        });
        return apiSuccess({
          url: uploaded.url,
          publicId: uploaded.key,
          via: "neon",
          kind: optimized.kind,
          bytes: optimized.bytes,
          width: optimized.width,
          height: optimized.height,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed";
        console.error("[upload:neon]", message, e);
        return apiError(message, 400);
      }
    }

    // Local development: prefer Neon when configured, else write optimized file locally.
    if (neonStorageConfigured()) {
      try {
        const uploaded = await uploadToNeonStorage({
          bytes: optimized.buffer,
          key,
          mime: optimized.mime,
        });
        return apiSuccess({
          url: uploaded.url,
          publicId: uploaded.key,
          via: "neon",
          kind: optimized.kind,
          bytes: optimized.bytes,
          width: optimized.width,
          height: optimized.height,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed";
        console.error("[upload:neon]", message, e);
        return apiError(message, 400);
      }
    }

    const dir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), optimized.buffer);
    const url = `/uploads/${folder}/${name}`;
    return apiSuccess({
      url,
      publicId: name,
      via: "local",
      kind: optimized.kind,
      bytes: optimized.bytes,
      width: optimized.width,
      height: optimized.height,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[upload]", message, e);
    return apiError(
      process.env.NODE_ENV === "development"
        ? `Upload failed: ${message}`
        : "Upload failed. Please try again.",
      500
    );
  }
}
