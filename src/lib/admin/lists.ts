/**
 * Paginated admin lists owned by D2: customers, audit logs (QA P10 / R5 / Q5 / Q6 / R6).
 * Called from `src/app/api/admin/route.ts`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiSuccess, paginationMeta, parsePagination, toNumber } from "@/lib/utils";
import { normalizePkMobile } from "@/lib/validators/pk";
import { isInvalidCustomerPhone, phoneLookupVariants } from "@/lib/admin/form-rules";

/** Max customer rows scanned for the "invalid phone" filter. */
export const INVALID_PHONE_SCAN_CAP = 5000;


export async function listCustomers(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const q = sp.get("q")?.trim();
  const invalidPhone = sp.get("filter") === "invalid-phone";

  const and: Prisma.UserWhereInput[] = [{ role: { name: "CUSTOMER" } }];
  if (q) {
    const phones = normalizePkMobile(q) ? phoneLookupVariants(q) : [];
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\s/g, "") } },
        ...(phones.length ? [{ phone: { in: phones } }] : []),
        { email: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.UserWhereInput = { AND: and };

  let total: number;
  let ids: string[];
  let scanCapped = false;
  if (invalidPhone) {
    // Validity is a code rule (normalizePkMobile), so scan with a cap and filter here.
    const rows = await prisma.user.findMany({
      where,
      select: { id: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: INVALID_PHONE_SCAN_CAP + 1,
    });
    scanCapped = rows.length > INVALID_PHONE_SCAN_CAP;
    const bad = rows.slice(0, INVALID_PHONE_SCAN_CAP).filter((r) => isInvalidCustomerPhone(r.phone));
    total = bad.length;
    ids = bad.slice(skip, skip + take).map((r) => r.id);
  } else {
    const [count, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    total = count;
    ids = rows.map((r) => r.id);
  }

  const [users, sums] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true } },
        orders: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    ids.length
      ? prisma.order.groupBy({
          by: ["customerId"],
          where: { customerId: { in: ids } },
          _sum: { productAmountPaid: true, deliveryFeePaid: true },
        })
      : Promise.resolve([] as { customerId: string; _sum: { productAmountPaid: unknown; deliveryFeePaid: unknown } }[]),
  ]);
  const spent = new Map(
    sums.map((s) => [s.customerId, toNumber(s._sum.productAmountPaid) + toNumber(s._sum.deliveryFeePaid)])
  );
  const byId = new Map(users.map((u) => [u.id, u]));

  return apiSuccess({
    items: ids
      .map((id) => byId.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => ({
        id: u.id,
        fullName: u.fullName,
        phone: u.phone,
        email: u.email,
        isActive: u.isActive,
        createdAt: u.createdAt,
        orderCount: u._count.orders,
        totalSpent: spent.get(u.id) || 0,
        lastOrder: u.orders[0]?.createdAt || null,
        phoneInvalid: isInvalidCustomerPhone(u.phone),
      })),
    pagination: paginationMeta(page, limit, total),
    scanCapped,
  });
}

function parseDay(v: string | null, endOfDay: boolean): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:00`); // Pakistan time
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listAuditLogs(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 25, maxLimit: 50 });
  const action = sp.get("action")?.trim();
  const user = sp.get("user")?.trim();
  const entity = sp.get("entity")?.trim();
  const from = parseDay(sp.get("from"), false);
  const to = parseDay(sp.get("to"), true);

  const and: Prisma.AuditLogWhereInput[] = [];
  if (action) and.push({ action });
  if (entity) and.push({ entity });
  if (user) {
    and.push(
      user === "system"
        ? { userId: null }
        : {
            user: {
              OR: [
                { fullName: { contains: user, mode: "insensitive" } },
                { email: { contains: user, mode: "insensitive" } },
                { phone: { contains: user } },
              ],
            },
          }
    );
  }
  if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  const where: Prisma.AuditLogWhereInput = { AND: and };

  const wantActions = sp.get("actions") === "1";
  const [total, items, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    wantActions
      ? prisma.auditLog.groupBy({
          by: ["action"],
          _count: { _all: true },
          orderBy: { action: "asc" },
        })
      : Promise.resolve(null),
  ]);
  return apiSuccess({
    items,
    pagination: paginationMeta(page, limit, total),
    ...(actions ? { actions: actions.map((a) => ({ action: a.action, count: a._count._all })) } : {}),
  });
}
