/**
 * Sending a customer's list to nearby stores (test cases C-01 … C-12).
 *
 * - First to approved stores within `radiusStartKm` (5 km) that sell what's on
 *   the list, nearest first, at most `maxStores` (20) per step.
 * - If no store has made an offer after `radiusStepMins` (30 min), or every store
 *   that got it said "can't supply", the radius grows by `radiusStepKm` (5 km),
 *   up to `radiusMaxKm` (20 km), and the next stores get it.
 * - A step that finds no new store widens straight away.
 * - Nothing left to widen and still no offer → NO_STORES, customer is told.
 *
 * There is no always-on scheduler (Vercel Hobby crons run daily), so `tickList`
 * runs whenever the customer or a store opens the list, from
 * /api/cron/lists-tick (external cron) and from the daily cron.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { haversineKm } from "@/lib/orders/delivery-fee";
import { sendNotification } from "@/lib/notifications/service";
import { getListSettings, type ListSettings } from "@/lib/lists/settings";

type ListForMatch = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  lines: { categoryId: string | null }[];
};

export type StoreMatch = { storeId: string; ownerId: string; distanceKm: number | null };

const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Stores that should get the list at this radius and haven't yet. Pinned stores
 * inside the radius come first (nearest first); stores without a pin in the same
 * city come after them (C-11). A list without a pin matches by city only.
 */
export async function matchStores(
  list: ListForMatch,
  radiusKm: number,
  opts: { exclude?: Set<string>; limit: number }
): Promise<StoreMatch[]> {
  const categoryIds = Array.from(new Set(list.lines.map((l) => l.categoryId).filter((v): v is string => !!v)));
  const categoryNames = categoryIds.length
    ? (await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { name: true } })).map((c) => c.name)
    : [];

  const where: Prisma.StoreWhereInput = {
    status: "APPROVED",
    isVirtual: false,
    ...(categoryIds.length
      ? {
          OR: [
            { requestedCategories: { hasSome: categoryNames } },
            { products: { some: { status: "ACTIVE", categoryId: { in: categoryIds } } } },
          ],
        }
      : {}),
  };
  const stores = await prisma.store.findMany({
    where,
    select: { id: true, ownerId: true, city: true, latitude: true, longitude: true },
  });

  const listPinned = list.latitude != null && list.longitude != null;
  const pinned: StoreMatch[] = [];
  const cityOnly: StoreMatch[] = [];
  for (const s of stores) {
    if (opts.exclude?.has(s.id)) continue;
    if (listPinned && s.latitude != null && s.longitude != null) {
      const d = haversineKm(list.latitude!, list.longitude!, s.latitude, s.longitude);
      if (d <= radiusKm) pinned.push({ storeId: s.id, ownerId: s.ownerId, distanceKm: Math.round(d * 1000) / 1000 });
    } else if (sameCity(s.city, list.city)) {
      cityOnly.push({ storeId: s.id, ownerId: s.ownerId, distanceKm: null });
    }
  }
  pinned.sort((a, b) => a.distanceKm! - b.distanceKm!);
  return [...pinned, ...cityOnly].slice(0, opts.limit);
}

async function sendToStores(listId: string, radiusKm: number, matches: StoreMatch[], lineCount: number, area: string) {
  if (!matches.length) return 0;
  const created = await prisma.listBroadcast.createMany({
    data: matches.map((m) => ({ listId, storeId: m.storeId, radiusKm, distanceKm: m.distanceKm })),
    skipDuplicates: true,
  });
  await Promise.all(
    matches.map((m) =>
      sendNotification({
        userId: m.ownerId,
        type: "NEW_LIST",
        title: "New list near you",
        body: `A customer${m.distanceKm != null ? ` ${m.distanceKm.toFixed(1)} km away` : ""} in ${area} needs ${lineCount} item${lineCount === 1 ? "" : "s"}. Send your offer.`,
        metadata: { listId },
      }).catch(() => {})
    )
  );
  return created.count;
}

