/**
 * Store side of item-list bidding (test cases D-01 … D-17): see the lists sent
 * to your store, make or update an offer, withdraw it, or say you can't supply.
 *
 * Stores only see lists that were sent to them, never the customer's name,
 * phone or house number, and never another store's prices.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/password-check";
import { sendNotification } from "@/lib/notifications/service";
import { tickList } from "@/lib/lists/broadcast";
import { ListError } from "@/lib/lists/service";
import { formatCurrency } from "@/lib/utils";

export const MAX_UNIT_PRICE = 1_000_000;

export const bidSchema = z.object({
  storeId: z.string().min(1).max(40).optional(),
  /** The list version the store was looking at; refused with LIST_CHANGED if the customer edited it since. */
  listVersion: z.coerce.number().int().min(1).optional().nullable(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1).max(40),
        available: z.boolean(),
        unitPrice: z.coerce.number().optional().nullable(),
      })
    )
    .min(1, "Answer every item on the list")
    .max(100),
  discount: z.coerce.number().min(0, "Discount can't be negative").max(MAX_UNIT_PRICE).optional().default(0),
  prepMinutes: z.coerce
    .number()
    .int("Preparation time must be whole minutes")
    .min(5, "Preparation time must be at least 5 minutes")
    .max(24 * 60, "Preparation time must be under 24 hours")
    .optional()
    .nullable(),
  note: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(300, "Note must be 300 characters or fewer"))
    .optional()
    .nullable(),
});
export type BidInput = z.infer<typeof bidSchema>;

type Actor = { id: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Line order shared by the detail endpoint and bid validation, so `lines.N.*` errors match what the store sees. */
const LINE_ORDER: Prisma.ItemListLineOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { id: "asc" }];

type ListOrderRef = { acceptedBidId: string | null; order: { id: string; orderNumber: string } | null };

/** The order created from this bid — only when this store's bid won. */
function wonOrder(bid: { id: string; status: string } | null, list: ListOrderRef) {
  if (!bid || bid.status !== "ACCEPTED" || list.acceptedBidId !== bid.id || !list.order) return null;
  return { orderId: list.order.id, orderNumber: list.order.orderNumber };
}

/** Store ids this user may bid for: owner, or an active OWNER/MANAGER member of an approved store (D-14). */
export async function biddableStoreIds(userId: string): Promise<string[]> {
  const [owned, managed] = await Promise.all([
    prisma.store.findMany({ where: { ownerId: userId, status: "APPROVED" }, select: { id: true } }),
    prisma.storeMember.findMany({
      where: { userId, isActive: true, role: { in: ["OWNER", "MANAGER"] }, store: { status: "APPROVED" } },
      select: { storeId: true },
    }),
  ]);
  return Array.from(new Set([...owned.map((s) => s.id), ...managed.map((m) => m.storeId)]));
}

/** Pick the store acting on this list: the one asked for, or the user's only store that got the list. */
async function resolveStore(actor: Actor, listId: string, storeId?: string | null): Promise<string> {
  const mine = await biddableStoreIds(actor.id);
  if (!mine.length) throw new ListError("NO_STORE", "Only approved store owners and managers can make offers.", 403);
  if (storeId) {
    if (!mine.includes(storeId)) throw new ListError("NOT_YOUR_STORE", "You can't act for that store.", 403);
    return storeId;
  }
  const sent = await prisma.listBroadcast.findMany({
    where: { listId, storeId: { in: mine } },
    select: { storeId: true },
  });
  if (sent.length === 1) return sent[0].storeId;
  if (sent.length === 0) throw new ListError("NOT_FOUND", "List not found.", 404);
  throw new ListError("STORE_REQUIRED", "Choose which of your stores this offer is for.", 400, "storeId");
}

function publicArea(snapshot: unknown, city: string) {
  const a = snapshot as { area?: string; nearbyLandmark?: string } | null;
  return { area: a?.area ?? null, city };
}

function serializeBid(
  bid: Prisma.StoreBidGetPayload<{ include: { lines: true } }> | null,
  listVersion: number,
  won: { orderId: string; orderNumber: string } | null = null
) {
  if (!bid) return null;
  return {
    id: bid.id,
    ...(won ? { orderId: won.orderId, orderNumber: won.orderNumber } : {}),
    status: bid.status,
    itemsTotal: Number(bid.itemsTotal),
    discount: Number(bid.discount),
    total: round2(Number(bid.itemsTotal) - Number(bid.discount)),
    prepMinutes: bid.prepMinutes,
    note: bid.note,
    coveredCount: bid.coveredCount,
    needsUpdate: bid.status === "PENDING" && bid.listVersion < listVersion,
    updatedAt: bid.updatedAt,
    lines: bid.lines.map((l) => ({ lineId: l.lineId, available: l.available, unitPrice: l.unitPrice == null ? null : Number(l.unitPrice) })),
  };
}

