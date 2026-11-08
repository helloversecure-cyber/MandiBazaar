import { NextRequest } from "next/server";
import { requireStorePortal } from "@/lib/auth/auth";
import { getUserStoreIds, getUserStoreNotices } from "@/lib/stores/access";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toNumber, parsePagination, paginationMeta, toUserMessage } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { syncOrderAfterFulfillmentReady } from "@/lib/orders/fulfillment-sync";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { OrderStatus, Prisma } from "@prisma/client";
import {
  createStoreProduct,
  updateStoreProduct,
} from "@/lib/products/store-product-service";
import {
  isStoreOrderTab,
  storeFulfillmentBlockReason,
  storeOrderTabWhere,
  STORE_ORDER_TABS,
} from "@/lib/stores/fulfillment-rules";
import { storeEarningsSummary } from "@/lib/stores/store-earnings";

export async function GET(req: NextRequest) {
  try {
    const session = await requireStorePortal();
    const resource = req.nextUrl.searchParams.get("resource") || "dashboard";
    const storeIdParam = req.nextUrl.searchParams.get("storeId");

    const storeIds = await getUserStoreIds(session.user.id);

    if (storeIds.length === 0) {
      return apiSuccess({ stores: [], items: [], message: "No approved stores yet" });
    }

    const scoped = storeIdParam && storeIds.includes(storeIdParam) ? [storeIdParam] : storeIds;

    if (resource === "stores") {
      const stores = await prisma.store.findMany({
        where: { id: { in: storeIds } },
        include: { documents: true, _count: { select: { products: true } } },
      });
      return apiSuccess({ items: stores });
    }

    if (resource === "categories") {
      const storeId = storeIdParam && storeIds.includes(storeIdParam)
        ? storeIdParam
        : storeIds[0];
      if (!storeId) {
        return apiSuccess({ items: [], storeRequested: [], allActive: [] });
      }
      const { categoriesForStore } = await import(
        "@/lib/catalog/requested-categories"
      );
      const data = await categoriesForStore(storeId);
      return apiSuccess(data);
    }

    if (resource === "products") {
      const sp = req.nextUrl.searchParams;
      const q = (sp.get("q") || "").trim().slice(0, 80);
      const filter = sp.get("filter") || "all";
      const base: Prisma.ProductWhereInput = {
        storeId: { in: scoped },
        status: { not: "ARCHIVED" },
      };
      const filterWhere: Record<string, Prisma.ProductWhereInput> = {
        all: {},
        active: { status: "ACTIVE", stockQuantity: { gt: 0 } },
        inactive: { status: "INACTIVE" },
        outofstock: { status: { in: ["ACTIVE", "INACTIVE"] }, stockQuantity: { lte: 0 } },
        awaiting: { status: "DRAFT" },
        review: { pendingChanges: { not: Prisma.DbNull } },
        // Listings MandiBazaar declined / removed, with the reason (moderationNote)
        declined: { status: "ARCHIVED", moderationNote: { not: null } },
      };
      const baseFor = (k: string): Prisma.ProductWhereInput =>
        k === "declined" ? { storeId: { in: scoped } } : base;
      const where: Prisma.ProductWhereInput = {
        ...baseFor(filter),
        ...(filterWhere[filter] || {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { urduName: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const include = {
        category: { select: { id: true, name: true, isActive: true } },
        images: { orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }] },
        store: { select: { name: true } },
      };
      const serialize = <T extends { price: unknown; salePrice: unknown }>(p: T) => ({
        ...p,
        price: toNumber(p.price),
        salePrice: p.salePrice != null ? toNumber(p.salePrice) : null,
      });

      // Paged mode (store Products page, QA Q8/R7). Without ?page the full
      // list is returned as before (dashboard, Deals page).
      if (!sp.get("page")) {
        const items = await prisma.product.findMany({
          where,
          include,
          orderBy: { updatedAt: "desc" },
        });
        return apiSuccess({ items: items.map(serialize) });
      }
      const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
      const filterKeys = Object.keys(filterWhere);
      const [total, items, ...counts] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({ where, include, orderBy: { updatedAt: "desc" }, skip, take }),
        ...filterKeys.map((k) => prisma.product.count({ where: { ...baseFor(k), ...filterWhere[k] } })),
      ]);
      return apiSuccess({
        items: items.map(serialize),
        pagination: paginationMeta(page, limit, total),
        counts: Object.fromEntries(filterKeys.map((k, i) => [k, counts[i]])),
      });
    }

    if (resource === "orders") {
      const sp = req.nextUrl.searchParams;
      const tabParam = sp.get("tab") || "all";
      const tab = isStoreOrderTab(tabParam) ? tabParam : "all";
      const q = (sp.get("q") || "").trim().slice(0, 60);
      const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
      const base: Prisma.StoreFulfillmentWhereInput = { storeId: { in: scoped } };
      const search: Prisma.StoreFulfillmentWhereInput = q
        ? {
            OR: [
              { order: { orderNumber: { contains: q, mode: "insensitive" } } },
              { order: { customer: { fullName: { contains: q, mode: "insensitive" } } } },
              { order: { customer: { phone: { contains: q } } } },
            ],
          }
        : {};
      const where: Prisma.StoreFulfillmentWhereInput = {
        AND: [base, storeOrderTabWhere(tab) as Prisma.StoreFulfillmentWhereInput, search],
      };
      const [total, rows, ...counts] = await Promise.all([
        prisma.storeFulfillment.count({ where }),
        prisma.storeFulfillment.findMany({
          where,
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                orderStatus: true,
                productPaymentStatus: true,
                deliveryFeePaymentStatus: true,
                paymentMethod: true,
                notes: true,
                createdAt: true,
                cancelReason: true,
                deliveryAddressSnapshot: true,
                customer: { select: { fullName: true, phone: true } },
                items: {
                  where: { storeId: { in: scoped } },
                  select: {
                    id: true,
                    productName: true,
                    variantName: true,
                    unit: true,
                    quantity: true,
                    unitPrice: true,
                    finalPrice: true,
                    imageUrl: true,
                  },
                },
                rider: {
                  select: { id: true, name: true, phone: true, vehicleType: true },
                },
              },
            },
            store: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
        ...STORE_ORDER_TABS.map((t) =>
          prisma.storeFulfillment.count({
            where: { AND: [base, storeOrderTabWhere(t.key) as Prisma.StoreFulfillmentWhereInput] },
          })
        ),
      ]);
      return apiSuccess({
        items: rows.map((f) => {
          const addr = (f.order.deliveryAddressSnapshot || {}) as Record<string, unknown>;
          const { deliveryAddressSnapshot: _omit, ...order } = f.order;
          void _omit;
          return {
            ...f,
            subtotal: toNumber(f.subtotal),
            order: {
              ...order,
              // Stores see the delivery area only, not the full home address.
              deliveryArea: [addr.area, addr.city].filter(Boolean).join(", ") || null,
              items: order.items.map((i) => ({
                ...i,
                unitPrice: toNumber(i.unitPrice),
                finalPrice: toNumber(i.finalPrice),
              })),
            },
          };
        }),
        tab,
        pagination: paginationMeta(page, limit, total),
        counts: Object.fromEntries(STORE_ORDER_TABS.map((t, i) => [t.key, counts[i]])),
      });
    }

    if (resource === "payouts") {
      // N6: sales, commission %, amount due, next payout and history.
      const summary = await storeEarningsSummary(scoped);
      return apiSuccess({ ...summary, items: summary.payouts });
    }

    // dashboard
    const [productCount, pendingFulfillments, recentOrders, earnings, storeNotices] = await Promise.all([
      prisma.product.count({
        where: { storeId: { in: scoped }, status: { not: "ARCHIVED" } },
      }),
      // Same rule as the "To prepare" tab: paid/confirmed and not cancelled.
      prisma.storeFulfillment.count({
        where: {
          AND: [
            { storeId: { in: scoped } },
            storeOrderTabWhere("prepare") as Prisma.StoreFulfillmentWhereInput,
          ],
        },
      }),
      prisma.storeFulfillment.findMany({
        where: { storeId: { in: scoped } },
        include: {
          order: { select: { orderNumber: true, orderStatus: true, createdAt: true } },
          store: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      storeEarningsSummary(scoped),
      getUserStoreNotices(session.user.id),
    ]);

    return apiSuccess({
      storeIds: scoped,
      productCount,
      pendingFulfillments,
      // N1: simple money numbers at the top of the dashboard
      salesThisWeek: earnings.salesThisWeek,
      // Other stores of this owner that are pending / rejected / suspended (+ admin reason)
      storeNotices,
      pendingPayout: earnings.amountDue,
      commissionPct: earnings.commissionPct,
      recentOrders: recentOrders.map((f) => ({
        ...f,
        subtotal: toNumber(f.subtotal),
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    if (msg === "STORE_NOT_APPROVED") {
      return apiError(
        "Your store is pending MandiBazaar approval. You can use the portal after approval.",
        403
      );
    }
    console.error("[store:api]", e);
    return apiError(toUserMessage(e), 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireStorePortal();
    const body = await req.json();
    const storeIds = await getUserStoreIds(session.user.id);
    // Validation (N3), photos, category and DRAFT status live in the service.
    return await createStoreProduct(session, body || {}, storeIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    if (msg === "STORE_NOT_APPROVED") {
      return apiError(
        "Your store is pending MandiBazaar approval. You can use the portal after approval.",
        403
      );
    }
    return apiError(toUserMessage(e), 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireStorePortal();
    const body = await req.json();
    const storeIds = await getUserStoreIds(session.user.id);

    if (body.action === "UPDATE_PROFILE") {
      // S0 rules + payout/location requirement + audited name/address changes (QA S10, N7)
      const { updateStoreProfile } = await import("@/lib/signup/store-profile");
      return await updateStoreProfile(session, body, storeIds);
    }

    if (body.action === "FULFILLMENT_STATUS") {
      const fulfillment = await prisma.storeFulfillment.findUnique({
        where: { id: body.fulfillmentId },
        include: { order: true },
      });
      if (!fulfillment) return apiError("Not found", 404);
      if (
        session.user.role !== "SUPER_ADMIN" &&
        !storeIds.includes(fulfillment.storeId)
      ) {
        return apiError("Forbidden", 403);
      }

      // N2 / STO-05: only paid/confirmed, open orders; forward steps only.
      const target = String(body.status || "");
      const blockReason = storeFulfillmentBlockReason(
        {
          orderStatus: fulfillment.order.orderStatus,
          productPaymentStatus: fulfillment.order.productPaymentStatus,
          deliveryFeePaymentStatus: fulfillment.order.deliveryFeePaymentStatus,
          fulfillmentStatus: fulfillment.status,
        },
        target
      );
      if (blockReason) return apiError(blockReason, 400, "FULFILLMENT_NOT_ALLOWED");
      const targetStatus = target as OrderStatus;

      const result = await prisma.$transaction(async (tx) => {
        // Guard against a cancel/refund that lands between the check and the write.
        const changed = await tx.storeFulfillment.updateMany({
          where: {
            id: fulfillment.id,
            status: fulfillment.status,
            order: {
              orderStatus: { in: ["CONFIRMED", "PROCESSING", "PACKED"] },
              productPaymentStatus: { notIn: ["REFUNDED", "FAILED"] },
            },
          },
          data: {
            status: targetStatus,
            ...(targetStatus === "READY_FOR_DISPATCH" ? { readyAt: new Date() } : {}),
          },
        });
        if (changed.count === 0) throw new Error("FULFILLMENT_CHANGED");
        const updated = await tx.storeFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        });

        // Moves the parent order on (Confirmed → Processing, and to Ready
        // once every store is ready). Same helper for every store step.
        const orderSync: { status: OrderStatus; becameReady: boolean } =
          await syncOrderAfterFulfillmentReady(
            tx,
            fulfillment.orderId
          );
        return { updated, orderSync };
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "STORE_FULFILLMENT_STATUS",
        entity: "StoreFulfillment",
        entityId: fulfillment.id,
        previousValue: { status: fulfillment.status },
        newValue: { status: targetStatus, orderNumber: fulfillment.order.orderNumber },
      });

      if (result.orderSync?.becameReady) {
        await notifyOrderEvent(
          fulfillment.orderId,
          "ORDER_READY",
          "Order ready for dispatch",
          "Your order is packed and ready. A rider will be assigned soon."
        );
      }

      return apiSuccess({
        ...result.updated,
        orderStatus: result.orderSync?.status,
      });
    }

    if (body.action === "UPDATE_PRODUCT") {
      // Field rules (N3), category keep (N4) and admin re-review (N9).
      return await updateStoreProduct(session, body, storeIds);
    }

    if (body.action === "DELETE_PRODUCT") {
      const productId = String(body.productId || "");
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { _count: { select: { cartItems: true } } },
      });
      if (!product) return apiError("Product not found", 404);
      if (
        session.user.role !== "SUPER_ADMIN" &&
        !storeIds.includes(product.storeId)
      ) {
        return apiError("Forbidden", 403);
      }
      if (product.status === "ARCHIVED") {
        return apiError("Product is already removed", 400);
      }
      // Reservations on variant line items live on the variant row, not the
      // product, so check both — otherwise a variant product with live
      // reservations could be archived out from under open orders.
      const reservedVariant = await prisma.productVariant.findFirst({
        where: { productId, reservedStock: { gt: 0 } },
        select: { id: true },
      });
      if (product.reservedStock > 0 || reservedVariant) {
        return apiError(
          "Cannot remove this product while stock is reserved on unpaid orders. Wait for those orders to complete or expire.",
          400
        );
      }

      // Soft-remove so order history stays intact; hide from shop + portal lists
      await prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { productId } });
        await tx.wishlistItem.deleteMany({ where: { productId } });
        await tx.productVariant.updateMany({
          where: { productId },
          data: { isActive: false },
        });
        await tx.product.update({
          where: { id: productId },
          data: {
            status: "ARCHIVED",
            stockQuantity: 0,
            isFeatured: false,
            isBestSeller: false,
            isNewArrival: false,
            isSeasonal: false,
          },
        });
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "STORE_PRODUCT_DELETED",
        entity: "Product",
        entityId: productId,
        newValue: { name: product.name, status: "ARCHIVED" },
      });

      return apiSuccess({ id: productId, status: "ARCHIVED" });
    }

    return apiError("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    if (msg === "FULFILLMENT_CHANGED") {
      return apiError(
        "This order changed (cancelled, refunded or already updated). Refresh the list.",
        409,
        "FULFILLMENT_NOT_ALLOWED"
      );
    }
    if (msg === "STORE_NOT_APPROVED") {
      return apiError(
        "Your store is pending MandiBazaar approval. You can use the portal after approval.",
        403
      );
    }
    return apiError(toUserMessage(e), 400);
  }
}
