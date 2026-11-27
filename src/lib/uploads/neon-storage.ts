import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Neon Object Storage (built into Neon — no Amazon AWS account).
 *
 * Neon exposes an S3-compatible API, so we use the standard S3 client pointed
 * at your Neon branch endpoint with credentials minted in the Neon Console.
 * Env names are NEON_* on purpose (not AWS account keys).
 *
 * Docs: https://neon.com/docs/storage/get-started
 */

function env(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function getAccessKey() {
  // Neon Console → Storage credential → token_id
  return env("NEON_STORAGE_ACCESS_KEY", "AWS_ACCESS_KEY_ID");
}

function getSecretKey() {
  // Neon Console → Storage credential → s3_secret_access_key
  return env("NEON_STORAGE_SECRET_KEY", "AWS_SECRET_ACCESS_KEY");
}

function getEndpoint() {
  return env("NEON_STORAGE_ENDPOINT", "AWS_ENDPOINT_URL_S3").replace(/\/$/, "");
}

function getRegion() {
  return env("NEON_STORAGE_REGION", "AWS_REGION") || "us-east-2";
}

function getBucket() {
  return env("NEON_STORAGE_BUCKET");
}

export function neonStorageConfigured() {
  return Boolean(
    getAccessKey() && getSecretKey() && getEndpoint() && getBucket()
  );
}

let client: S3Client | null = null;

function getNeonClient() {
  if (client) return client;
  client = new S3Client({
    region: getRegion(),
    endpoint: getEndpoint(),
    credentials: {
      accessKeyId: getAccessKey(),
      secretAccessKey: getSecretKey(),
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return client;
}

/** Public URL for objects in a Neon `public_read` bucket. */
export function neonPublicUrl(key: string) {
  return `${getEndpoint()}/${getBucket()}/${key.replace(/^\//, "")}`;
}

/** Where /api/upload puts files: `mandibazaar/<folder>/<file>` (see the upload route). */
const UPLOAD_PREFIX = "mandibazaar/";
const UPLOAD_TAIL = /^[a-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/i;
const LOCAL_UPLOAD = /^\/uploads\/[a-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/i;

/**
 * True only for a URL our own /api/upload could have returned: the public URL of
 * an object in our Neon bucket under `mandibazaar/`, or (local dev) a
 * `/uploads/<folder>/<file>` path. Anything else — other hosts, other buckets,
 * query strings, `..` — is refused, so a receipt can't point at an arbitrary site.
 */
export function isOwnUploadUrl(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u || u.length > 1000) return false;
  if (LOCAL_UPLOAD.test(u)) return true;
  if (!neonStorageConfigured()) return false;
  const base = neonPublicUrl(UPLOAD_PREFIX);
  if (!u.startsWith(base)) return false;
  return UPLOAD_TAIL.test(u.slice(base.length));
}

export async function uploadToNeonStorage(params: {
  bytes: Buffer;
  key: string;
  mime: string;
}): Promise<{ url: string; key: string }> {
  if (!neonStorageConfigured()) {
    throw new Error(
      "Neon Object Storage is not configured. Set NEON_STORAGE_ACCESS_KEY, NEON_STORAGE_SECRET_KEY, NEON_STORAGE_ENDPOINT, NEON_STORAGE_REGION, and NEON_STORAGE_BUCKET (public_read) from the Neon Console."
    );
  }

  const bucket = getBucket();
  const key = params.key.replace(/^\//, "");

  await getNeonClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: params.bytes,
      ContentType: params.mime,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return { url: neonPublicUrl(key), key };
}
