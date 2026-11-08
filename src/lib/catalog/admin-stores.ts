/**
 * MandiBazaar → Stores (QA P4 / N7 / P13 / P14 / Q6 / R6). Called from the GET
 * and PATCH handlers in `src/app/api/stores/route.ts`.
 */
import { Prisma, StoreStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiFieldErrors, apiSuccess, paginationMeta, parsePagination, toNumber } from "@/lib/utils";
import { normalizePkMobile } from "@/lib/validators/pk";
import { phoneLookupVariants } from "@/lib/admin/form-rules";
import { storeApprovalErrorMessage, storeApprovalGaps } from "@/lib/catalog/store-approval";
import { notifyStoreOwner } from "@/lib/catalog/notify-owner";

const STATUSES: StoreStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];
const OPEN_ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
] as const;

/** Every store as {id,name,status} for pickers (MandiBazaar: all statuses; others: approved). */
export async function storeOptions(isSuper: boolean) {
  const items = await prisma.store.findMany({
    where: isSuper ? {} : { status: "APPROVED" },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
    take: 5000,
  });
  return apiSuccess({ items });
}

/** What suspending a store affects: open orders and unpaid payouts. */
export async function storeImpact(storeId: string) {
  const [openOrders, payouts] = await Promise.all([
    prisma.order.count({
      where: {
        orderStatus: { in: [...OPEN_ORDER_STATUSES] },
        OR: [{ fulfillments: { some: { storeId } } }, { items: { some: { storeId } } }],
      },
    }),
    prisma.payout.aggregate({
      where: { storeId, status: { in: ["PENDING", "PROCESSING"] } },
      _sum: { netAmount: true },
      _count: { _all: true },
    }),
  ]);
  return apiSuccess({
    openOrders,
    pendingPayoutCount: payouts._count._all,
    pendingPayoutAmount: toNumber(payouts._sum.netAmount),
  });
}

/** Paginated MandiBazaar list with search (store name, owner name, phone, city). */
export async function listStoresForSuperAdmin(sp: URLSearchParams) {
  const { page, limit, skip, take } = parsePagination(sp, { defaultLimit: 20, maxLimit: 50 });
  const statusRaw = sp.get("status");
  const status = statusRaw && (STATUSES as string[]).includes(statusRaw) ? (statusRaw as StoreStatus) : null;
  const q = sp.get("q")?.trim();

  const and: Prisma.StoreWhereInput[] = [];
  if (status) and.push({ status });
  if (q) {
    const phones = normalizePkMobile(q) ? phoneLookupVariants(q) : [];
    const digits = q.replace(/[\s-]/g, "");
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { owner: { fullName: { contains: q, mode: "insensitive" } } },
        { owner: { email: { contains: q, mode: "insensitive" } } },
        { owner: { phone: { contains: digits } } },
        { phone: { contains: digits } },
        ...(phones.length ? [{ owner: { phone: { in: phones } } }, { phone: { in: phones } }] : []),
      ],
    });
  }
  const where: Prisma.StoreWhereInput = { AND: and };

  const [total, items, grouped] = await Promise.all([
    prisma.store.count({ where }),
    prisma.store.findMany({
      where,
      include: {
        owner: { select: { id: true, fullName: true, phone: true, email: true } },
        documents: true,
        _count: { select: { products: true } },
      },
      orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
      skip,
      take,
    }),
    prisma.store.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return apiSuccess({
    items: items.map((s) => ({
      ...s,
      commissionOverride: s.commissionOverride != null ? toNumber(s.commissionOverride) : null,
      approvalGaps: storeApprovalGaps(s),
    })),
    pagination: paginationMeta(page, limit, total),
    counts,
  });
}

type StoreRow = NonNullable<Awaited<ReturnType<typeof prisma.store.findUnique>>>;

const REASON_MIN = 5;

function readReason(body: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 500);
  }
  return "";
}

/**
 * PATCH actions: APPROVE / REJECT / SUSPEND / REACTIVATE. Returns null for
 * other actions so the route keeps handling them.
 */
