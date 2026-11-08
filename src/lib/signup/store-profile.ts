/**
 * PATCH /api/store { action: "UPDATE_PROFILE" } — store profile (QA S10, N7, STO-06).
 * Same rules as store signup; at least one valid payout method and a store
 * location (lat/lng, or a Google Maps link we can read) are required to save.
 * Name / address changes after approval are allowed, but audited (old → new)
 * and MandiBazaars get an in-app notification.
 */
import type { Session } from "next-auth";
import { NotificationChannel, type Store } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess } from "@/lib/utils";
import { sendNotification } from "@/lib/notifications/service";
import { validateStoreProfile, zUploadUrl } from "@/lib/validators/signup-forms";
import { MAPS_LINK_UNREADABLE_MSG, withCoordsFromMapsLink } from "@/lib/signup/store-application";

const PROFILE_KEYS = [
  "name",
  "description",
  "phone",
  "email",
  "addressLine",
  "area",
  "city",
  "province",
  "postalCode",
  "googleMapsUrl",
  "latitude",
  "longitude",
  "bankAccountTitle",
  "bankName",
  "bankAccountNumber",
  "bankIban",
  "jazzCashNumber",
  "jazzCashAccountTitle",
] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

/** Changes to these after approval are reported to MandiBazaar (no re-approval). */
const IDENTITY_KEYS = ["name", "addressLine", "area", "city", "province", "postalCode"] as const;

export async function updateStoreProfile(
  session: Session,
  body: Record<string, unknown>,
  storeIds: string[]
): Promise<Response> {
  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  if (!storeId) return apiError("Store is required", 400);
  const isSuper = session.user.role === "SUPER_ADMIN";
  if (!isSuper && !storeIds.includes(storeId)) return apiError("Forbidden", 403);

  const existing = await prisma.store.findUnique({ where: { id: storeId } });
  if (!existing) return apiError("Store not found", 404);
  if (existing.status !== "APPROVED" && !isSuper) {
    return apiError("Only approved stores can update profile", 400);
  }

  // Merge: fields not sent keep their saved value; the merged result must be valid.
  const merged: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    merged[k] = body[k] !== undefined ? body[k] : existing[k];
  }

  const errors: Record<string, string> = {};

  // Images: only checked when changed (older rows may hold seed URLs)
  const images: Partial<Record<"logoUrl" | "coverUrl", string | null>> = {};
  for (const k of ["logoUrl", "coverUrl"] as const) {
    if (body[k] === undefined) continue;
    const next = body[k] ? String(body[k]).trim() : null;
    if (next === existing[k]) continue;
    if (next) {
      const r = zUploadUrl(k === "logoUrl" ? "logo" : "cover image").safeParse(next);
      if (!r.success) {
        errors[k] = r.error.issues[0]?.message || "Upload the image again";
        continue;
      }
    }
    images[k] = next;
  }

  const loc = await withCoordsFromMapsLink(merged);
  const v = validateStoreProfile(loc.values, { server: true });
  if (!v.success) {
    Object.assign(errors, v.errors);
    if (errors.latitude && loc.triedLink && !loc.fromLink && !errors.googleMapsUrl) {
      errors.googleMapsUrl = MAPS_LINK_UNREADABLE_MSG;
      errors.latitude = MAPS_LINK_UNREADABLE_MSG;
    }
  }
  if (Object.keys(errors).length || !v.success) return apiFieldErrors(errors);

  const d = v.data;
  const next: Record<ProfileKey, string | number | null> = {
    name: d.name,
    description: d.description || null,
    phone: d.phone || null,
    email: d.email || null,
    addressLine: d.addressLine,
    area: d.area || null,
    city: d.city,
    province: d.province,
    postalCode: d.postalCode || null,
    googleMapsUrl: d.googleMapsUrl || null,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    bankAccountTitle: d.bankAccountTitle || null,
    bankName: d.bankName || null,
    bankAccountNumber: d.bankAccountNumber || null,
    bankIban: d.bankIban || null,
    jazzCashNumber: d.jazzCashNumber || null,
    jazzCashAccountTitle: d.jazzCashAccountTitle || null,
  };

  const previousValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    const before = (existing as Store)[k] ?? null;
    if (before !== next[k]) {
      previousValue[k] = before;
      newValue[k] = next[k];
      data[k] = next[k];
    }
  }
  for (const [k, val] of Object.entries(images)) {
    previousValue[k] = existing[k as "logoUrl" | "coverUrl"];
    newValue[k] = val;
    data[k] = val;
  }

  if (Object.keys(data).length === 0) {
    return apiSuccess(existing);
  }

  const store = await prisma.store.update({ where: { id: storeId }, data });

  await writeAuditLog({
    userId: session.user.id,
    action: "STORE_PROFILE_UPDATED",
    entity: "Store",
    entityId: storeId,
    previousValue,
    newValue: { ...newValue, ...(loc.fromLink ? { locationFromMapsLink: true } : {}) },
  });

  const identityChanged = IDENTITY_KEYS.filter((k) => k in data);
  if (existing.status === "APPROVED" && identityChanged.length) {
    const oldNew: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of identityChanged) oldNew[k] = { from: previousValue[k], to: newValue[k] };
    await writeAuditLog({
      userId: session.user.id,
      action: "STORE_NAME_ADDRESS_CHANGED",
      entity: "Store",
      entityId: storeId,
      previousValue: Object.fromEntries(identityChanged.map((k) => [k, previousValue[k]])),
      newValue: Object.fromEntries(identityChanged.map((k) => [k, newValue[k]])),
    });

    try {
      const admins = await prisma.user.findMany({
        where: { isActive: true, role: { name: "SUPER_ADMIN" }, id: { not: session.user.id } },
        select: { id: true },
      });
      const summary = identityChanged
        .map((k) => `${k}: “${oldNew[k].from ?? "—"}” → “${oldNew[k].to ?? "—"}”`)
        .join("; ");
      await Promise.all(
        admins.map((a) =>
          sendNotification({
            userId: a.id,
            channel: NotificationChannel.IN_APP,
            type: "STORE_PROFILE_CHANGED",
            title: `Store details changed: ${store.name}`,
            body: `An approved store changed its ${identityChanged.join(", ")}. ${summary}`.slice(0, 1000),
            metadata: { storeId, changes: oldNew },
          })
        )
      );
    } catch (e) {
      console.error("[store profile] admin notification failed", e);
    }
  }

  return apiSuccess(store);
}
