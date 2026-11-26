/**
 * Admin side of item-list bidding (W15, test cases I-01 … I-05, G-14, G-15):
 * the on/off switch and its numbers, an overview of every list, one list's full
 * history (broadcasts, offers, accept), the "Needs rider" queue of after-packing
 * requests nobody bid on, and the bidding history shown on an admin order page.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getListSettings, type ListSettings } from "@/lib/lists/settings";
import { ListError, notifyBiddingStores } from "@/lib/lists/service";
import { sendNotification } from "@/lib/notifications/service";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Settings ────────────────────────────────────────────────────────────────

export const listSettingsSchema = z
  .object({
    enabled: z.boolean(),
    radiusStartKm: z.coerce.number().int("Whole kilometres only").min(1, "At least 1 km").max(50, "At most 50 km"),
    radiusMaxKm: z.coerce.number().int("Whole kilometres only").min(1, "At least 1 km").max(100, "At most 100 km"),
    radiusStepKm: z.coerce.number().int("Whole kilometres only").min(1, "At least 1 km").max(50, "At most 50 km"),
    radiusStepMins: z.coerce.number().int("Whole minutes only").min(5, "At least 5 minutes").max(24 * 60, "At most 24 hours"),
    maxStores: z.coerce.number().int("Whole number only").min(1, "At least 1 store").max(100, "At most 100 stores"),
    expiryHours: z.coerce.number().int("Whole hours only").min(1, "At least 1 hour").max(168, "At most 7 days"),
    /** 0 = keep restarting until the customer accepts or cancels. Left out = unchanged (older clients). */
    maxRounds: z.coerce.number().int("Whole number only").min(0, "0 or more").max(100, "At most 100 rounds").optional(),
    postPackBidWindowSecs: z.coerce
      .number()
      .int("Whole seconds only")
      .min(30, "At least 30 seconds")
      .max(3600, "At most 1 hour"),
    postPackRiderRadiusKm: z.coerce.number().int("Whole kilometres only").min(1, "At least 1 km").max(50, "At most 50 km"),
  })
  .superRefine((v, ctx) => {
    if (v.radiusMaxKm < v.radiusStartKm) {
      ctx.addIssue({ code: "custom", path: ["radiusMaxKm"], message: "Must be at least the starting radius" });
    }
  });
export type ListSettingsInput = z.infer<typeof listSettingsSchema>;