export async function handleStoreDecision(
  actor: { id: string },
  store: StoreRow,
  action: string,
  body: Record<string, unknown>,
  approve: (store: StoreRow) => Promise<Record<string, unknown>>
): Promise<Response | null> {
  if (!["APPROVE", "REJECT", "SUSPEND", "REACTIVATE"].includes(action)) return null;

  if (action === "APPROVE" || action === "REACTIVATE") {
    if (action === "APPROVE" && store.status !== "PENDING" && store.status !== "REJECTED") {
      return apiError(`Only pending stores can be approved (this store is ${store.status.toLowerCase()})`, 400);
    }
    if (action === "REACTIVATE" && store.status !== "SUSPENDED") {
      return apiError("Only suspended stores can be reactivated", 400);
    }
    const gaps = storeApprovalGaps(store);
    if (gaps.length) {
      return Response.json(
        { success: false, error: storeApprovalErrorMessage(gaps), code: "STORE_INCOMPLETE", missing: gaps },
        { status: 400 }
      );
    }
    let extra: Record<string, unknown> = {};
    if (action === "APPROVE") extra = await approve(store);
    const updated = await prisma.store.update({
      where: { id: store.id },
      data: {
        status: "APPROVED",
        reviewedById: actor.id,
        ...(action === "APPROVE"
          ? { approvedAt: new Date(), rejectionReason: null }
          : { suspendedAt: null, suspensionReason: null }),
      },
    });
    await writeAuditLog({
      userId: actor.id,
      action: action === "APPROVE" ? "STORE_APPROVED" : "STORE_REACTIVATED",
      entity: "Store",
      entityId: store.id,
      previousValue: { status: store.status, suspensionReason: store.suspensionReason ?? undefined },
      newValue: { status: "APPROVED", ...extra },
    });
    await notifyStoreOwner({
      storeId: store.id,
      type: action === "APPROVE" ? "STORE_APPROVED" : "STORE_REACTIVATED",
      title: action === "APPROVE" ? "Your store is approved" : "Your store is active again",
      body:
        action === "APPROVE"
          ? `${store.name} is approved on MandiBazaar. You can start selling now.`
          : `${store.name} has been reactivated. Your approved products are visible in the shop again.`,
      sms: true,
    });
    return apiSuccess({ ...updated, ...extra });
  }

  const reason = readReason(body, action === "REJECT" ? "rejectionReason" : "suspensionReason", "reason");
  if (reason.length < REASON_MIN) {
    const field = action === "REJECT" ? "rejectionReason" : "suspensionReason";
    return apiFieldErrors({ [field]: `Give a reason of at least ${REASON_MIN} characters (the store owner will see it)` });
  }

  if (action === "REJECT") {
    if (store.status !== "PENDING") return apiError("Only pending stores can be rejected", 400);
    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { status: "REJECTED", rejectionReason: reason, reviewedById: actor.id },
    });
    await writeAuditLog({
      userId: actor.id,
      action: "STORE_REJECTED",
      entity: "Store",
      entityId: store.id,
      previousValue: { status: store.status },
      newValue: { status: "REJECTED", rejectionReason: reason },
    });
    await notifyStoreOwner({
      storeId: store.id,
      type: "STORE_REJECTED",
      title: "Store application not approved",
      body: `${store.name} was not approved. Reason: ${reason}`,
      sms: true,
    });
    return apiSuccess(updated);
  }

  // SUSPEND
  if (store.status !== "APPROVED") return apiError("Only approved stores can be suspended", 400);
  const updated = await prisma.store.update({
    where: { id: store.id },
    data: { status: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason, reviewedById: actor.id },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "STORE_SUSPENDED",
    entity: "Store",
    entityId: store.id,
    previousValue: { status: store.status },
    newValue: { status: "SUSPENDED", suspensionReason: reason },
  });
  await notifyStoreOwner({
    storeId: store.id,
    type: "STORE_SUSPENDED",
    title: "Your store is suspended",
    body: `${store.name} is suspended and its products are hidden from the shop. Reason: ${reason}`,
    sms: true,
  });
  return apiSuccess(updated);
}
