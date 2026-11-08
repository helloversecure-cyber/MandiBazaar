/**
 * POST /api/stores — store application (QA L3, L4, S2, N7).
 * Every field is validated (S0 rules) BEFORE any row is created, and the owner
 * account + store are created in one transaction (no orphan users on errors).
 */
import { StoreDocType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/auth";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess, slugify } from "@/lib/utils";
import { slugifyStoreName } from "@/lib/stores/access";
import { normalizeRequestedCategories } from "@/lib/catalog/requested-categories";
import { isSafeMapsUrl, zCategoryName, zodFieldErrors, type FieldErrors } from "@/lib/validators/pk";
import {
  isUploadUrl,
  missingStoreDocErrors,
  storeOwnerSchema,
  validateStoreSignup,
  type StoreDocField,
} from "@/lib/validators/signup-forms";
import { duplicateAccountErrors } from "@/lib/auth/user-lookup";
import { resolveMapsUrlCoords } from "@/lib/geo/maps-url";
import {
  SignupAccountError,
  createSignupFirebaseUser,
  sendSignupVerificationEmail,
} from "@/lib/auth/firebase-signup";
import { deleteFirebaseUser } from "@/lib/firebase/admin";

export const MAPS_LINK_UNREADABLE_MSG =
  "We couldn't read your shop's location from this link. Tap “Use my current location”, or in Google Maps drop a pin on your shop, tap Share and paste that link.";

type DocIn = { type?: unknown; url?: unknown; label?: unknown };

function blank(v: unknown) {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/**
 * Fill latitude/longitude from a Google Maps link when the owner didn't share a
 * pin (parses @lat,lng / !3d!4d / q= / ll=, follows maps.app.goo.gl short links).
 */
export async function withCoordsFromMapsLink<T extends Record<string, unknown>>(
  values: T
): Promise<{ values: T; fromLink: boolean; triedLink: boolean }> {
  if (!blank(values.latitude) || !blank(values.longitude)) {
    return { values, fromLink: false, triedLink: false };
  }
  const link = typeof values.googleMapsUrl === "string" ? values.googleMapsUrl.trim() : "";
  if (!link || !isSafeMapsUrl(link)) return { values, fromLink: false, triedLink: false };
  const coords = await resolveMapsUrlCoords(link);
  if (!coords) return { values, fromLink: false, triedLink: true };
  return {
    values: { ...values, latitude: coords.lat, longitude: coords.lng },
    fromLink: true,
    triedLink: true,
  };
}

export async function submitStoreApplication(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid request", 400);
  }
  if (!body || typeof body !== "object") return apiError("Invalid request", 400);

  const session = await getSession();
  const signedInId = session?.user?.id;
  const errors: FieldErrors = {};

  // 1) Owner account (only when applying signed out)
  let owner: { fullName: string; phone: string; email?: string; password: string } | null = null;
  if (!signedInId) {
    const o = storeOwnerSchema.safeParse(body.owner || {});
    if (!o.success) {
      for (const [k, msg] of Object.entries(zodFieldErrors(o.error))) errors[`owner.${k}`] = msg;
    } else {
      owner = o.data;
    }
  }

  // 2) Documents (QA L4)
  const isVirtual = Boolean(body.isVirtual);
  const docsIn: DocIn[] = Array.isArray(body.documents) ? (body.documents as DocIn[]) : [];
  const docs = docsIn.filter(
    (d): d is { type: StoreDocType; url: string; label?: unknown } =>
      !!d &&
      typeof d.type === "string" &&
      (Object.values(StoreDocType) as string[]).includes(d.type) &&
      isUploadUrl(d.url)
  );
  const urlOf = (...types: string[]) => docs.find((d) => types.includes(d.type))?.url;
  const docFields: Record<StoreDocField, string | undefined> = {
    cnicFront: urlOf("CNIC_FRONT"),
    cnicBack: urlOf("CNIC_BACK"),
    shopImage: urlOf("SHOP_IMAGE", "WAREHOUSE_IMAGE"),
    addressProof: urlOf("ADDRESS_PROOF"),
  };
  Object.assign(errors, missingStoreDocErrors(docFields, isVirtual));

  // 3) Categories: at least one; custom names follow the category-name rule
  const requestedCategories = normalizeRequestedCategories(body.requestedCategories);
  const badCategory = requestedCategories.find((n) => !zCategoryName.safeParse(n).success);
  if (badCategory) {
    errors.requestedCategories = `“${badCategory.slice(0, 40)}”: category names must be 2–40 characters with letters (no < or >)`;
  }

  // 4) Store fields + location (extract coordinates from the Maps link if needed)
  const loc = await withCoordsFromMapsLink({
    ...body,
    isVirtual,
    requestedCategories,
  } as Record<string, unknown>);
  const v = validateStoreSignup(loc.values, { server: true });
  if (!v.success) {
    for (const [k, msg] of Object.entries(v.errors)) {
      if (!errors[k]) errors[k] = msg;
    }
    if (errors.latitude && loc.triedLink && !loc.fromLink && !errors.googleMapsUrl) {
      errors.googleMapsUrl = MAPS_LINK_UNREADABLE_MSG;
      errors.latitude = MAPS_LINK_UNREADABLE_MSG;
    }
  }

  if (Object.keys(errors).length || !v.success) {
    return apiFieldErrors(errors);
  }
  const data = v.data;

  // 5) Duplicate owner phone / email (any stored format)
  if (owner) {
    const dup = await duplicateAccountErrors({ phone: owner.phone, email: owner.email });
    if (Object.keys(dup).length) {
      const prefixed: FieldErrors = {};
      for (const [k, msg] of Object.entries(dup)) prefixed[`owner.${k}`] = msg;
      return apiFieldErrors(prefixed, 409);
    }
  }

  // 6) New owner account via Firebase (signed-in users already have an account)
  let ownerUid: string | null = null;
  if (owner) {
    if (!owner.email) return apiFieldErrors({ "owner.email": "Email is required" });
    try {
      ownerUid = await createSignupFirebaseUser(owner.email, owner.password, owner.fullName);
    } catch (e) {
      if (e instanceof SignupAccountError) {
        return apiFieldErrors({ [`owner.${e.field}`]: e.message }, 409);
      }
      throw e;
    }
  }

  const baseSlug = slugifyStoreName(data.name) || slugify(data.name) || "store";
  let slug = baseSlug;
  let n = 1;
  while (await prisma.store.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const storeOwnerRole = await prisma.role.findUniqueOrThrow({ where: { name: "STORE_OWNER" } });
  const upgradeCustomer = Boolean(signedInId) && session?.user?.role === "CUSTOMER";

  const docRows = docs.map((d) => ({
    type: d.type,
    url: d.url,
    label: typeof d.label === "string" && d.label.trim() ? d.label.trim().slice(0, 100) : null,
  }));

  let created: Awaited<ReturnType<typeof createStoreApplication>>;
  try {
    created = await createStoreApplication();
  } catch (e) {
    if (ownerUid) await deleteFirebaseUser(ownerUid).catch(() => {});
    throw e;
  }
  const { store, ownerId } = created;

  async function createStoreApplication() {
  return prisma.$transaction(async (tx) => {
    let ownerId = signedInId;
    if (owner) {
      const user = await tx.user.create({
        data: {
          fullName: owner.fullName,
          phone: owner.phone,
          email: owner.email,
          firebaseUid: ownerUid!,
          roleId: storeOwnerRole.id,
          emailVerified: null,
        },
      });
      ownerId = user.id;
    } else if (upgradeCustomer && ownerId) {
      await tx.user.update({ where: { id: ownerId }, data: { roleId: storeOwnerRole.id } });
    }

    const store = await tx.store.create({
      data: {
        name: data.name,
        slug,
        description: data.description || null,
        logoUrl: data.logoUrl || null,
        isVirtual,
        phone: data.phone || null,
        email: data.email || null,
        addressLine: data.addressLine,
        area: data.area || null,
        city: data.city,
        province: data.province,
        postalCode: data.postalCode || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        googleMapsUrl: data.googleMapsUrl || null,
        cnicNumber: data.cnicNumber,
        bankAccountTitle: data.bankAccountTitle || null,
        bankName: data.bankName || null,
        bankAccountNumber: data.bankAccountNumber || null,
        bankIban: data.bankIban || null,
        jazzCashNumber: data.jazzCashNumber || null,
        jazzCashAccountTitle: data.jazzCashAccountTitle || null,
        requestedCategories,
        status: "PENDING",
        ownerId: ownerId!,
        members: { create: { userId: ownerId!, role: "OWNER" } },
        documents: { create: docRows },
      },
      include: { documents: true },
    });
    return { store, ownerId: ownerId! };
  });
  }

  await writeAuditLog({
    userId: ownerId,
    action: "STORE_APPLICATION_SUBMITTED",
    entity: "Store",
    entityId: store.id,
    newValue: {
      name: store.name,
      status: store.status,
      requestedCategories,
      locationFromMapsLink: loc.fromLink,
    },
  });

  let devLink: string | undefined;
  if (owner && owner.email) {
    const mail = await sendSignupVerificationEmail(owner.email, owner.password);
    devLink = mail.devLink;
  }

  return apiSuccess(
    {
      store,
      roleUpgraded: upgradeCustomer,
      ...(owner ? { needsVerification: true, ownerEmail: owner.email } : {}),
      ...(devLink ? { devLink } : {}),
      message: "Application submitted. MandiBazaar will review your store and requested categories.",
    },
    201
  );
}
