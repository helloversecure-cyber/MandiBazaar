/**
 * Customer side of item-list bidding: create, view, edit and cancel a list.
 * Broadcast to stores and store bids live in their own modules (W5, W6).
 */
import type { ItemListStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/password-check";
import { sendNotification } from "@/lib/notifications/service";
import { getListSettings, listBiddingAllowedFor } from "@/lib/lists/settings";
import type { CreateListInput, ListLineInput, UpdateListInput } from "@/lib/lists/validation";
import { broadcastNewList, tickList } from "@/lib/lists/broadcast";

export const MAX_LISTS_PER_HOUR = 10;

export class ListError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public field?: string
  ) {
    super(message);
    this.name = "ListError";
  }
}

type Actor = { id: string; email?: string | null };

const listInclude = {
  lines: { orderBy: { sortOrder: "asc" } },
  order: { select: { orderNumber: true } },
  _count: { select: { bids: { where: { status: { in: ["PENDING", "ACCEPTED"] } } } } },
} satisfies Prisma.ItemListInclude;

type ListRow = Prisma.ItemListGetPayload<{ include: typeof listInclude }>;

export function serializeList(l: ListRow) {
  return {
    id: l.id,
    status: l.status,
    city: l.city,
    note: l.note,
    noPin: l.latitude == null || l.longitude == null,
    radiusKm: l.radiusKm,
    version: l.version,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    address: l.addressSnapshot,
    orderNumber: l.order?.orderNumber ?? null,
    offerCount: l._count.bids,
    lines: l.lines.map((x) => ({
      id: x.id,
      name: x.name,
      quantity: Number(x.quantity),
      unit: x.unit,
      categoryId: x.categoryId,
      productId: x.productId,
      note: x.note,
    })),
  };
}

export type SerializedList = ReturnType<typeof serializeList>;

/** Lazily close a list whose bidding window has passed. */
async function expireIfDue<T extends { id: string; status: ItemListStatus; expiresAt: Date }>(l: T): Promise<T> {
  if (l.status !== "BIDDING" || l.expiresAt.getTime() > Date.now()) return l;
  const r = await prisma.itemList.updateMany({ where: { id: l.id, status: "BIDDING" }, data: { status: "EXPIRED" } });
  if (r.count) {
    await prisma.storeBid.updateMany({ where: { listId: l.id, status: "PENDING" }, data: { status: "NOT_SELECTED" } });
  }
  return { ...l, status: "EXPIRED" };
}

async function assertCatalogRefs(lines: ListLineInput[]) {
  const catIds = Array.from(new Set(lines.map((l) => l.categoryId).filter((v): v is string => !!v)));
  if (catIds.length) {
    const n = await prisma.category.count({ where: { id: { in: catIds }, isActive: true } });
    if (n !== catIds.length) throw new ListError("BAD_CATEGORY", "One of the categories is not available.", 400);
  }
  const prodIds = Array.from(new Set(lines.map((l) => l.productId).filter((v): v is string => !!v)));
  if (prodIds.length) {
    const n = await prisma.product.count({ where: { id: { in: prodIds }, status: "ACTIVE" } });
    if (n !== prodIds.length) throw new ListError("BAD_PRODUCT", "One of the products is no longer available.", 400);
  }
}

const lineData = (l: ListLineInput, i: number) => ({
  name: l.name,
  quantity: l.quantity,
  unit: l.unit,
  categoryId: l.categoryId || null,
  productId: l.productId || null,
  note: l.note ?? null,
  sortOrder: i,
});

export async function assertListBiddingAllowed(actor: Actor) {
  if (!(await listBiddingAllowedFor(actor.email))) {
    throw new ListError("FEATURE_OFF", "Sending a list to stores isn't available yet.", 403);
  }
}