async function loadList(listId: string) {
  return prisma.itemList.findUnique({
    where: { id: listId },
    include: {
      lines: { select: { categoryId: true } },
      broadcasts: { select: { storeId: true, declinedAt: true } },
      bids: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
}

function areaOf(snapshot: unknown, city: string) {
  const a = (snapshot as { area?: string } | null)?.area;
  return a ? `${a}, ${city}` : city;
}

/**
 * Send to the next stores, widening the radius as many steps as needed until at
 * least one new store gets the list or the maximum radius is reached.
 * `fromRadius` is the radius to try first. Returns the radius used and count sent.
 */
async function sendFrom(
  list: NonNullable<Awaited<ReturnType<typeof loadList>>>,
  fromRadius: number,
  s: ListSettings
): Promise<{ radiusKm: number; sent: number }> {
  const exclude = new Set(list.broadcasts.map((b) => b.storeId));
  const area = areaOf(list.addressSnapshot, list.city);
  let radius = Math.min(fromRadius, s.radiusMaxKm);
  for (;;) {
    const matches = await matchStores(list, radius, { exclude, limit: s.maxStores });
    const sent = await sendToStores(list.id, radius, matches, list.lines.length, area);
    if (sent > 0 || radius >= s.radiusMaxKm) return { radiusKm: radius, sent };
    radius = Math.min(radius + s.radiusStepKm, s.radiusMaxKm);
  }
}

async function markNoStores(listId: string, customerId: string) {
  const r = await prisma.itemList.updateMany({ where: { id: listId, status: "BIDDING" }, data: { status: "NO_STORES" } });
  if (r.count) {
    await sendNotification({
      userId: customerId,
      type: "LIST_NO_STORES",
      title: "No shop found for your list",
      body: "No store near you could take this list right now. Try again later or change the items.",
      metadata: { listId },
    }).catch(() => {});
  }
}

/** First send, right after the customer creates the list. */
export async function broadcastNewList(listId: string): Promise<{ radiusKm: number; sent: number }> {
  const s = await getListSettings();
  const list = await loadList(listId);
  if (!list || list.status !== "BIDDING") return { radiusKm: list?.radiusKm ?? 0, sent: 0 };
  const res = await sendFrom(list, list.radiusKm, s);
  await prisma.itemList.update({ where: { id: listId }, data: { radiusKm: res.radiusKm, lastWidenedAt: new Date() } });
  if (res.sent === 0) await markNoStores(listId, list.customerId);
  return res;
}

export type TickResult = "UNCHANGED" | "WIDENED" | "NO_STORES" | "EXPIRED" | "CLOSED";

/** Advance one list: expire it, widen it or give up, if it's due. Safe to call often and in parallel. */
export async function tickList(listId: string, now = new Date()): Promise<TickResult> {
  const list = await loadList(listId);
  if (!list || list.status !== "BIDDING") return "CLOSED";

  if (list.expiresAt.getTime() <= now.getTime()) {
    const r = await prisma.itemList.updateMany({ where: { id: listId, status: "BIDDING" }, data: { status: "EXPIRED" } });
    if (r.count) {
      await prisma.storeBid.updateMany({ where: { listId, status: "PENDING" }, data: { status: "NOT_SELECTED" } });
    }
    return "EXPIRED";
  }

  // C-06: someone has made an offer — nothing to widen.
  if (list.bids.length > 0) return "UNCHANGED";

  const s = await getListSettings();
  const allDeclined = list.broadcasts.length > 0 && list.broadcasts.every((b) => b.declinedAt);
  const dueByTime = now.getTime() - list.lastWidenedAt.getTime() >= s.radiusStepMins * 60_000;
  if (!allDeclined && !dueByTime) return "UNCHANGED";

  if (list.radiusKm >= s.radiusMaxKm) {
    await markNoStores(listId, list.customerId);
    return "NO_STORES";
  }

  // Claim this widening step so two parallel ticks don't both widen.
  const claimed = await prisma.itemList.updateMany({
    where: { id: listId, status: "BIDDING", radiusKm: list.radiusKm, lastWidenedAt: list.lastWidenedAt },
    data: { lastWidenedAt: now },
  });
  if (claimed.count !== 1) return "UNCHANGED";

  const res = await sendFrom(list, list.radiusKm + s.radiusStepKm, s);
  await prisma.itemList.update({ where: { id: listId }, data: { radiusKm: res.radiusKm } });
  if (res.sent === 0) {
    await markNoStores(listId, list.customerId);
    return "NO_STORES";
  }
  return "WIDENED";
}

/** Tick every list that might be due (cron). */
export async function tickDueLists(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const s = await getListSettings();
  const due = await prisma.itemList.findMany({
    where: {
      status: "BIDDING",
      OR: [
        { expiresAt: { lte: now } },
        { lastWidenedAt: { lte: new Date(now.getTime() - s.radiusStepMins * 60_000) } },
        { broadcasts: { some: { declinedAt: { not: null } } } },
      ],
    },
    select: { id: true },
    orderBy: { lastWidenedAt: "asc" },
    take: opts.limit ?? 100,
  });
  const results: Record<TickResult, number> = { UNCHANGED: 0, WIDENED: 0, NO_STORES: 0, EXPIRED: 0, CLOSED: 0 };
  for (const l of due) results[await tickList(l.id, now)]++;
  return { checked: due.length, ...results };
}
