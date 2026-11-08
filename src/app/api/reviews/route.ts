import { getSession, requireAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { reviewSchema } from "@/lib/validators/schemas";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiSuccess, apiZodError, paginationMeta, parsePagination } from "@/lib/utils";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { Prisma, ReviewStatus } from "@prisma/client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");
  const mine = url.searchParams.get("mine") === "true";

  // Admin moderation list (QA Q7 / R6): every status, paginated, filters.
  if (url.searchParams.get("admin") === "1") {
    try {
      await requireAdmin(PERMISSIONS.REVIEWS_WRITE);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return apiError(msg === "FORBIDDEN" ? "Forbidden" : "Unauthorized", msg === "FORBIDDEN" ? 403 : 401);
    }
    const sp = url.searchParams;
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
    const status = sp.get("status");
    const rating = parseInt(sp.get("rating") || "", 10);
    const q = sp.get("q")?.trim();
    const where: Prisma.ReviewWhereInput = {
      ...(status && ["PENDING", "APPROVED", "HIDDEN", "DELETED"].includes(status)
        ? { status: status as ReviewStatus }
        : {}),
      ...(rating >= 1 && rating <= 5 ? { rating } : {}),
      ...(productId ? { productId } : {}),
      ...(q
        ? {
            OR: [
              { product: { name: { contains: q, mode: "insensitive" } } },
              { user: { fullName: { contains: q, mode: "insensitive" } } },
              { comment: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, items, pendingCount] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        include: {
          user: { select: { fullName: true } },
          product: { select: { id: true, name: true, slug: true, store: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.review.count({ where: { status: "PENDING" } }),
    ]);
    return apiSuccess({ items, pagination: paginationMeta(page, limit, total), pendingCount });
  }

  if (mine) {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    const reviews = await prisma.review.findMany({
      where: { userId: session.user.id },
      include: {
        product: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return apiSuccess(reviews);
  }

  const where = {
    status: "APPROVED" as const,
    ...(productId ? { productId } : {}),
  };
  const reviews = await prisma.review.findMany({
    where,
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return apiSuccess(reviews);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);

  const parsed = reviewSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiZodError(parsed.error);

  const delivered = await prisma.order.findFirst({
    where: {
      id: parsed.data.orderId,
      customerId: session.user.id,
      orderStatus: "DELIVERED",
      items: { some: { productId: parsed.data.productId } },
    },
  });
  if (!delivered) {
    return apiError("You can only review products from delivered orders");
  }

  // One review per product per order (QA S16)
  const existing = await prisma.review.findFirst({
    where: {
      userId: session.user.id,
      productId: parsed.data.productId,
      orderId: parsed.data.orderId,
    },
    select: { id: true },
  });
  if (existing) {
    return apiError("You have already reviewed this product for this order", 409);
  }

  const review = await prisma.review.create({
    data: {
      ...parsed.data,
      userId: session.user.id,
      status: "PENDING",
    },
  });
  return apiSuccess(review, 201);
}

export async function PATCH(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.REVIEWS_WRITE);
    const { id, status } = await req.json();
    if (typeof id !== "string" || !id) return apiError("id required", 400);
    if (!["PENDING", "APPROVED", "HIDDEN"].includes(status)) {
      return apiError("status must be PENDING, APPROVED or HIDDEN", 400);
    }
    const review = await prisma.review.update({
      where: { id },
      data: { status },
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "REVIEW_STATUS_UPDATED",
      entity: "Review",
      entityId: id,
      newValue: { status },
    });
    return apiSuccess(review);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError(msg, 400);
  }
}
