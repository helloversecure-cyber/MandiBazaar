import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import {
  apiError,
  apiFieldErrors,
  apiSuccess,
  apiZodError,
  paginationMeta,
  parsePagination,
  toNumber,
} from "@/lib/utils";
import {
  couponDefinitionProblems,
  couponDefinitionSchema,
} from "@/lib/orders/coupon-rules";
import { toCouponRecord } from "@/lib/orders/coupons";
import type { Coupon } from "@prisma/client";

/**
 * Admin coupons (QA T1–T3, P3). Replaces the old coupon blocks of /api/admin.
 *   GET    ?page=&q=&status=active|inactive   list with every rule + usage report
 *   POST   { data }                             create
 *   PATCH  { id, data }                         edit all rules
 *   PATCH  { id, action: "TOGGLE", isActive }   activate / deactivate
 *   DELETE ?id=                                 only when never used
 */

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
  if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
  return null;
}

function serialize(c: Coupon, totals?: { discount: number; uses: number }) {
  const rec = toCouponRecord(c);
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: rec.value,
    minimumOrderAmount: rec.minimumOrderAmount,
    maximumDiscount: rec.maximumDiscount,
    usageLimit: c.usageLimit,
    perUserLimit: c.perUserLimit,
    firstOrderOnly: Boolean(c.firstOrderOnly),
    startDate: c.startDate.toISOString(),
    expiryDate: c.expiryDate.toISOString(),
    isActive: c.isActive,
    usedCount: c.usedCount,
    totalDiscountGiven: totals?.discount ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    /** Saved rules that break the QA T2 rules — coupon is NOT applied until fixed */
    problems: couponDefinitionProblems(rec),
    expired: c.expiryDate.getTime() < Date.now(),
  };
}

