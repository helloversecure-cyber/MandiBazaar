import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, paginationMeta, parsePagination, toNumber } from "@/lib/utils";
import { CUSTOMER_ORDER_FILTERS, customerOrderFilterWhere, isCustomerOrderFilter } from "@/lib/portal/customer-orders";

export const dynamic = "force-dynamic";

/**
 * Customer "My orders" list (QA Q8 / R8 / M11): only the signed-in user's own
 * orders, with Active / Delivered / Cancelled filter, order-number search and pages.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const sp = req.nextUrl.searchParams;
    const filterParam = sp.get("filter") || "all";
    const filter = isCustomerOrderFilter(filterParam) ? filterParam : "all";
    const q = (sp.get("q") || "").trim().toUpperCase().slice(0, 30);
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 10, maxLimit: 50 });

    const base: Prisma.OrderWhereInput = { customerId: session.user.id };
    const where: Prisma.OrderWhereInput = {
      ...base,
      ...(customerOrderFilterWhere(filter) as Prisma.OrderWhereInput),
      ...(q ? { orderNumber: { contains: q, mode: "insensitive" } } : {}),
    };

    const [total, orders, ...counts] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        select: {
          orderNumber: true,
          createdAt: true,
          grandTotal: true,
          remainingAmount: true,
          orderStatus: true,
          productPaymentStatus: true,
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      ...CUSTOMER_ORDER_FILTERS.map((f) =>
        prisma.order.count({
          where: { ...base, ...(customerOrderFilterWhere(f.key) as Prisma.OrderWhereInput) },
        })
      ),
    ]);

    return apiSuccess({
      items: orders.map((o) => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        grandTotal: toNumber(o.grandTotal),
        remainingAmount: toNumber(o.remainingAmount),
        orderStatus: o.orderStatus,
        productPaymentStatus: o.productPaymentStatus,
        itemCount: o._count.items,
      })),
      filter,
      pagination: paginationMeta(page, limit, total),
      counts: Object.fromEntries(CUSTOMER_ORDER_FILTERS.map((f, i) => [f.key, counts[i]])),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    return apiError("Failed to load orders", 500);
  }
}
