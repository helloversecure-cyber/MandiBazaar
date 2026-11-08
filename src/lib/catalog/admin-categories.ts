/**
 * Admin → Categories server logic (QA P11 / S13 / Q7). Called from
 * `src/app/api/admin/route.ts`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess, apiZodError, paginationMeta, parsePagination, slugify } from "@/lib/utils";
import { categorySchema } from "@/lib/validators/schemas";
import { zCategoryName } from "@/lib/validators/pk";
import {
  CATEGORY_IMAGE_REQUIRED_MSG,
  duplicateCategoryMessage,
  findDuplicateCategory,
  isAllowedCategoryImageUrl,
} from "@/lib/catalog/category-rules";

const COUNT_INCLUDE = {
  _count: { select: { products: true } },
} as const;

/**
 * GET resource=categories. Without `page` → every category (used by product /
 * store pickers; unchanged shape `{items}`). With `page` → paginated list with
 * search (`q`) and `filter` = active | inactive | noimage.
 */
export async function listAdminCategories(sp: URLSearchParams) {
  if (!sp.get("page")) {
    const items = await prisma.category.findMany({ orderBy: { sortOrder: "asc" }, include: COUNT_INCLUDE });
    return apiSuccess({ items });
  }
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const q = sp.get("q")?.trim();
  const filter = sp.get("filter");
  const and: Prisma.CategoryWhereInput[] = [];
  if (q) and.push({ name: { contains: q, mode: "insensitive" } });
  if (filter === "active") and.push({ isActive: true });
  if (filter === "inactive") and.push({ isActive: false });
  if (filter === "noimage") and.push({ OR: [{ imageUrl: null }, { imageUrl: "" }] });
  const where: Prisma.CategoryWhereInput = { AND: and };
  const [total, items, activeCount, product] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { products: true } },
      },
      skip,
      take,
    }),
    prisma.category.count({ where: { isActive: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const live = new Map(product.map((g) => [g.categoryId, g._count._all]));
  return apiSuccess({
    items: items.map((c) => ({ ...c, liveProductCount: live.get(c.id) || 0 })),
    pagination: paginationMeta(page, limit, total),
    activeCount,
  });
}

async function duplicateOf(name: string, excludeId?: string) {
  const all = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
  return findDuplicateCategory(name, all, excludeId);
}

export async function createCategory(actor: { id: string }, raw: unknown) {
  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) return apiZodError(parsed.error);
  const data = parsed.data;
  const dup = await duplicateOf(data.name);
  if (dup) return apiFieldErrors({ name: duplicateCategoryMessage(dup) }, 409);
  const slug = slugify(data.name);
  if (!slug) return apiFieldErrors({ name: "Use English letters or numbers in the category name" });
  const maxSort = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const cat = await prisma.category.create({
    data: {
      name: data.name,
      slug,
      description: data.description || null,
      imageUrl: data.imageUrl || null,
      isActive: data.isActive,
      sortOrder: data.sortOrder || (maxSort._max.sortOrder || 0) + 1,
    },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "CATEGORY_CREATED",
    entity: "Category",
    entityId: cat.id,
    newValue: { name: cat.name, slug: cat.slug, isActive: cat.isActive, imageUrl: cat.imageUrl },
  });
  return apiSuccess(cat, 201);
}

export async function updateCategory(actor: { id: string }, id: string, data: Record<string, unknown> | undefined) {
  if (!id) return apiError("id required", 400);
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return apiError("Category not found", 404);

  const patch: Prisma.CategoryUpdateInput = {};
  const fieldErrors: Record<string, string> = {};

  if (data?.name !== undefined) {
    const n = zCategoryName.safeParse(data.name);
    if (!n.success) fieldErrors.name = n.error.issues[0]?.message || "Invalid name";
    else {
      const dup = await duplicateOf(n.data, id);
      if (dup) fieldErrors.name = duplicateCategoryMessage(dup);
      else if (n.data !== existing.name) {
        patch.name = n.data;
        // slug stays stable (shop links keep working) unless it was derived from a different word
      }
    }
  }
  if (data?.description !== undefined) {
    const d = data.description === null ? "" : String(data.description).trim();
    if (d.length > 500) fieldErrors.description = "Description can be at most 500 characters";
    else patch.description = d || null;
  }
  let nextImage = existing.imageUrl;
  if (data?.imageUrl !== undefined) {
    const url = String(data.imageUrl || "").trim();
    if (!isAllowedCategoryImageUrl(url) || url.length > 2000) {
      fieldErrors.imageUrl = "Upload an image or use a link starting with https://";
    } else {
      patch.imageUrl = url || null;
      nextImage = url || null;
    }
  }
  let nextActive = existing.isActive;
  if (data?.isActive !== undefined) {
    if (typeof data.isActive !== "boolean") fieldErrors.isActive = "isActive must be true or false";
    else {
      patch.isActive = data.isActive;
      nextActive = data.isActive;
    }
  }
  if (data?.sortOrder !== undefined) {
    const s = Number(data.sortOrder);
    if (!Number.isInteger(s) || s < 0 || s > 100000) fieldErrors.sortOrder = "Order must be a whole number";
    else patch.sortOrder = s;
  }
  // Image is needed to activate, and can't be removed from an active category.
  if (nextActive && !nextImage && !fieldErrors.imageUrl && (patch.isActive === true || data?.imageUrl !== undefined)) {
    fieldErrors[data?.imageUrl !== undefined ? "imageUrl" : "isActive"] = CATEGORY_IMAGE_REQUIRED_MSG;
  }
  if (Object.keys(fieldErrors).length) return apiFieldErrors(fieldErrors);
  if (Object.keys(patch).length === 0) return apiError("No changes to save", 400);

  const cat = await prisma.category.update({ where: { id }, data: patch });
  await writeAuditLog({
    userId: actor.id,
    action:
      data?.isActive !== undefined && Object.keys(patch).length === 1
        ? cat.isActive
          ? "CATEGORY_ACTIVATED"
          : "CATEGORY_DEACTIVATED"
        : "CATEGORY_UPDATED",
    entity: "Category",
    entityId: cat.id,
    previousValue: {
      name: existing.name,
      description: existing.description,
      imageUrl: existing.imageUrl,
      isActive: existing.isActive,
      sortOrder: existing.sortOrder,
    },
    newValue: patch,
  });
  return apiSuccess(cat);
}
