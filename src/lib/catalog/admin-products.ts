/**
 * Admin → Products server logic (QA P14, N9 admin side, R5, Q6). Called from
 * `src/app/api/admin/route.ts`.
 */
import { Prisma, ProductStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiSuccess, paginationMeta, parsePagination, toNumber } from "@/lib/utils";
import {
  asPendingChanges,
  buildApprovedChangesUpdate,
  describePendingChanges,
} from "@/lib/catalog/product-changes";
import { notifyStoreOwner } from "@/lib/catalog/notify-owner";

const STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];

/** Products with store edits waiting for review. */
export const HAS_PENDING_CHANGES: Prisma.ProductWhereInput = {
  OR: [{ pendingChangesAt: { not: null } }, { NOT: { pendingChanges: { equals: Prisma.AnyNull } } }],
};

/** "Pending review" tab = new products (DRAFT) + approved products with pending edits. */
export const PENDING_REVIEW_WHERE: Prisma.ProductWhereInput = {
  OR: [{ status: "DRAFT" }, HAS_PENDING_CHANGES],
};

function statusWhere(status: string | null): Prisma.ProductWhereInput {
  if (!status) return {};
  if (status === "DRAFT" || status === "PENDING") return PENDING_REVIEW_WHERE;
  if ((STATUSES as string[]).includes(status)) return { status: status as ProductStatus };
  return {};
}

function searchWhere(q: string | undefined): Prisma.ProductWhereInput {
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { urduName: { contains: q, mode: "insensitive" } },
      { store: { name: { contains: q, mode: "insensitive" } } },
    ],
  };
}

export async function listAdminProducts(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const q = sp.get("q")?.trim() || undefined;
  const status = sp.get("status") || null;
  const storeId = sp.get("storeId") || null;
  const stock = sp.get("stock"); // "low" | "out" (inventory screen)

  const and: Prisma.ProductWhereInput[] = [statusWhere(status), searchWhere(q)];
  if (storeId) and.push({ storeId });
  if (stock === "out") and.push({ stockQuantity: { lte: 0 } });
  const where: Prisma.ProductWhereInput = { AND: and };

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: "asc" } },
        variants: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: status === "DRAFT" ? [{ pendingChangesAt: "asc" }, { createdAt: "asc" }] : { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);

  // Names for categories referenced by pending edits
  const pendingCatIds = new Set<string>();
  for (const p of items) {
    const pc = asPendingChanges(p.pendingChanges);
    if (pc?.categoryId) pendingCatIds.add(String(pc.categoryId));
  }
  const cats = pendingCatIds.size
    ? await prisma.category.findMany({
        where: { id: { in: Array.from(pendingCatIds) } },
        select: { id: true, name: true },
      })
    : [];
  const catName = new Map<string, string>(cats.map((c) => [c.id, c.name]));
  for (const p of items) catName.set(p.category.id, p.category.name);

  // R5: search found nothing in this tab → tell the admin how many are in "All"
  let matchesInAll: number | null = null;
  if (q && status && total === 0) {
    const extra: Prisma.ProductWhereInput[] = [searchWhere(q)];
    if (storeId) extra.push({ storeId });
    matchesInAll = await prisma.product.count({ where: { AND: extra } });
  }

  return apiSuccess({
    items: items.map((p) => {
      const pending = asPendingChanges(p.pendingChanges);
      const price = toNumber(p.price);
      const salePrice = p.salePrice != null ? toNumber(p.salePrice) : null;
      return {
        ...p,
        price,
        salePrice,
        costPrice: p.costPrice != null ? toNumber(p.costPrice) : null,
        weight: p.weight != null ? toNumber(p.weight) : null,
        availableStock: p.stockQuantity - p.reservedStock,
        hasPendingChanges: Boolean(pending),
        changeRows: pending
          ? describePendingChanges(
              {
                name: p.name,
                categoryId: p.categoryId,
                unit: p.unit,
                description: p.description,
                shortDescription: p.shortDescription,
                price,
                salePrice,
                images: p.images.map((i) => ({ url: i.url, sortOrder: i.sortOrder })),
              },
              pending,
              (id) => catName.get(id) || "Unknown category"
            )
          : [],
        variants: p.variants.map((v) => ({
          ...v,
          price: toNumber(v.price),
          salePrice: v.salePrice != null ? toNumber(v.salePrice) : null,
        })),
      };
    }),
    pagination: paginationMeta(page, limit, total),
    matchesInAll,
  });
}

