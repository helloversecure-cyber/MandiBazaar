import { requireAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { productSchema } from "@/lib/validators/schemas";
import { writeAuditLog } from "@/lib/audit";
import { adjustStock } from "@/lib/inventory/stock";
import { slugify, apiError, apiSuccess, apiZodError, apiFieldErrors, toNumber, toUserMessage } from "@/lib/utils";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { NextRequest } from "next/server";
// D2 (admin catalog, stores, settings & lists) handlers
import {
  listAdminProducts,
  handleProductAction,
  archiveProduct,
  adminReviewCounts,
} from "@/lib/catalog/admin-products";
import { listAdminCategories, createCategory, updateCategory } from "@/lib/catalog/admin-categories";
import {
  createRiderWithLogin,
  createStaff,
  listRiders,
  listStaff,
  reviewRider,
  updateRiderDocuments,
} from "@/lib/admin/accounts";
import { listAuditLogs, listCustomers } from "@/lib/admin/lists";
import { getAdminSettings, saveAdminSettings } from "@/lib/admin/settings";
import { stockAdjustLimitError, stockAdjustSchema } from "@/lib/admin/form-rules";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const resource = req.nextUrl.searchParams.get("resource") || "products";

    if (resource === "products") {
      return listAdminProducts(req.nextUrl.searchParams);
    }

    if (resource === "review-counts") {
      return apiSuccess(await adminReviewCounts());
    }

    if (resource === "categories") {
      return listAdminCategories(req.nextUrl.searchParams);
    }

    // Coupons moved to /api/admin/coupons (QA T3)

    if (resource === "riders") {
      const assignableOnly =
        req.nextUrl.searchParams.get("assignable") === "1";
      if (assignableOnly) {
        // Assign-rider dropdown (admin orders): every assignable rider, unpaginated.
        const items = await prisma.rider.findMany({
          where: { approvalStatus: "APPROVED", isActive: true },
          select: { id: true, name: true, phone: true },
          orderBy: { name: "asc" },
        });
        return apiSuccess({ items });
      }
      return listRiders(req.nextUrl.searchParams);
    }

    if (resource === "customers") {
      return listCustomers(req.nextUrl.searchParams);
    }

    if (resource === "staff") {
      return listStaff(req.nextUrl.searchParams);
    }

    if (resource === "settings") {
      return getAdminSettings();
    }

    if (resource === "audit") {
      return listAuditLogs(req.nextUrl.searchParams);
    }

    return apiError("Unknown resource");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError("Failed", 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const body = await req.json();
    const { resource } = body;

    if (resource === "product") {
      await requireAdmin(PERMISSIONS.PRODUCTS_WRITE);
      const parsed = productSchema.safeParse(body.data);
      if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid product");
      const data = parsed.data;
      if (!body.storeId) return apiError("storeId is required for products");
      const rawImages = Array.isArray(body.images) ? body.images : [];
      const imageList: { url: string; alt?: string }[] = [];
      for (const item of rawImages) {
        if (!item || typeof item !== "object") continue;
        const url =
          typeof (item as { url?: unknown }).url === "string"
            ? String((item as { url: string }).url).trim()
            : "";
        if (!url) continue;
        const altRaw = (item as { alt?: unknown }).alt;
        imageList.push({
          url,
          ...(typeof altRaw === "string" ? { alt: altRaw } : {}),
        });
      }
      if (!imageList.length) {
        return apiError("Add at least one product photo", 400);
      }
      const product = await prisma.product.create({
        data: {
          ...data,
          storeId: body.storeId,
          slug: slugify(data.name) + "-" + Date.now().toString(36),
          images: {
            create: imageList.slice(0, 5).map((img, i) => ({
              url: img.url,
              alt: img.alt,
              sortOrder: i,
              isPrimary: i === 0,
            })),
          },
          variants: body.variants?.length
            ? {
                create: body.variants.map(
                  (v: {
                    name: string;
                    sku: string;
                    unit: string;
                    price: number;
                    salePrice?: number;
                    stockQuantity?: number;
                  }) => ({
                    name: v.name,
                    sku: v.sku,
                    unit: v.unit,
                    price: v.price,
                    salePrice: v.salePrice,
                    stockQuantity: v.stockQuantity || 0,
                  })
                ),
              }
            : undefined,
        },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: "PRODUCT_CREATED",
        entity: "Product",
        entityId: product.id,
        newValue: { name: product.name, price: data.price },
      });
      return apiSuccess(product, 201);
    }

    if (resource === "category") {
      await requireAdmin(PERMISSIONS.PRODUCTS_WRITE);
      return createCategory(session.user, body.data);
    }

    if (resource === "rider") {
      await requireAdmin(PERMISSIONS.RIDERS_WRITE);
      // S0 rules; blank password → random one-time password shown once in `loginHint`.
      return createRiderWithLogin(session.user, body.data);
    }

    if (resource === "stock") {
      await requireAdmin(PERMISSIONS.INVENTORY_WRITE);
      const productId = typeof body.data?.productId === "string" ? body.data.productId : "";
      const variantId = typeof body.data?.variantId === "string" && body.data.variantId ? body.data.variantId : undefined;
      if (!productId) return apiFieldErrors({ productId: "Choose a product" });
      const parsed = stockAdjustSchema.safeParse({ quantity: body.data?.quantity, note: body.data?.note });
      if (!parsed.success) return apiZodError(parsed.error);
      const { quantity, note } = parsed.data;
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { stockQuantity: true, reservedStock: true },
      });
      if (!product) return apiError("Product not found", 404);
      const current = variantId
        ? await prisma.productVariant.findFirst({
            where: { id: variantId, productId },
            select: { stockQuantity: true, reservedStock: true },
          })
        : product;
      if (!current) return apiError("Variant not found", 404);
      const limitError = stockAdjustLimitError(quantity, {
        stock: current.stockQuantity,
        reserved: current.reservedStock,
      });
      if (limitError) return apiFieldErrors({ quantity: limitError });
      const txn = await adjustStock(
        productId,
        quantity,
        note || (quantity > 0 ? "Manual stock added" : "Manual stock removed"),
        session.user.id,
        variantId
      );
      await writeAuditLog({
        userId: session.user.id,
        action: "STOCK_CHANGED",
        entity: "Product",
        entityId: productId,
        previousValue: { stock: txn.previousStock },
        newValue: { stock: txn.newStock, quantity, note: note || undefined, variantId },
      });
      return apiSuccess(txn);
    }

    if (resource === "staff") {
      if (!["SUPER_ADMIN", "ADMIN"].includes(session.user.role)) {
        return apiError("Forbidden", 403);
      }
      // Only a Super Admin may create another privileged admin; a regular admin
      // can create manager-level staff but not peers (least privilege).
      const requestedRole =
        typeof (body.data as { role?: unknown })?.role === "string"
          ? String((body.data as { role: string }).role).toUpperCase()
          : "";
      if (requestedRole === "ADMIN" && session.user.role !== "SUPER_ADMIN") {
        return apiError("Only a Super Admin can create an Admin account.", 403);
      }
      // S0 rules; blank password → random; mustChangePassword on first login.
      return createStaff(session.user, body.data);
    }

    return apiError("Unknown resource");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin:api]", e);
    return apiError(toUserMessage(e), 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireAdmin();
    const body = await req.json();
    const { resource, id, data } = body;

    if (resource === "product") {
      await requireAdmin(PERMISSIONS.PRODUCTS_WRITE);
      // REVIEW (approve/decline, reason required) · APPROVE_CHANGES / DECLINE_CHANGES (N9) · RESTORE_STATUS (undo archive)
      const handled = await handleProductAction(session.user, id, data);
      if (handled) return handled;

      const previous = await prisma.product.findUnique({ where: { id } });
      if (!previous) return apiError("Product not found", 404);

      const product = await prisma.product.update({ where: { id }, data });
      await writeAuditLog({
        userId: session.user.id,
        action: "PRODUCT_UPDATED",
        entity: "Product",
        entityId: id,
        previousValue: previous
          ? { price: toNumber(previous.price), stock: previous.stockQuantity }
          : undefined,
        newValue: data,
      });
      return apiSuccess(product);
    }

    if (resource === "category") {
      await requireAdmin(PERMISSIONS.PRODUCTS_WRITE);
      // Name rule + case-insensitive duplicates + image required to activate
      return updateCategory(session.user, id, data);
    }

    if (resource === "settings") {
      await requireAdmin(PERMISSIONS.SETTINGS_WRITE);
      // Whitelisted, validated fields only (S14 / U5); audit log keeps old → new
      return saveAdminSettings(session.user, data);
    }

    if (resource === "customer") {
      await requireAdmin(PERMISSIONS.CUSTOMERS_WRITE);
      if (!id) return apiError("id required", 400);
      if (typeof data?.isActive !== "boolean") {
        return apiError("data.isActive boolean required", 400);
      }

      const existing = await prisma.user.findFirst({
        where: { id, role: { name: "CUSTOMER" } },
      });
      if (!existing) return apiError("Customer not found", 404);

      const user = await prisma.user.update({
        where: { id },
        data: { isActive: data.isActive },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: data.isActive ? "CUSTOMER_ACTIVATED" : "CUSTOMER_DEACTIVATED",
        entity: "User",
        entityId: id,
        previousValue: { isActive: existing.isActive },
        newValue: { isActive: data.isActive },
      });
      return apiSuccess({ id: user.id, isActive: user.isActive });
    }

    if (resource === "rider") {
      await requireAdmin(PERMISSIONS.RIDERS_WRITE);

      if (!id) return apiError("id required", 400);

      if (data?.action === "REVIEW") {
        // Refuses to approve with an invalid CNIC or missing documents (QA P5)
        return reviewRider(session.user, id, data);
      }

      if (data?.action === "DOCUMENTS") {
        // Add / replace documents of a pending rider (quick-added riders start PENDING)
        return updateRiderDocuments(session.user, id, data);
      }

      // Only activate / deactivate here — approval goes through REVIEW above.
      if (typeof data?.isActive !== "boolean") {
        return apiError("data.isActive boolean required", 400);
      }
      const existingRider = await prisma.rider.findUnique({ where: { id } });
      if (!existingRider) return apiError("Rider not found", 404);
      if (data.isActive && existingRider.approvalStatus !== "APPROVED") {
        return apiError("Approve this rider before activating", 400);
      }
      const rider = await prisma.rider.update({
        where: { id },
        data: { isActive: data.isActive, ...(data.isActive ? {} : { status: "OFFLINE" }) },
      });
      await writeAuditLog({
        userId: session.user.id,
        action: data.isActive ? "RIDER_ACTIVATED" : "RIDER_DEACTIVATED",
        entity: "Rider",
        entityId: id,
        previousValue: { isActive: existingRider.isActive },
        newValue: { isActive: data.isActive },
      });
      return apiSuccess(rider);
    }

    return apiError("Unknown resource");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin:api]", e);
    return apiError(toUserMessage(e), 400);
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.PRODUCTS_WRITE);
    const { resource, id, soft, reason } = await req.json();

    if (resource === "product") {
      if (soft) {
        // Archive with a required reason (shown to the store owner); UI offers Undo
        return archiveProduct(session.user, id, reason);
      }
      // Prefer archive over hard delete for historical integrity
      return apiError("Use soft delete (archive) for products");
    }

    if (resource === "category") {
      await prisma.category.delete({ where: { id } });
      await writeAuditLog({
        userId: session.user.id,
        action: "CATEGORY_DELETED",
        entity: "Category",
        entityId: id,
      });
      return apiSuccess({ deleted: true });
    }

    return apiError("Unknown resource");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    console.error("[admin:api]", e);
    return apiError(toUserMessage(e), 400);
  }
}