export async function createList(actor: Actor, input: CreateListInput, meta: RequestMeta = {}) {
  await assertListBiddingAllowed(actor);

  const recent = await prisma.itemList.count({
    where: { customerId: actor.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  if (recent >= MAX_LISTS_PER_HOUR) {
    throw new ListError("RATE_LIMITED", "You've sent a lot of lists in the last hour. Please try again later.", 429);
  }

  const addr = await prisma.address.findFirst({ where: { id: input.addressId, userId: actor.id } });
  if (!addr) throw new ListError("ADDRESS_NOT_FOUND", "Choose one of your saved addresses.", 404, "addressId");

  await assertCatalogRefs(input.lines);
  const settings = await getListSettings();

  const list = await prisma.itemList.create({
    data: {
      customerId: actor.id,
      status: "BIDDING",
      addressSnapshot: {
        label: addr.label,
        fullName: addr.fullName,
        phone: addr.phone,
        houseBuilding: addr.houseBuilding,
        street: addr.street,
        area: addr.area,
        city: addr.city,
        province: addr.province,
        postalCode: addr.postalCode,
        nearbyLandmark: addr.nearbyLandmark,
        deliveryInstructions: addr.deliveryInstructions,
        latitude: addr.latitude,
        longitude: addr.longitude,
      },
      latitude: addr.latitude,
      longitude: addr.longitude,
      city: addr.city,
      note: input.note ?? null,
      radiusKm: settings.radiusStartKm,
      expiresAt: new Date(Date.now() + settings.expiryHours * 3600_000),
      lines: { create: input.lines.map(lineData) },
    },
    include: listInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "LIST_CREATED",
    entity: "ItemList",
    entityId: list.id,
    newValue: { lines: list.lines.length, city: list.city, noPin: list.latitude == null },
    ...meta,
  }).catch((e) => console.error("[lists] audit", e));

  // Send it to the nearest matching stores now (may widen, or end as NO_STORES).
  await broadcastNewList(list.id);
  const fresh = await prisma.itemList.findUniqueOrThrow({ where: { id: list.id }, include: listInclude });
  return serializeList(fresh);
}

export async function getCustomerList(actor: Actor, id: string) {
  const owned = await prisma.itemList.findFirst({ where: { id, customerId: actor.id }, select: { id: true } });
  if (!owned) throw new ListError("NOT_FOUND", "List not found.", 404);
  // C-09: widen / expire on read when due (no always-on scheduler).
  await tickList(id).catch((e) => console.error("[lists] tick", e));
  const row = await prisma.itemList.findUniqueOrThrow({ where: { id }, include: listInclude });
  return serializeList(await expireIfDue(row));
}

export async function listCustomerLists(actor: Actor, opts: { skip: number; take: number }) {
  const where = { customerId: actor.id };
  const [total, rows] = await Promise.all([
    prisma.itemList.count({ where }),
    prisma.itemList.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, skip: opts.skip, take: opts.take }),
  ]);
  const items = await Promise.all(rows.map(async (r) => serializeList(await expireIfDue(r))));
  return { total, items };
}

/** Lock the list row and check it still belongs to the customer and is open for edits. */
async function lockOpenList(tx: Prisma.TransactionClient, actor: Actor, id: string) {
  await tx.$queryRaw`SELECT id FROM "ItemList" WHERE id = ${id} FOR UPDATE`;
  const list = await tx.itemList.findFirst({
    where: { id, customerId: actor.id },
    include: { lines: true, bids: { where: { status: "PENDING" }, select: { storeId: true } } },
  });
  if (!list) throw new ListError("NOT_FOUND", "List not found.", 404);
  if (list.status === "ACCEPTED") {
    throw new ListError("ORDER_PLACED", "This list is already an order and can't be changed.", 409);
  }
  if (list.status !== "BIDDING" || list.expiresAt.getTime() <= Date.now()) {
    throw new ListError("LIST_CLOSED", "This list is closed.", 409);
  }
  return list;
}

async function notifyBiddingStores(storeIds: string[], listId: string, type: string, title: string, body: string) {
  if (!storeIds.length) return;
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { ownerId: true } });
  await Promise.all(
    stores.map((s) =>
      sendNotification({ userId: s.ownerId, type, title, body, metadata: { listId } }).catch(() => {})
    )
  );
}

export async function updateList(actor: Actor, id: string, input: UpdateListInput, meta: RequestMeta = {}) {
  if (input.lines) await assertCatalogRefs(input.lines);

  const { updated, bidStoreIds, previous } = await prisma.$transaction(async (tx) => {
    const list = await lockOpenList(tx, actor, id);
    const previous = { lines: list.lines.length, version: list.version };

    if (input.lines) {
      const existing = new Set(list.lines.map((l) => l.id));
      const unknown = input.lines.find((l) => l.id && !existing.has(l.id));
      if (unknown) throw new ListError("BAD_LINE", "One of the items doesn't belong to this list.", 400);
      const keep = new Set(input.lines.map((l) => l.id).filter(Boolean) as string[]);
      await tx.itemListLine.deleteMany({ where: { listId: id, id: { notIn: Array.from(keep) } } });
      for (const [i, l] of Array.from(input.lines.entries())) {
        if (l.id) await tx.itemListLine.update({ where: { id: l.id }, data: lineData(l, i) });
        else await tx.itemListLine.create({ data: { listId: id, ...lineData(l, i) } });
      }
    }

    const updated = await tx.itemList.update({
      where: { id },
      data: {
        ...(input.note !== undefined ? { note: input.note } : {}),
        // Bids made on the previous version must be updated before they can be accepted.
        ...(input.lines ? { version: { increment: 1 } } : {}),
      },
      include: listInclude,
    });
    return { updated, bidStoreIds: list.bids.map((b) => b.storeId), previous };
  });

  await writeAuditLog({
    userId: actor.id,
    action: "LIST_EDITED",
    entity: "ItemList",
    entityId: id,
    previousValue: previous,
    newValue: { lines: updated.lines.length, version: updated.version },
    ...meta,
  }).catch((e) => console.error("[lists] audit", e));

  if (input.lines) {
    await notifyBiddingStores(
      bidStoreIds,
      id,
      "LIST_CHANGED",
      "A customer changed their list",
      "Please review the list and update your offer so the customer can accept it."
    );
  }
  return serializeList(updated);
}

export async function cancelList(actor: Actor, id: string, meta: RequestMeta = {}) {
  const { updated, bidStoreIds } = await prisma.$transaction(async (tx) => {
    const list = await lockOpenList(tx, actor, id);
    await tx.storeBid.updateMany({ where: { listId: id, status: "PENDING" }, data: { status: "NOT_SELECTED" } });
    const updated = await tx.itemList.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
      include: listInclude,
    });
    return { updated, bidStoreIds: list.bids.map((b) => b.storeId) };
  });

  await writeAuditLog({
    userId: actor.id,
    action: "LIST_CANCELLED",
    entity: "ItemList",
    entityId: id,
    newValue: { offersClosed: bidStoreIds.length },
    ...meta,
  }).catch((e) => console.error("[lists] audit", e));

  await notifyBiddingStores(
    bidStoreIds,
    id,
    "LIST_CANCELLED",
    "A customer cancelled their list",
    "The list you made an offer on was cancelled by the customer."
  );
  return serializeList(updated);
}