type Actor = { id: string };

function reasonOf(data: Record<string, unknown> | undefined, min = 5): string | null {
  const r = typeof data?.reason === "string" ? data.reason.trim() : "";
  if (r.length < min || r.length > 500) return null;
  return r;
}

const REASON_MSG = "Give a reason of at least 5 characters (the store owner will see it)";

/** PATCH resource=product with data.action — returns a Response, or null if not handled. */
export async function handleProductAction(
  actor: Actor,
  id: string,
  data: Record<string, unknown> | undefined
): Promise<Response | null> {
  const action = String(data?.action || "");
  if (!["REVIEW", "APPROVE_CHANGES", "DECLINE_CHANGES", "RESTORE_STATUS"].includes(action)) return null;
  if (!id) return apiError("id required", 400);

  const previous = await prisma.product.findUnique({
    where: { id },
    include: { images: true, store: { select: { id: true, name: true } } },
  });
  if (!previous) return apiError("Product not found", 404);

  if (action === "REVIEW") {
    const decision = String(data?.decision || "").toUpperCase();
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      return apiError("decision must be APPROVED or REJECTED", 400);
    }
    if (previous.status !== "DRAFT") {
      return apiError("Only pending (DRAFT) products can be reviewed", 400);
    }
    const reason = decision === "REJECTED" ? reasonOf(data) : null;
    if (decision === "REJECTED" && !reason) {
      return Response.json(
        { success: false, error: REASON_MSG, code: "VALIDATION", fieldErrors: { reason: REASON_MSG } },
        { status: 400 }
      );
    }
    const nextStatus = decision === "APPROVED" ? "ACTIVE" : "INACTIVE";
    const product = await prisma.product.update({
      where: { id },
      data: { status: nextStatus, moderationNote: decision === "APPROVED" ? null : reason },
    });
    await writeAuditLog({
      userId: actor.id,
      action: `PRODUCT_${decision}`,
      entity: "Product",
      entityId: id,
      previousValue: { status: previous.status },
      newValue: { status: nextStatus, ...(reason ? { reason } : {}) },
    });
    await notifyStoreOwner({
      storeId: previous.storeId,
      type: decision === "APPROVED" ? "PRODUCT_APPROVED" : "PRODUCT_DECLINED",
      title: decision === "APPROVED" ? "Product approved" : "Product declined",
      body:
        decision === "APPROVED"
          ? `"${previous.name}" is approved and now live in the shop.`
          : `"${previous.name}" was declined. Reason: ${reason}`,
      metadata: { productId: id },
    });
    return apiSuccess({
      ...product,
      price: toNumber(product.price),
      salePrice: product.salePrice != null ? toNumber(product.salePrice) : null,
      message: decision === "APPROVED" ? "Product approved — now live in the shop" : "Product declined",
    });
  }

  if (action === "APPROVE_CHANGES") {
    const pending = asPendingChanges(previous.pendingChanges);
    if (!pending) return apiError("This product has no changes waiting for review", 400);
    const built = buildApprovedChangesUpdate(
      { price: toNumber(previous.price), salePrice: previous.salePrice != null ? toNumber(previous.salePrice) : null },
      pending
    );
    if ("error" in built) return apiError(built.error, 400);
    if (built.data.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: built.data.categoryId } });
      if (!cat) return apiError("The new category no longer exists — decline these changes instead", 400);
    }
    const before = {
      name: previous.name,
      categoryId: previous.categoryId,
      unit: previous.unit,
      description: previous.description,
      shortDescription: previous.shortDescription,
      price: toNumber(previous.price),
      salePrice: previous.salePrice != null ? toNumber(previous.salePrice) : null,
      images: previous.images.sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.url),
    };
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...built.data,
          pendingChanges: Prisma.DbNull,
          pendingChangesAt: null,
          moderationNote: null,
        },
      });
      if (built.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: built.images.map((img, i) => ({
            productId: id,
            url: img.url,
            sortOrder: i,
            isPrimary: i === 0,
            alt: built.data.name || previous.name,
          })),
        });
      }
    });
    await writeAuditLog({
      userId: actor.id,
      action: "PRODUCT_CHANGES_APPROVED",
      entity: "Product",
      entityId: id,
      previousValue: before,
      newValue: { ...built.data, ...(built.images ? { images: built.images.map((i) => i.url) } : {}) },
    });
    await notifyStoreOwner({
      storeId: previous.storeId,
      type: "PRODUCT_CHANGES_APPROVED",
      title: "Product changes approved",
      body: `Your changes to "${previous.name}" are approved and now live in the shop.`,
      metadata: { productId: id },
    });
    return apiSuccess({ id, message: "Changes approved — now live in the shop" });
  }

  if (action === "DECLINE_CHANGES") {
    const pending = asPendingChanges(previous.pendingChanges);
    if (!pending && !previous.pendingChangesAt) {
      return apiError("This product has no changes waiting for review", 400);
    }
    const reason = reasonOf(data);
    if (!reason) {
      return Response.json(
        { success: false, error: REASON_MSG, code: "VALIDATION", fieldErrors: { reason: REASON_MSG } },
        { status: 400 }
      );
    }
    await prisma.product.update({
      where: { id },
      data: { pendingChanges: Prisma.DbNull, pendingChangesAt: null, moderationNote: reason },
    });
    await writeAuditLog({
      userId: actor.id,
      action: "PRODUCT_CHANGES_DECLINED",
      entity: "Product",
      entityId: id,
      previousValue: { pendingChanges: previous.pendingChanges },
      newValue: { reason },
    });
    await notifyStoreOwner({
      storeId: previous.storeId,
      type: "PRODUCT_CHANGES_DECLINED",
      title: "Product changes declined",
      body: `Your changes to "${previous.name}" were declined. The approved version stays live. Reason: ${reason}`,
      metadata: { productId: id },
    });
    return apiSuccess({ id, message: "Changes declined — the approved version stays live" });
  }

  // RESTORE_STATUS — the "Undo" after archiving
  const target = String(data?.status || "").toUpperCase() as ProductStatus;
  if (!["DRAFT", "ACTIVE", "INACTIVE"].includes(target)) {
    return apiError("status must be DRAFT, ACTIVE or INACTIVE", 400);
  }
  if (previous.status !== "ARCHIVED") return apiError("Only archived products can be restored", 400);
  const restored = await prisma.product.update({
    where: { id },
    data: { status: target, moderationNote: null },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "PRODUCT_ARCHIVE_UNDONE",
    entity: "Product",
    entityId: id,
    previousValue: { status: previous.status, moderationNote: previous.moderationNote },
    newValue: { status: target },
  });
  return apiSuccess({ id: restored.id, status: restored.status, message: "Archive undone" });
}

