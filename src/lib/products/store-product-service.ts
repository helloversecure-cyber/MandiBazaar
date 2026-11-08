/**
 * Store portal product create / update (QA N3, N4, N9).
 * Called from src/app/api/store/route.ts (POST and PATCH UPDATE_PRODUCT).
 *
 * - Every rule from src/lib/validators/product-rules.ts is enforced here.
 * - Edits to an approved product follow the N9 contract: reviewed fields go to
 *   Product.pendingChanges (live product unchanged) and MandiBazaars are
 *   notified; small price changes, stock and flags apply immediately.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess, slugify, toNumber } from "@/lib/utils";
import { zCategoryName } from "@/lib/validators/pk";
import { notifySuperAdminsInApp } from "@/lib/notifications/service";
import {
  PRODUCT_LIMITS,
  REVIEWED_FIELD_LABELS,
  checkProduct,
  planProductEdit,
  readPendingChanges,
  stockBelowReservedError,
  storeProductCreateSchema,
  storeProductUpdateSchema,
  type LiveProduct,
  type ProductImageRef,
  type ReviewedFields,
} from "@/lib/validators/product-rules";

type SessionLike = { user: { id: string; role?: string | null } };

const FIELD_KEYS = [
  "name",
  "urduName",
  "description",
  "shortDescription",
  "price",
  "salePrice",
  "stockQuantity",
  "unit",
] as const;

function isAllowedImageUrl(u: string) {
  return u.startsWith("/uploads/") || u.startsWith("https://");
}

/** Parse body.imageUrls (or legacy body.imageUrl). undefined = not sent. */
function readImages(body: Record<string, unknown>): { urls?: string[]; error?: string } {
  let urls: string[] | undefined;
  if (Array.isArray(body.imageUrls)) {
    urls = (body.imageUrls as unknown[]).map((u) => String(u || "").trim()).filter(Boolean);
  } else if (body.imageUrl) {
    urls = [String(body.imageUrl).trim()];
  }
  if (urls === undefined) return {};
  if (urls.length === 0) return { urls, error: "Add at least one product photo" };
  if (urls.length > PRODUCT_LIMITS.maxImages) {
    return { urls, error: `Add at most ${PRODUCT_LIMITS.maxImages} photos` };
  }
  if (!urls.every(isAllowedImageUrl)) {
    return { urls, error: "Upload photos with the photo button (links from other sites are not allowed)" };
  }
  return { urls };
}