/** Emails in LIST_BIDDING_BETA_EMAILS (shown to admins so they know who sees the feature while it's off). */
export function betaTesterEmails(): string[] {
  return (process.env.LIST_BIDDING_BETA_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function getListSettingsForAdmin(): Promise<ListSettings & { betaEmails: string[] }> {
  return { ...(await getListSettings()), betaEmails: betaTesterEmails() };
}

const COLUMN: Record<keyof ListSettingsInput, string> = {
  enabled: "listBiddingEnabled",
  radiusStartKm: "listRadiusStartKm",
  radiusMaxKm: "listRadiusMaxKm",
  radiusStepKm: "listRadiusStepKm",
  radiusStepMins: "listRadiusStepMins",
  maxStores: "listMaxStores",
  expiryHours: "listExpiryHours",
  maxRounds: "listMaxRounds",
  postPackBidWindowSecs: "postPackBidWindowSecs",
  postPackRiderRadiusKm: "postPackRiderRadiusKm",
};

/** Save the switch + numbers; audit log keeps old → new for each changed field. */
export async function saveListSettings(actor: { id: string }, input: ListSettingsInput) {
  const before = await getListSettings();
  const data = Object.fromEntries(
    (Object.keys(COLUMN) as (keyof ListSettingsInput)[]).map((k) => [COLUMN[k], input[k]])
  ) as Prisma.StoreSettingsUpdateInput;
  const existing = await prisma.storeSettings.findFirst({ select: { id: true } });
  const row = existing
    ? await prisma.storeSettings.update({ where: { id: existing.id }, data })
    : await prisma.storeSettings.create({ data: data as Prisma.StoreSettingsCreateInput });
  const changed = (Object.keys(COLUMN) as (keyof ListSettingsInput)[]).filter((k) => input[k] !== undefined && before[k] !== input[k]);
  if (changed.length) {
    await writeAuditLog({
      userId: actor.id,
      action: changed.includes("enabled")
        ? input.enabled
          ? "LIST_BIDDING_SWITCHED_ON"
          : "LIST_BIDDING_SWITCHED_OFF"
        : "LIST_BIDDING_SETTINGS_CHANGED",
      entity: "StoreSettings",
      entityId: row.id,
      previousValue: Object.fromEntries(changed.map((k) => [k, before[k]])),
      newValue: Object.fromEntries(changed.map((k) => [k, input[k]])),
    }).catch((e) => console.error("[admin-lists] audit", e));
  }
  return { ...(await getListSettingsForAdmin()), changed };
}

// ── Lists overview ──────────────────────────────────────────────────────────

export const LIST_STATUSES = ["BIDDING", "ACCEPTED", "CANCELLED", "NO_STORES", "EXPIRED"] as const;
export type AdminListStatusFilter = (typeof LIST_STATUSES)[number] | "ALL";

function area(snapshot: unknown): string | null {
  const a = snapshot as { area?: string } | null;
  return a?.area ?? null;
}

/** Every list, newest first, with offer counts and the order it became. */
export async function adminListsOverview(opts: { status: AdminListStatusFilter; q?: string | null; skip: number; take: number }) {
  const q = opts.q?.trim();
  const where: Prisma.ItemListWhereInput = {
    ...(opts.status !== "ALL" ? { status: opts.status } : {}),
    ...(q
      ? {
          OR: [
            { id: q },
            { order: { orderNumber: { contains: q, mode: "insensitive" } } },
            { customer: { fullName: { contains: q, mode: "insensitive" } } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows, counts] = await Promise.all([
    prisma.itemList.count({ where }),
    prisma.itemList.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      include: {
        customer: { select: { fullName: true } },
        order: { select: { orderNumber: true, orderStatus: true } },
        _count: { select: { lines: true, broadcasts: true } },
        bids: { select: { status: true, storeId: true, itemsTotal: true, discount: true, id: true, round: true, store: { select: { name: true } } } },
      },
    }),
    prisma.itemList.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    total,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
    items: rows.map((l) => {
      const live = l.bids.filter((b) => b.status !== "WITHDRAWN" && b.round === l.round);
      const won = l.bids.find((b) => b.id === l.acceptedBidId);
      return {
        id: l.id,
        status: l.status,
        city: l.city,
        area: area(l.addressSnapshot),
        customerName: l.customer.fullName,
        lineCount: l._count.lines,
        storesSent: l._count.broadcasts,
        offersCount: live.length,
        radiusKm: l.radiusKm,
        version: l.version,
        createdAt: l.createdAt,
        expiresAt: l.expiresAt,
        round: l.round,
        roundEndsAt: l.expiresAt,
        acceptedStore: won ? won.store.name : null,
        acceptedTotal: won ? round2(Number(won.itemsTotal) - Number(won.discount)) : null,
        order: l.order ? { orderNumber: l.order.orderNumber, orderStatus: l.order.orderStatus } : null,
      };
    }),
  };
}

/** One list's full record for admins (I-01): every broadcast, every offer with its lines, audit history. */
export async function adminListDetail(listId: string) {
  const list = await prisma.itemList.findUnique({
    where: { id: listId },
    include: {
      customer: { select: { fullName: true, email: true, phone: true } },
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { category: { select: { name: true } } } },
      broadcasts: { orderBy: { sentAt: "asc" }, include: { store: { select: { id: true, name: true, area: true } } } },
      bids: {
        orderBy: [{ round: "asc" }, { createdAt: "asc" }],
        include: { store: { select: { id: true, name: true } }, lines: true },
      },
      order: { select: { id: true, orderNumber: true, orderStatus: true, createdAt: true } },
    },
  });
  if (!list) throw new ListError("NOT_FOUND", "List not found.", 404);
  const bidIds = list.bids.map((b) => b.id);
  const history = await prisma.auditLog.findMany({
    where: {
      OR: [{ entity: "ItemList", entityId: list.id }, ...(bidIds.length ? [{ entity: "StoreBid", entityId: { in: bidIds } }] : [])],
    },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  const storeOfBid = new Map(list.bids.map((b) => [b.id, b.store.name]));
  return {
    id: list.id,
    status: list.status,
    city: list.city,
    area: area(list.addressSnapshot),
    note: list.note,
    radiusKm: list.radiusKm,
    version: list.version,
    createdAt: list.createdAt,
    expiresAt: list.expiresAt,
    round: list.round,
    roundEndsAt: list.expiresAt,
    roundStartedAt: list.roundStartedAt ?? list.createdAt,
    cancelledAt: list.cancelledAt,
    customer: list.customer,
    lines: list.lines.map((l) => ({
      id: l.id,
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      category: l.category?.name ?? null,
      note: l.note,
    })),
    broadcasts: list.broadcasts.map((b) => ({
      storeId: b.storeId,
      storeName: b.store.name,
      storeArea: b.store.area,
      radiusKm: b.radiusKm,
      distanceKm: b.distanceKm == null ? null : Number(b.distanceKm),
      sentAt: b.sentAt,
      seenAt: b.seenAt,
      declinedAt: b.declinedAt,
      round: b.round,
    })),
    bids: list.bids.map((b) => ({
      id: b.id,
      storeId: b.storeId,
      storeName: b.store.name,
      status: b.status,
      accepted: b.id === list.acceptedBidId,
      itemsTotal: Number(b.itemsTotal),
      discount: Number(b.discount),
      total: round2(Number(b.itemsTotal) - Number(b.discount)),
      coveredCount: b.coveredCount,
      prepMinutes: b.prepMinutes,
      note: b.note,
      listVersion: b.listVersion,
      round: b.round,
      outdated: b.status === "PENDING" && b.listVersion < list.version,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      lines: b.lines.map((x) => ({ lineId: x.lineId, available: x.available, unitPrice: x.unitPrice == null ? null : Number(x.unitPrice) })),
    })),
    order: list.order,
    history: history.map((h) => ({
      at: h.createdAt,
      action: h.action,
      by: h.user?.fullName || (h.userId ? "Staff" : "System"),
      store: h.entity === "StoreBid" ? storeOfBid.get(h.entityId ?? "") ?? null : null,
      detail: h.newValue ?? null,
    })),
  };
}

// ── Admin cancel (I-03) ─────────────────────────────────────────────────────

export const adminListActionSchema = z.object({
  action: z.literal("CANCEL", { error: "Unknown action" }),
  reason: z
    .string({ error: "Please give a reason" })
    .trim()
    .min(5, "Please give a reason (at least 5 characters)")
    .max(500, "At most 500 characters"),
});
export type AdminListActionInput = z.infer<typeof adminListActionSchema>;

/** Statuses an admin may cancel from. Once ACCEPTED it's an order (cancel the order instead). */
const ADMIN_CANCELLABLE = ["BIDDING", "NO_STORES"] as const;

/**
 * Admin cancels a list that's still open (BIDDING or NO_STORES): CANCELLED,
 * pending offers closed as NOT_SELECTED, customer and bidding stores notified,
 * audit log with the reason.
 */
export async function adminCancelList(
  actor: { id: string },
  listId: string,
  reason: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
) {
  const { list, bidStoreIds, previousStatus } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ItemList" WHERE id = ${listId} FOR UPDATE`;
    const row = await tx.itemList.findUnique({
      where: { id: listId },
      select: { id: true, status: true, customerId: true, bids: { where: { status: "PENDING" }, select: { storeId: true } } },
    });
    if (!row) throw new ListError("NOT_FOUND", "List not found.", 404);
    if (row.status === "ACCEPTED") {
      throw new ListError("ORDER_PLACED", "The customer already accepted an offer. Cancel the order instead.", 409);
    }
    if (!(ADMIN_CANCELLABLE as readonly string[]).includes(row.status)) {
      throw new ListError("LIST_CLOSED", "This list is already closed.", 409);
    }
    await tx.storeBid.updateMany({ where: { listId, status: "PENDING" }, data: { status: "NOT_SELECTED" } });
    await tx.itemList.update({ where: { id: listId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return { list: row, bidStoreIds: row.bids.map((b) => b.storeId), previousStatus: row.status };
  });

  await writeAuditLog({
    userId: actor.id,
    action: "LIST_CANCELLED_BY_ADMIN",
    entity: "ItemList",
    entityId: listId,
    previousValue: { status: previousStatus },
    newValue: { status: "CANCELLED", reason, offersClosed: bidStoreIds.length },
    ...meta,
  }).catch((e) => console.error("[admin-lists] audit", e));

  await sendNotification({
    userId: list.customerId,
    type: "LIST_CANCELLED",
    title: "Your list was cancelled",
    body: `MandiBazaar cancelled your list. Reason: ${reason}`,
    metadata: { listId, byAdmin: true },
  }).catch((e) => console.error("[admin-lists] notify customer", e));
  await notifyBiddingStores(
    bidStoreIds,
    listId,
    "LIST_CANCELLED",
    "A list was cancelled",
    "The list you made an offer on was cancelled by MandiBazaar."
  );

  return adminListDetail(listId);
}

// ── Needs rider queue (G-14 → G-15) ─────────────────────────────────────────

/**
 * After-packing requests that got no rider bid (status NO_BIDS) on orders still
 * waiting for a rider, plus requests still open right now (for context).
 */
export async function adminNeedsRiderQueue() {
  const rows = await prisma.deliveryRequest.findMany({
    where: {
      trigger: "POST_PACK",
      status: { in: ["NO_BIDS", "OPEN"] },
      order: { orderStatus: "READY_FOR_DISPATCH", riderId: null },
    },
    orderBy: [{ updatedAt: "asc" }],
    take: 100,
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderStatus: true,
          grandTotal: true,
          deliveryAddressSnapshot: true,
          createdAt: true,
          customer: { select: { fullName: true } },
        },
      },
      bids: { where: { status: "PENDING" }, select: { id: true, amount: true } },
    },
  });
  const now = Date.now();
  const items = rows.map((r) => {
    const s = (r.summary ?? {}) as { storeName?: string; pickup?: string[]; distanceKm?: number; itemCount?: number };
    const drop = (r.order?.deliveryAddressSnapshot ?? {}) as { area?: string; city?: string };
    return {
      requestId: r.id,
      status: r.status,
      needsRider: r.status === "NO_BIDS",
      reopenCount: r.reopenCount,
      expiresAt: r.expiresAt,
      biddingOpen: r.status === "OPEN" && r.expiresAt.getTime() > now,
      pendingBids: r.bids.length,
      lowestBid: r.bids.length ? Math.min(...r.bids.map((b) => Number(b.amount))) : null,
      since: r.updatedAt,
      storeName: s.storeName ?? null,
      pickup: (s.pickup ?? []).join(", ") || null,
      drop: [drop.area, drop.city].filter(Boolean).join(", ") || null,
      distanceKm: s.distanceKm ?? null,
      itemCount: s.itemCount ?? null,
      order: r.order
        ? {
            id: r.order.id,
            orderNumber: r.order.orderNumber,
            orderStatus: r.order.orderStatus,
            grandTotal: Number(r.order.grandTotal),
            customerName: r.order.customer.fullName,
          }
        : null,
    };
  });
  return {
    needsRider: items.filter((i) => i.needsRider),
    bidding: items.filter((i) => !i.needsRider),
  };
}

/** Count for the admin nav badge. */
export async function needsRiderCount(): Promise<number> {
  return prisma.deliveryRequest.count({
    where: { trigger: "POST_PACK", status: "NO_BIDS", order: { orderStatus: "READY_FOR_DISPATCH", riderId: null } },
  });
}

// ── Admin order page: list + store offers + rider bids (I-02) ───────────────

export async function adminOrderBiddingHistory(orderId: string) {
  const [list, request] = await Promise.all([
    prisma.itemList.findUnique({
      where: { orderId },
      select: {
        id: true,
        status: true,
        acceptedBidId: true,
        createdAt: true,
        _count: { select: { broadcasts: true } },
        bids: {
          select: { id: true, status: true, itemsTotal: true, discount: true, coveredCount: true, updatedAt: true, store: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.deliveryRequest.findUnique({
      where: { orderId },
      include: {
        bids: { orderBy: [{ amount: "asc" }, { createdAt: "asc" }], include: { rider: { select: { id: true, name: true, phone: true } } } },
      },
    }),
  ]);
  if (!list && !request) return null;
  const acceptedAt = list
    ? (
        await prisma.auditLog.findFirst({
          where: { entity: "ItemList", entityId: list.id, action: { contains: "ACCEPT" } },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      )?.createdAt ?? null
    : null;
  return {
    list: list
      ? {
          id: list.id,
          status: list.status,
          createdAt: list.createdAt,
          acceptedAt,
          storesSent: list._count.broadcasts,
          offers: list.bids.map((b) => ({
            id: b.id,
            storeName: b.store.name,
            status: b.status,
            accepted: b.id === list.acceptedBidId,
            total: round2(Number(b.itemsTotal) - Number(b.discount)),
            coveredCount: b.coveredCount,
            updatedAt: b.updatedAt,
          })),
        }
      : null,
    riderBidding: request
      ? {
          requestId: request.id,
          trigger: request.trigger,
          status: request.status,
          reopenCount: request.reopenCount,
          expiresAt: request.expiresAt,
          createdAt: request.createdAt,
          acceptedFee: request.acceptedFee == null ? null : Number(request.acceptedFee),
          bids: request.bids.map((b) => ({
            id: b.id,
            riderName: b.rider.name,
            riderPhone: b.rider.phone,
            amount: Number(b.amount),
            status: b.status,
            won: b.id === request.acceptedBidId,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
          })),
        }
      : null,
  };
}