/** DELETE resource=product soft=true — archive with a required reason. */
export async function archiveProduct(actor: Actor, id: string, reasonRaw: unknown) {
  if (!id) return apiError("id required", 400);
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (reason.length < 5 || reason.length > 500) {
    return Response.json(
      { success: false, error: REASON_MSG, code: "VALIDATION", fieldErrors: { reason: REASON_MSG } },
      { status: 400 }
    );
  }
  const previous = await prisma.product.findUnique({ where: { id } });
  if (!previous) return apiError("Product not found", 404);
  if (previous.status === "ARCHIVED") return apiError("This product is already archived", 400);
  const product = await prisma.product.update({
    where: { id },
    data: { status: "ARCHIVED", moderationNote: reason },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "PRODUCT_ARCHIVED",
    entity: "Product",
    entityId: id,
    previousValue: { status: previous.status },
    newValue: { status: "ARCHIVED", reason },
  });
  await notifyStoreOwner({
    storeId: previous.storeId,
    type: "PRODUCT_ARCHIVED",
    title: "Product archived",
    body: `"${previous.name}" was archived by MandiBazaar and is no longer shown in the shop. Reason: ${reason}`,
    metadata: { productId: id },
  });
  return apiSuccess({
    id: product.id,
    status: product.status,
    previousStatus: previous.status,
  });
}

/** Counts for the admin nav badges (QA P4). */
export async function adminReviewCounts() {
  const [stores, products, productChanges, riders] = await Promise.all([
    prisma.store.count({ where: { status: "PENDING" } }),
    prisma.product.count({ where: { status: "DRAFT" } }),
    prisma.product.count({ where: { AND: [{ status: { not: "DRAFT" } }, HAS_PENDING_CHANGES] } }),
    prisma.rider.count({ where: { approvalStatus: "PENDING" } }),
  ]);
  return { stores, products, productChanges, riders };
}