function pickFields(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

async function resolveCustomCategory(raw: unknown): Promise<{ id?: string; error?: string }> {
  const parsed = zCategoryName.safeParse(String(raw ?? ""));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Enter a valid category name" };
  }
  const { ensureCategoryIdFromName } = await import("@/lib/catalog/requested-categories");
  try {
    return { id: await ensureCategoryIdFromName(parsed.data) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid custom category" };
  }
}

export function serializeStoreProduct<T extends { price: unknown; salePrice: unknown }>(p: T) {
  return {
    ...p,
    price: toNumber(p.price),
    salePrice: p.salePrice != null ? toNumber(p.salePrice) : null,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createStoreProduct(
  session: SessionLike,
  body: Record<string, unknown>,
  storeIds: string[]
): Promise<Response> {
  const storeId = String(body.storeId || "");
  if (!storeId || !storeIds.includes(storeId)) {
    return apiError("Forbidden — you can only add products to your own store", 403);
  }

  const fields = pickFields(body);
  if (
    (fields.shortDescription === undefined || String(fields.shortDescription).trim() === "") &&
    typeof fields.description === "string"
  ) {
    fields.shortDescription = fields.description.trim().slice(0, PRODUCT_LIMITS.shortDescriptionMax);
  }

  const fieldErrors: Record<string, string> = {};
  const checked = checkProduct(storeProductCreateSchema, fields);
  if (!checked.ok) Object.assign(fieldErrors, checked.fieldErrors);

  const images = readImages(body);
  if (!images.urls) fieldErrors.images = "Add at least one product photo";
  else if (images.error) fieldErrors.images = images.error;

  const customCategoryName = String(body.customCategoryName || "").trim();
  let categoryId = String(body.categoryId || "").trim();
  if (!customCategoryName && !categoryId) {
    fieldErrors.categoryId = "Please select a category";
  }
  if (customCategoryName) {
    const parsed = zCategoryName.safeParse(customCategoryName);
    if (!parsed.success) {
      fieldErrors.customCategoryName = parsed.error.issues[0]?.message || "Enter a valid category name";
    }
  } else if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, isActive: true } });
    if (!category) {
      fieldErrors.categoryId = "Selected category is not available. Choose another or use Others.";
    }
  }

  if (Object.keys(fieldErrors).length || !checked.ok) {
    return apiFieldErrors(fieldErrors);
  }
  const data = checked.data;

  if (customCategoryName) {
    const resolved = await resolveCustomCategory(customCategoryName);
    if (!resolved.id) return apiFieldErrors({ customCategoryName: resolved.error || "Invalid category" });
    categoryId = resolved.id;
    // Remember the custom request on the store for future product forms
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { requestedCategories: true },
    });
    if (store) {
      const { normalizeRequestedCategories } = await import("@/lib/catalog/requested-categories");
      await prisma.store.update({
        where: { id: storeId },
        data: {
          requestedCategories: normalizeRequestedCategories([
            ...store.requestedCategories,
            customCategoryName,
          ]),
        },
      });
    }
  }

  const sku =
    (typeof body.sku === "string" && body.sku.trim().slice(0, 50)) ||
    `S${storeId.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  let slug = slugify(data.name) || `product-${Date.now().toString(36)}`;
  const base = slug;
  let n = 1;
  while (await prisma.product.findFirst({ where: { storeId, slug } })) {
    slug = `${base}-${n++}`;
  }

  const isOrganic = body.isOrganic !== undefined ? Boolean(body.isOrganic) : true;
  const product = await prisma.product.create({
    data: {
      storeId,
      name: data.name,
      urduName: data.urduName ? data.urduName : null,
      slug,
      sku,
      categoryId,
      description: data.description,
      shortDescription: data.shortDescription || null,
      price: data.price,
      salePrice: data.salePrice ?? null,
      // Baseline for the ±20% price-review threshold starts at the first price;
      // it only moves when an admin approves a reviewed price change.
      reviewBasePrice: data.price,
      unit: data.unit,
      stockQuantity: data.stockQuantity,
      // Store-created listings always need MandiBazaar approval first
      status: "DRAFT",
      isOrganic,
      isFarmProduct: body.isFarmProduct !== undefined ? Boolean(body.isFarmProduct) : isOrganic,
      freeDelivery: Boolean(body.freeDelivery),
      tags: [],
      images: {
        create: (images.urls || []).map((url, i) => ({
          url,
          isPrimary: i === 0,
          sortOrder: i,
          alt: data.name,
        })),
      },
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "STORE_PRODUCT_CREATED_PENDING_REVIEW",
    entity: "Product",
    entityId: product.id,
    newValue: { categoryId, customCategoryName: customCategoryName || null },
  });

  return apiSuccess(
    {
      ...serializeStoreProduct(product),
      message:
        "Product submitted for MandiBazaar approval. It will appear in the shop after approval.",
    },
    201
  );
}

// ---------------------------------------------------------------------------
// Update (N9)
// ---------------------------------------------------------------------------

export async function updateStoreProduct(
  session: SessionLike,
  body: Record<string, unknown>,
  storeIds: string[]
): Promise<Response> {
  const productId = String(body.productId || "");
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) return apiError("Product not found", 404);
  if (session.user.role !== "SUPER_ADMIN" && !storeIds.includes(product.storeId)) {
    return apiError("Forbidden", 403);
  }
  if (product.status === "ARCHIVED") {
    return apiError("This product was removed and cannot be edited", 400);
  }

  const fields = pickFields(body);
  // Short description follows the description unless the store typed its own.
  if (
    typeof fields.description === "string" &&
    (fields.shortDescription === undefined || String(fields.shortDescription).trim() === "")
  ) {
    fields.shortDescription = fields.description.trim().slice(0, PRODUCT_LIMITS.shortDescriptionMax);
  }

  const fieldErrors: Record<string, string> = {};
  const checked = checkProduct(storeProductUpdateSchema, fields);
  if (!checked.ok) Object.assign(fieldErrors, checked.fieldErrors);
  const input = checked.ok ? checked.data : {};

  if (input.stockQuantity !== undefined) {
    const err = stockBelowReservedError(input.stockQuantity, product.reservedStock);
    if (err) fieldErrors.stockQuantity = err;
  }

  // Status (store can pause / resume an approved product; never self-publish)
  let nextStatus: "ACTIVE" | "INACTIVE" | "DRAFT" | undefined;
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!["ACTIVE", "INACTIVE", "DRAFT"].includes(s)) {
      return apiError("Invalid product status", 400);
    }
    if (s === "ACTIVE" && product.status === "DRAFT") {
      return apiError(
        "This product is waiting for MandiBazaar approval before it can go live",
        400
      );
    }
    if (s === "DRAFT" && product.status !== "DRAFT") {
      return apiError("Invalid product status", 400);
    }
    nextStatus = s as typeof nextStatus;
  }

  // Category (N4: an unchanged category never blocks the save)
  let nextCategoryId: string | undefined;
  const customCategoryName = String(body.customCategoryName || "").trim();
  if (customCategoryName) {
    const resolved = await resolveCustomCategory(customCategoryName);
    if (!resolved.id) fieldErrors.customCategoryName = resolved.error || "Invalid category";
    else nextCategoryId = resolved.id;
  } else if (body.categoryId !== undefined && body.categoryId !== null) {
    const categoryId = String(body.categoryId || "").trim();
    if (!categoryId || categoryId === product.categoryId) {
      // empty / unchanged → keep current category
    } else {
      const category = await prisma.category.findFirst({ where: { id: categoryId, isActive: true } });
      if (!category) fieldErrors.categoryId = "Selected category is not available";
      else nextCategoryId = categoryId;
    }
  }

  const images = readImages(body);
  if (images.error) fieldErrors.images = images.error;

  if (Object.keys(fieldErrors).length) return apiFieldErrors(fieldErrors);

  const liveImages: ProductImageRef[] = product.images.map((img, i) => ({
    url: img.url,
    sortOrder: img.sortOrder ?? i,
  }));
  const live: LiveProduct = {
    status: product.status,
    name: product.name,
    categoryId: product.categoryId,
    unit: product.unit,
    description: product.description,
    shortDescription: product.shortDescription,
    price: toNumber(product.price),
    salePrice: product.salePrice != null ? toNumber(product.salePrice) : null,
    reviewBasePrice: product.reviewBasePrice != null ? toNumber(product.reviewBasePrice) : null,
    images: liveImages,
  };

  const changes: ReviewedFields = {};
  if (input.name !== undefined) changes.name = input.name;
  if (nextCategoryId !== undefined) changes.categoryId = nextCategoryId;
  if (input.unit !== undefined) changes.unit = input.unit;
  if (input.description !== undefined) changes.description = input.description;
  if (input.shortDescription !== undefined) changes.shortDescription = input.shortDescription;
  if (input.price !== undefined) changes.price = input.price;
  if (input.salePrice !== undefined) changes.salePrice = input.salePrice;
  if (images.urls) changes.images = images.urls.map((url, i) => ({ url, sortOrder: i }));

  const existingPending = readPendingChanges(product.pendingChanges);
  const plan = planProductEdit(live, changes, existingPending);
  if (plan.errors) return apiFieldErrors(plan.errors);

  // Non-reviewed fields: always immediate
  const direct: Record<string, unknown> = {};
  if (input.stockQuantity !== undefined && input.stockQuantity !== product.stockQuantity) {
    direct.stockQuantity = input.stockQuantity;
  }
  if (input.urduName !== undefined && (input.urduName || null) !== (product.urduName || null)) {
    direct.urduName = input.urduName || null;
  }
  if (nextStatus !== undefined && nextStatus !== product.status) direct.status = nextStatus;
  if (body.isOrganic !== undefined && Boolean(body.isOrganic) !== product.isOrganic) {
    direct.isOrganic = Boolean(body.isOrganic);
    direct.isFarmProduct = Boolean(body.isOrganic);
  }
  if (body.freeDelivery !== undefined && Boolean(body.freeDelivery) !== product.freeDelivery) {
    direct.freeDelivery = Boolean(body.freeDelivery);
  }

  const { images: immediateImages, ...immediateFields } = plan.immediate;
  const updateData: Prisma.ProductUpdateInput = { ...direct, ...immediateFields } as Prisma.ProductUpdateInput;
  if (immediateFields.categoryId !== undefined) {
    delete (updateData as Record<string, unknown>).categoryId;
    updateData.category = { connect: { id: immediateFields.categoryId } };
  }

  const pendingChanged =
    JSON.stringify(plan.pending || null) !==
    JSON.stringify(
      existingPending
        ? Object.fromEntries(
            Object.entries(existingPending).filter(([k]) => k !== "submittedById" && k !== "submittedAt")
          )
        : null
    );
  if (pendingChanged) {
    if (plan.pending) {
      updateData.pendingChanges = {
        ...plan.pending,
        submittedById: session.user.id,
        submittedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue;
      updateData.pendingChangesAt = new Date();
      if (plan.newlyPending.length) updateData.moderationNote = null;
    } else {
      updateData.pendingChanges = Prisma.DbNull;
      updateData.pendingChangesAt = null;
    }
  }

  const nothing =
    Object.keys(updateData).length === 0 && immediateImages === undefined;
  if (nothing) {
    if (Object.keys(fields).length === 0 && !images.urls && body.status === undefined &&
        body.isOrganic === undefined && body.freeDelivery === undefined && !nextCategoryId) {
      return apiError("No changes to save", 400);
    }
    return apiSuccess({
      ...serializeStoreProduct(product),
      pendingReview: Boolean(plan.pending),
      pendingFields: plan.pending ? Object.keys(plan.pending) : [],
      message: plan.pending
        ? "No new changes. Your earlier changes are still waiting for MandiBazaar review."
        : "No changes to save",
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.product.update({ where: { id: productId }, data: updateData });
    if (immediateImages) {
      await tx.productImage.deleteMany({ where: { productId } });
      await tx.productImage.createMany({
        data: immediateImages.map((img, i) => ({
          productId,
          url: img.url,
          isPrimary: i === 0,
          sortOrder: i,
          alt: u.name,
        })),
      });
    }
    return u;
  });

  // Audit: what went live now (old → new)
  const liveChangedKeys = [
    ...Object.keys(direct),
    ...Object.keys(immediateFields),
    ...(immediateImages ? ["images"] : []),
  ];
  if (liveChangedKeys.length) {
    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const productRecord = product as unknown as Record<string, unknown>;
    for (const k of liveChangedKeys) {
      if (k === "images") {
        prev.images = liveImages;
        next.images = immediateImages;
        continue;
      }
      const old = productRecord[k];
      prev[k] = k === "price" || k === "salePrice" ? (old != null ? toNumber(old) : null) : old;
      next[k] = (updateData as Record<string, unknown>)[k] ?? (k === "categoryId" ? immediateFields.categoryId : null);
    }
    await writeAuditLog({
      userId: session.user.id,
      action: "STORE_PRODUCT_UPDATED",
      entity: "Product",
      entityId: productId,
      previousValue: prev,
      newValue: next,
    });
  }

  if (plan.newlyPending.length && plan.pending) {
    const prev: Record<string, unknown> = {};
    for (const k of plan.newlyPending) {
      prev[k] = k === "images" ? liveImages : (live as unknown as Record<string, unknown>)[k];
    }
    await writeAuditLog({
      userId: session.user.id,
      action: "STORE_PRODUCT_CHANGE_PENDING_REVIEW",
      entity: "Product",
      entityId: productId,
      previousValue: prev,
      newValue: plan.pending,
    });
    const labels = plan.newlyPending.map((k) => REVIEWED_FIELD_LABELS[k]).join(", ");
    await notifySuperAdminsInApp({
      type: "PRODUCT_CHANGE_REVIEW",
      title: "Product change waiting for review",
      body: `${product.name}: the store changed ${labels}. Review it in Products → Pending review.`,
      metadata: { productId, storeId: product.storeId, fields: plan.newlyPending },
    });
  }

  const pendingFields = plan.pending ? Object.keys(plan.pending) : [];
  const pendingLabels = pendingFields
    .map((k) => REVIEWED_FIELD_LABELS[k as keyof typeof REVIEWED_FIELD_LABELS])
    .join(", ");
  return apiSuccess({
    ...serializeStoreProduct(updated),
    pendingReview: pendingFields.length > 0,
    pendingFields,
    message: pendingFields.length
      ? liveChangedKeys.length
        ? `Saved. Changes to ${pendingLabels} were sent to MandiBazaar for review — customers see the approved version until then.`
        : `Changes to ${pendingLabels} were sent to MandiBazaar for review — customers see the approved version until then.`
      : "Product updated",
  });
}
