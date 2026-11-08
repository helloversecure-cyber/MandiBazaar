import sharp from "sharp";

export type ImageKind = "profile" | "business";

const PROFILE_MAX_BYTES = 1024 * 1024; // 1 MB
const BUSINESS_MAX_BYTES = 1800 * 1024; // ~1.8 MB (under 2 MB)
const PROFILE_MAX_WIDTH = 800;
const BUSINESS_MAX_WIDTH = 1920;

/** Map upload folder → default compression target */
export function imageKindFromFolder(folder: string): ImageKind {
  const f = folder.toLowerCase();
  if (
    f === "logos" ||
    f === "avatars" ||
    f === "profiles" ||
    f === "profile"
  ) {
    return "profile";
  }
  return "business";
}

export function parseImageKind(
  raw: string | null | undefined,
  folder: string
): ImageKind {
  if (raw === "profile" || raw === "business") return raw;
  return imageKindFromFolder(folder);
}

export type OptimizedImage = {
  buffer: Buffer;
  mime: string;
  ext: "webp" | "jpg";
  width: number;
  height: number;
  bytes: number;
  kind: ImageKind;
};

/**
 * Runtime image optimization. User may upload any size; we resize + compress
 * until the result fits the kind budget (profile ≤1MB, business ≤~1.8MB).
 */
export async function optimizeImageBuffer(
  input: Buffer,
  kind: ImageKind
): Promise<OptimizedImage> {
  const maxBytes = kind === "profile" ? PROFILE_MAX_BYTES : BUSINESS_MAX_BYTES;
  const maxWidth = kind === "profile" ? PROFILE_MAX_WIDTH : BUSINESS_MAX_WIDTH;

  const meta = await sharp(input, { failOn: "none", animated: false })
    .rotate()
    .metadata();

  let width = Math.min(meta.width || maxWidth, maxWidth);
  let quality = kind === "profile" ? 80 : 82;

  for (let attempt = 0; attempt < 12; attempt++) {
    const out = await sharp(input, { failOn: "none", animated: false })
      .rotate()
      .resize({
        width,
        height: width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (out.data.length <= maxBytes) {
      return {
        buffer: out.data,
        mime: "image/webp",
        ext: "webp",
        width: out.info.width,
        height: out.info.height,
        bytes: out.data.length,
        kind,
      };
    }

    if (quality > 45) {
      quality -= 8;
      continue;
    }

    // Quality floor hit — shrink dimensions
    width = Math.max(320, Math.floor(width * 0.82));
    quality = kind === "profile" ? 72 : 75;
  }

  // Last resort: aggressive jpeg
  const fallback = await sharp(input, { failOn: "none", animated: false })
    .rotate()
    .resize({
      width: Math.max(280, Math.floor(maxWidth * 0.45)),
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 55, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  if (fallback.data.length > maxBytes) {
    throw new Error(
      kind === "profile"
        ? "Could not compress profile image under 1MB. Try a simpler photo."
        : "Could not compress image under 2MB. Try a simpler photo."
    );
  }

  return {
    buffer: fallback.data,
    mime: "image/jpeg",
    ext: "jpg",
    width: fallback.info.width,
    height: fallback.info.height,
    bytes: fallback.data.length,
    kind,
  };
}