async function codeTaken(code: string, exceptId?: string) {
  const hit = await prisma.coupon.findFirst({
    where: {
      code: { equals: code, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(hit);
}

function dataFor(d: ReturnType<typeof couponDefinitionSchema.parse>) {
  return {
    type: d.type,
    value: d.value,
    minimumOrderAmount: d.minimumOrderAmount,
    maximumDiscount: d.type === "PERCENTAGE" ? d.maximumDiscount : d.maximumDiscount ?? null,
    usageLimit: d.usageLimit,
    perUserLimit: d.perUserLimit,
    firstOrderOnly: d.firstOrderOnly,
    startDate: d.startDate,
    expiryDate: d.expiryDate,
    isActive: d.isActive,
  };
}

export async function GET(req: NextRequest) {
  try {
    // Least-privilege: reading coupons requires the coupons permission, not just
    // any admin session (COUPONS_WRITE is the only coupon permission in the model).
    await requireAdmin(PERMISSIONS.COUPONS_WRITE);
    const sp = req.nextUrl.searchParams;
    const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 100 });
    const q = (sp.get("q") || "").trim();
    const status = sp.get("status");
    const where = {
      ...(q ? { code: { contains: q, mode: "insensitive" as const } } : {}),
      ...(status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.coupon.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.coupon.count({ where }),
    ]);
    const sums = rows.length
      ? await prisma.couponUsage.groupBy({
          by: ["couponId"],
          where: { couponId: { in: rows.map((r) => r.id) } },
          _sum: { discount: true },
          _count: { _all: true },
        })
      : [];
    const byId = new Map(
      sums.map((s) => [s.couponId, { discount: toNumber(s._sum.discount), uses: s._count._all }])
    );
    return apiSuccess({
      items: rows.map((c) => serialize(c, byId.get(c.id))),
      pagination: paginationMeta(page, limit, total),
    });
  } catch (e) {
    return authError(e) ?? apiError("Could not load coupons", 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.COUPONS_WRITE);
    const body = await req.json().catch(() => null);
    const parsed = couponDefinitionSchema.safeParse(body?.data ?? body);
    if (!parsed.success) return apiZodError(parsed.error);
    const d = parsed.data;
    if (await codeTaken(d.code)) {
      return apiFieldErrors({ code: `A coupon with the code ${d.code} already exists` });
    }
    const coupon = await prisma.coupon.create({ data: { code: d.code, ...dataFor(d) } });
    await writeAuditLog({
      userId: session.user.id,
      action: "COUPON_CREATED",
      entity: "Coupon",
      entityId: coupon.id,
      newValue: serialize(coupon),
    });
    return apiSuccess(serialize(coupon), 201);
  } catch (e) {
    const auth = authError(e);
    if (auth) return auth;
    console.error("[admin coupons POST]", e);
    return apiError("Could not create the coupon", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireAdmin(PERMISSIONS.COUPONS_WRITE);
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return apiError("Coupon id is required", 400);
    const existing = await prisma.coupon.findUnique({ where: { id } });
    if (!existing) return apiError("Coupon not found", 404);

    if (body.action === "TOGGLE") {
      if (typeof body.isActive !== "boolean") return apiError("isActive must be true or false", 400);
      const rec = toCouponRecord(existing);
      const problems = couponDefinitionProblems(rec);
      if (body.isActive && problems.length) {
        return apiError(`Fix this coupon before activating it: ${problems.join("; ")}`, 400);
      }
      const coupon = await prisma.coupon.update({ where: { id }, data: { isActive: body.isActive } });
      await writeAuditLog({
        userId: session.user.id,
        action: body.isActive ? "COUPON_ACTIVATED" : "COUPON_DEACTIVATED",
        entity: "Coupon",
        entityId: id,
        previousValue: { isActive: existing.isActive },
        newValue: { isActive: coupon.isActive, code: coupon.code },
      });
      return apiSuccess(serialize(coupon));
    }

    const raw = (body.data ?? {}) as Record<string, unknown>;
    const requested = String(raw.code ?? existing.code).trim().toUpperCase();
    const sameCode = requested === existing.code.toUpperCase();
    // Legacy codes (e.g. "11.11") may not meet today's format — allow keeping them.
    const parsed = couponDefinitionSchema.safeParse({
      ...raw,
      code: sameCode ? "KEEPCODE" : raw.code,
    });
    if (!parsed.success) return apiZodError(parsed.error);
    const d = parsed.data;
    if (!sameCode) {
      if (existing.usedCount > 0) {
        return apiFieldErrors({
          code: "The code can't be changed after the coupon has been used — create a new coupon instead",
        });
      }
      if (await codeTaken(d.code, id)) {
        return apiFieldErrors({ code: `A coupon with the code ${d.code} already exists` });
      }
    }
    const coupon = await prisma.coupon.update({
      where: { id },
      data: { ...(sameCode ? {} : { code: d.code }), ...dataFor(d) },
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "COUPON_UPDATED",
      entity: "Coupon",
      entityId: id,
      previousValue: serialize(existing),
      newValue: serialize(coupon),
    });
    return apiSuccess(serialize(coupon));
  } catch (e) {
    const auth = authError(e);
    if (auth) return auth;
    console.error("[admin coupons PATCH]", e);
    return apiError("Could not update the coupon", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin(PERMISSIONS.COUPONS_WRITE);
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return apiError("Coupon id is required", 400);
    const existing = await prisma.coupon.findUnique({ where: { id } });
    if (!existing) return apiError("Coupon not found", 404);
    const [usages, orders] = await Promise.all([
      prisma.couponUsage.count({ where: { couponId: id } }),
      prisma.order.count({ where: { couponCode: { equals: existing.code, mode: "insensitive" } } }),
    ]);
    if (existing.usedCount > 0 || usages > 0 || orders > 0) {
      return apiError(
        "This coupon has been used, so it can't be deleted (past orders keep their record). Deactivate it instead.",
        409,
        "COUPON_USED"
      );
    }
    await prisma.coupon.delete({ where: { id } });
    await writeAuditLog({
      userId: session.user.id,
      action: "COUPON_DELETED",
      entity: "Coupon",
      entityId: id,
      previousValue: serialize(existing),
    });
    return apiSuccess({ deleted: true });
  } catch (e) {
    const auth = authError(e);
    if (auth) return auth;
    console.error("[admin coupons DELETE]", e);
    return apiError("Could not delete the coupon", 500);
  }
}