/** Lists sent to the user's stores, newest first. filter: open (still bidding) | all. */
export async function listsForStore(actor: Actor, opts: { storeId?: string | null; filter?: "open" | "all"; skip: number; take: number }) {
  const mine = await biddableStoreIds(actor.id);
  const storeIds = opts.storeId ? mine.filter((s) => s === opts.storeId) : mine;
  if (!storeIds.length) return { total: 0, items: [] };
  const where: Prisma.ListBroadcastWhereInput = {
    storeId: { in: storeIds },
    ...(opts.filter === "all" ? {} : { list: { status: "BIDDING", expiresAt: { gt: new Date() } } }),
  };
  const [total, rows] = await Promise.all([
    prisma.listBroadcast.count({ where }),
    prisma.listBroadcast.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      include: {
        list: {
          include: {
            _count: { select: { lines: true } },
            bids: { where: { storeId: { in: storeIds } }, include: { lines: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((b) => {
      const bid = b.list.bids.find((x) => x.storeId === b.storeId) ?? null;
      return {
        listId: b.listId,
        storeId: b.storeId,
        status: b.list.status,
        ...publicArea(b.list.addressSnapshot, b.list.city),
        distanceKm: b.distanceKm == null ? null : Number(b.distanceKm),
        lineCount: b.list._count.lines,
        expiresAt: b.list.expiresAt,
        sentAt: b.sentAt,
        seen: !!b.seenAt,
        declined: !!b.declinedAt,
        myBid: serializeBid(bid, b.list.version, wonOrder(bid, b.list)),
      };
    }),
  };
}

/** One list as a store sees it (marks it seen). */
export async function listForStore(actor: Actor, listId: string, storeIdParam?: string | null) {
  const storeId = await resolveStore(actor, listId, storeIdParam);
  const broadcast = await prisma.listBroadcast.findUnique({ where: { listId_storeId: { listId, storeId } } });
  if (!broadcast) throw new ListError("NOT_FOUND", "List not found.", 404);
  await tickList(listId).catch((e) => console.error("[store-bids] tick", e));
  if (!broadcast.seenAt) {
    await prisma.listBroadcast.update({ where: { id: broadcast.id }, data: { seenAt: new Date() } });
  }
  const list = await prisma.itemList.findUniqueOrThrow({
    where: { id: listId },
    include: {
      lines: { orderBy: LINE_ORDER, include: { category: { select: { name: true } } } },
      bids: { where: { storeId }, include: { lines: true } },
      order: { select: { id: true, orderNumber: true } },
    },
  });
  return {
    listId: list.id,
    storeId,
    status: list.status,
    version: list.version,
    ...publicArea(list.addressSnapshot, list.city),
    distanceKm: broadcast.distanceKm == null ? null : Number(broadcast.distanceKm),
    note: list.note,
    expiresAt: list.expiresAt,
    declined: !!broadcast.declinedAt,
    lines: list.lines.map((l) => ({
      id: l.id,
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      category: l.category?.name ?? null,
      note: l.note,
    })),
    myBid: serializeBid(list.bids[0] ?? null, list.version, wonOrder(list.bids[0] ?? null, list)),
  };
}

/** Lock the list and check it's still open for offers from this store. */
async function lockForStore(tx: Prisma.TransactionClient, listId: string, storeId: string) {
  await tx.$queryRaw`SELECT id FROM "ItemList" WHERE id = ${listId} FOR UPDATE`;
  const list = await tx.itemList.findUnique({
    where: { id: listId },
    include: { lines: { orderBy: LINE_ORDER }, broadcasts: { where: { storeId } } },
  });
  if (!list || !list.broadcasts.length) throw new ListError("NOT_FOUND", "List not found.", 404);
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { status: true } });
  if (store?.status !== "APPROVED") throw new ListError("STORE_NOT_ACTIVE", "Your store can't make offers right now.", 403);
  if (list.status !== "BIDDING" || list.expiresAt.getTime() <= Date.now()) {
    throw new ListError("LIST_CLOSED", "This list is closed — the customer already chose or cancelled it.", 409);
  }
  return list;
}

/** Make or update this store's offer (D-03 … D-11, D-15, D-17). */
export async function submitBid(actor: Actor, listId: string, input: BidInput, meta: RequestMeta = {}) {
  const storeId = await resolveStore(actor, listId, input.storeId);

  const { bid, created, customerId, version } = await prisma.$transaction(async (tx) => {
    const list = await lockForStore(tx, listId, storeId);
    if (input.listVersion != null && input.listVersion !== list.version) {
      throw new ListError("LIST_CHANGED", "The list has changed. Reload it and answer every item.", 409);
    }

    // Every current line answered exactly once.
    const byId = new Map(input.lines.map((l) => [l.lineId, l]));
    if (byId.size !== input.lines.length || list.lines.some((l) => !byId.has(l.id)) || byId.size !== list.lines.length) {
      throw new ListError("LIST_CHANGED", "The list has changed. Reload it and answer every item.", 409);
    }

    let itemsTotal = 0;
    let covered = 0;
    for (const [i, l] of Array.from(list.lines.entries())) {
      const a = byId.get(l.id)!;
      if (!a.available) continue;
      const price = a.unitPrice;
      if (price == null || !Number.isFinite(price) || price <= 0) {
        throw new ListError("BAD_PRICE", `Enter a price for ${l.name}.`, 400, `lines.${i}.unitPrice`);
      }
      if (price > MAX_UNIT_PRICE) throw new ListError("BAD_PRICE", `The price for ${l.name} is too high.`, 400, `lines.${i}.unitPrice`);
      itemsTotal += round2(price) * Number(l.quantity);
      covered++;
    }
    itemsTotal = round2(itemsTotal);
    if (covered === 0) {
      throw new ListError("NOTHING_AVAILABLE", "You don't have any of these items — use \"Can't supply\" instead.", 400);
    }
    const discount = round2(input.discount ?? 0);
    if (discount >= itemsTotal) {
      throw new ListError("BAD_DISCOUNT", "The discount must be less than the total.", 400, "discount");
    }

    const existing = await tx.storeBid.findUnique({ where: { listId_storeId: { listId, storeId } } });
    const data = {
      status: "PENDING" as const,
      itemsTotal,
      discount,
      prepMinutes: input.prepMinutes ?? null,
      note: input.note || null,
      coveredCount: covered,
      listVersion: list.version,
    };
    const bid = existing
      ? await tx.storeBid.update({ where: { id: existing.id }, data })
      : await tx.storeBid.create({ data: { listId, storeId, ...data } });
    await tx.storeBidLine.deleteMany({ where: { bidId: bid.id } });
    await tx.storeBidLine.createMany({
      data: list.lines.map((l) => {
        const a = byId.get(l.id)!;
        return { bidId: bid.id, lineId: l.id, available: a.available, unitPrice: a.available ? round2(a.unitPrice!) : null };
      }),
    });
    // Offering after "can't supply" undoes the decline.
    await tx.listBroadcast.update({ where: { listId_storeId: { listId, storeId } }, data: { declinedAt: null } });
    return { bid, created: !existing || existing.status !== "PENDING", customerId: list.customerId, version: list.version };
  });

  await writeAuditLog({
    userId: actor.id,
    action: created ? "STORE_BID_SUBMITTED" : "STORE_BID_UPDATED",
    entity: "StoreBid",
    entityId: bid.id,
    newValue: { listId, storeId, itemsTotal: Number(bid.itemsTotal), discount: Number(bid.discount), covered: bid.coveredCount },
    ...meta,
  }).catch((e) => console.error("[store-bids] audit", e));

  const total = round2(Number(bid.itemsTotal) - Number(bid.discount));
  await sendNotification({
    userId: customerId,
    type: created ? "NEW_OFFER" : "OFFER_UPDATED",
    title: created ? "New offer on your list" : "An offer on your list was updated",
    body: `A store offers ${bid.coveredCount} item${bid.coveredCount === 1 ? "" : "s"} for ${formatCurrency(total)}.`,
    metadata: { listId },
  }).catch(() => {});

  const full = await prisma.storeBid.findUniqueOrThrow({ where: { id: bid.id }, include: { lines: true } });
  return serializeBid(full, version)!;
}

/** Take back a pending offer (D-13). */
export async function withdrawBid(actor: Actor, listId: string, storeIdParam?: string | null, meta: RequestMeta = {}) {
  const storeId = await resolveStore(actor, listId, storeIdParam);
  const bid = await prisma.$transaction(async (tx) => {
    await lockForStore(tx, listId, storeId);
    const bid = await tx.storeBid.findUnique({ where: { listId_storeId: { listId, storeId } } });
    if (!bid || bid.status !== "PENDING") throw new ListError("NO_OFFER", "You have no open offer on this list.", 409);
    return tx.storeBid.update({ where: { id: bid.id }, data: { status: "WITHDRAWN" } });
  });
  await writeAuditLog({ userId: actor.id, action: "STORE_BID_WITHDRAWN", entity: "StoreBid", entityId: bid.id, newValue: { listId, storeId }, ...meta }).catch(() => {});
  return { withdrawn: true };
}

/** "Can't supply" (D-12): the customer never sees it; if everyone declines, the list widens right away (C-07). */
export async function declineList(actor: Actor, listId: string, storeIdParam?: string | null, meta: RequestMeta = {}) {
  const storeId = await resolveStore(actor, listId, storeIdParam);
  await prisma.$transaction(async (tx) => {
    await lockForStore(tx, listId, storeId);
    const bid = await tx.storeBid.findUnique({ where: { listId_storeId: { listId, storeId } } });
    if (bid?.status === "PENDING") {
      throw new ListError("HAS_OFFER", "You have an open offer on this list. Withdraw it first.", 409);
    }
    await tx.listBroadcast.update({ where: { listId_storeId: { listId, storeId } }, data: { declinedAt: new Date() } });
  });
  await writeAuditLog({ userId: actor.id, action: "STORE_LIST_DECLINED", entity: "ItemList", entityId: listId, newValue: { storeId }, ...meta }).catch(() => {});
  await tickList(listId).catch((e) => console.error("[store-bids] tick", e));
  return { declined: true };
}
