import { RoleName } from "@prisma/client";
import { isPlatformAdminRole } from "@/lib/auth/permissions";

/** Folders allowed without a session (store / rider signup documents). */
export const GUEST_UPLOAD_FOLDERS = new Set([
  "logos",
  "cnic",
  "shops",
  "proofs",
  "riders",
]);

/**
 * Who may upload into each folder.
 * Guests: only GUEST_UPLOAD_FOLDERS.
 * Authenticated: role must match folder purpose.
 */
export function canUploadToFolder(
  folder: string,
  role: RoleName | null | undefined
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  const f = folder.toLowerCase();

  if (GUEST_UPLOAD_FOLDERS.has(f)) {
    return { ok: true };
  }

  if (!role) {
    return {
      ok: false,
      status: 401,
      error: "Please sign in to upload images",
    };
  }

  if (isPlatformAdminRole(role)) {
    return { ok: true };
  }

  if (f === "products" || f === "stores") {
    if (role === "STORE_OWNER") return { ok: true };
    return {
      ok: false,
      status: 403,
      error: "Only store owners can upload product images",
    };
  }

  if (f === "carousel" || f === "categories") {
    return {
      ok: false,
      status: 403,
      error: "Only admins can upload these images",
    };
  }

  if (f === "payment-proofs") {
    if (role === "RIDER" || role === "CUSTOMER") return { ok: true };
    return {
      ok: false,
      status: 403,
      error: "Only customers or riders can upload payment proofs",
    };
  }

  if (f === "remittance-proofs") {
    if (role === "RIDER") return { ok: true };
    return {
      ok: false,
      status: 403,
      error: "Only riders can upload remittance proofs",
    };
  }

  // Unknown folder — any signed-in user
  return { ok: true };
}
