/**
 * Sending a customer's list to nearby stores (test cases C-01 … C-12).
 *
 * - First to approved stores within `radiusStartKm` (5 km) that sell what's on
 *   the list, nearest first, at most `maxStores` (20) per step.
 * - If no store has made an offer after `radiusStepMins` (30 min), or every store
 *   that got it said "can't supply", the radius grows by `radiusStepKm` (5 km),
 *   up to `radiusMaxKm` (20 km), and the next stores get it.
 * - A step that finds no new store widens straight away.
 * - NO_STORES (customer told) only when no store has ever received the list.
 *   Once some store has it and the radius is at its maximum (or every store
 *   said "can't supply" there), the list stays open for the full window and
 *   then restarts; ticks only watch the window end and the reminder.
 *
 * Rounds (owner rule): each round is open for `expiryHours` (48 h). If the
 * customer hasn't accepted an offer when it ends, that round's pending offers
 * become EXPIRED (kept) and the list restarts: round + 1, a fresh window, sent
 * again from the first radius (stores that bid last round get it straight
 * away), customer and last round's bidders told. About 6 h before a round ends
 * the customer is reminded once. Stops on accept or cancel; after `maxRounds`
 * (0 = never) the list ends as EXPIRED.
 *
 * There is no always-on scheduler (Vercel Hobby crons run daily), so `tickList`
 * runs whenever the customer or a store opens the list, from
 * /api/cron/lists-tick (external cron) and from the daily cron.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
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

/**
 * Put the list in front of these stores for `round`: a new broadcast row, or a
 * row from an earlier round moved to this one (seen / declined reset). Only the
 * stores this call actually placed are notified, so parallel calls don't double up.
 */
async function sendToStores(
  list: { id: string; round: number },
  radiusKm: number,
  matches: StoreMatch[],
  note: (m: StoreMatch) => { type: string; title: string; body: string }
) {
  if (!matches.length) return 0;
  const listId = list.id;
  const existing = await prisma.listBroadcast.findMany({
    where: { listId, storeId: { in: matches.map((m) => m.storeId) } },
    select: { storeId: true },
  });
  const had = new Set(existing.map((e) => e.storeId));
  const placed: StoreMatch[] = [];
  const created = await prisma.listBroadcast.createManyAndReturn({
    data: matches
      .filter((m) => !had.has(m.storeId))
      .map((m) => ({ listId, storeId: m.storeId, radiusKm, distanceKm: m.distanceKm, round: list.round })),
    skipDuplicates: true,
    select: { storeId: true },
  });
  const createdIds = new Set(created.map((c) => c.storeId));
  for (const m of matches) {
    if (createdIds.has(m.storeId)) {
      placed.push(m);
    } else if (had.has(m.storeId)) {
      const r = await prisma.listBroadcast.updateMany({
        where: { listId, storeId: m.storeId, round: { lt: list.round } },
        data: { round: list.round, radiusKm, distanceKm: m.distanceKm, sentAt: new Date(), seenAt: null, declinedAt: null },
      });
      if (r.count) placed.push(m);
    }
  }
  await Promise.all(
    placed.map((m) => sendNotification({ userId: m.ownerId, ...note(m), metadata: { listId } }).catch(() => {}))
  );
  return placed.length;
}

const newListNote = (lineCount: number, area: string) => (m: StoreMatch) => ({
  type: "NEW_LIST",
  title: "New list near you",
  body: `A customer${m.distanceKm != null ? ` ${m.distanceKm.toFixed(1)} km away` : ""} in ${area} needs ${lineCount} item${lineCount === 1 ? "" : "s"}. Send your offer.`,
});

async function loadList(listId: string) {
  return prisma.itemList.findUnique({
    where: { id: listId },
    include: {
      lines: { select: { categoryId: true } },
      broadcasts: { select: { storeId: true, declinedAt: true, round: true } },
      bids: { where: { status: "PENDING" }, select: { id: true, round: true } },
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
  // Stores that already have it this round; earlier rounds' stores can get it again.
  const exclude = new Set(list.broadcasts.filter((b) => b.round === list.round).map((b) => b.storeId));
  const area = areaOf(list.addressSnapshot, list.city);
  let radius = Math.min(fromRadius, s.radiusMaxKm);
  for (;;) {
    const matches = await matchStores(list, radius, { exclude, limit: s.maxStores });
    const sent = await sendToStores(list, radius, matches, newListNote(list.lines.length, area));
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

export type TickResult = "UNCHANGED" | "WIDENED" | "NO_STORES" | "EXPIRED" | "RESTARTED" | "REMINDED" | "CLOSED";

/** The customer's "offers expire soon" reminder goes this long before a round ends (6 h, or half a short window). */
export function reminderLeadMs(s: Pick<ListSettings, "expiryHours">) {
  return Math.min(6 * 3600_000, (s.expiryHours * 3600_000) / 2);
}

type EndRound =
  | { kind: "CLOSED" | "UNCHANGED" }
  | { kind: "EXPIRED"; round: number; expired: { id: string; storeId: string }[] }
  | { kind: "RESTARTED"; round: number; expired: { id: string; storeId: string }[]; settings: ListSettings };

/**
 * The round's window has ended without an accept: expire its pending offers and
 * either restart the list for a new round or, at `maxRounds`, close it as EXPIRED.
 * The list row is locked and the round re-checked, so of two parallel ticks only
 * one ends the round (accepts, edits and cancels take the same lock).
 */
export async function endRoundIfDue(listId: string, round: number, now = new Date()): Promise<EndRound> {
  const res = await prisma.$transaction(async (tx): Promise<EndRound> => {
    await tx.$queryRaw`SELECT id FROM "ItemList" WHERE id = ${listId} FOR UPDATE`;
    const cur = await tx.itemList.findUnique({ where: { id: listId }, select: { status: true, round: true, expiresAt: true } });
    if (!cur || cur.status !== "BIDDING") return { kind: "CLOSED" };
    if (cur.round !== round || cur.expiresAt.getTime() > now.getTime()) return { kind: "UNCHANGED" };

    const s = await getListSettings(tx);
    const expired = await tx.storeBid.findMany({
      where: { listId, round, status: "PENDING" },
      select: { id: true, storeId: true },
    });
    if (expired.length) {
      await tx.storeBid.updateMany({ where: { id: { in: expired.map((b) => b.id) } }, data: { status: "EXPIRED" } });
    }

    if (s.maxRounds > 0 && round >= s.maxRounds) {
      const r = await tx.itemList.updateMany({ where: { id: listId, status: "BIDDING", round }, data: { status: "EXPIRED" } });
      if (!r.count) throw new Error("list changed while ending its round");
      await writeAuditLog(
        { action: "LIST_EXPIRED", entity: "ItemList", entityId: listId, newValue: { round, offersExpired: expired.length, maxRounds: s.maxRounds } },
        tx
      );
      return { kind: "EXPIRED", round, expired };
    }

    const next = round + 1;
    const r = await tx.itemList.updateMany({
      where: { id: listId, status: "BIDDING", round },
      data: {
        round: next,
        roundStartedAt: now,
        expiresAt: new Date(now.getTime() + s.expiryHours * 3600_000),
        reminderSentAt: null,
        radiusKm: s.radiusStartKm,
        lastWidenedAt: now,
      },
    });
    if (!r.count) throw new Error("list changed while ending its round");
    await writeAuditLog(
      { action: "LIST_RESTARTED", entity: "ItemList", entityId: listId, previousValue: { round }, newValue: { round: next, offersExpired: expired.length } },
      tx
    );
    return { kind: "RESTARTED", round: next, expired, settings: s };
  });
  return res;
}

/** Send a restarted list out again and tell the customer and last round's bidders. */
async function afterRestart(listId: string, res: Extract<EndRound, { kind: "RESTARTED" }>) {
  const list = await loadList(listId);
  if (!list || list.status !== "BIDDING" || list.round !== res.round) return;
  const s = res.settings;
  const area = areaOf(list.addressSnapshot, list.city);

  // Last round's bidders get it again straight away (they're interested), wherever they are.
  const bidderIds = Array.from(new Set(res.expired.map((b) => b.storeId)));
  const previous = bidderIds.length
    ? await prisma.store.findMany({
        where: { id: { in: bidderIds }, status: "APPROVED" },
        select: { id: true, ownerId: true, listBroadcasts: { where: { listId }, select: { distanceKm: true, radiusKm: true } } },
      })
    : [];
  let sent = 0;
  for (const st of previous) {
    const b = st.listBroadcasts[0];
    sent += await sendToStores(
      list,
      b?.radiusKm ?? s.radiusStartKm,
      [{ storeId: st.id, ownerId: st.ownerId, distanceKm: b?.distanceKm == null ? null : Number(b.distanceKm) }],
      () => ({
        type: "LIST_RESTARTED",
        title: "List restarted, bid again",
        body: `The customer in ${area} didn't choose an offer in time, so their list is open again (round ${res.round}). Send a new offer.`,
      })
    );
  }

  await sendNotification({
    userId: list.customerId,
    type: "LIST_RESTARTED",
    title: `Your list restarted — round ${res.round}`,
    body: `No offer was accepted in time, so we sent your list to stores again. You have ${s.expiryHours} hours to choose an offer.`,
    metadata: { listId, round: res.round },
  }).catch(() => {});

  // Then the first circle, as for a new list. If last round's bidders already have
  // it, one step is enough; otherwise widen until some store gets it.
  const fresh = (await loadList(listId))!;
  const more =
    sent > 0
      ? {
          radiusKm: s.radiusStartKm,
          sent: await sendToStores(
            fresh,
            s.radiusStartKm,
            await matchStores(fresh, s.radiusStartKm, {
              exclude: new Set(fresh.broadcasts.filter((b) => b.round === fresh.round).map((b) => b.storeId)),
              limit: s.maxStores,
            }),
            newListNote(fresh.lines.length, area)
          ),
        }
      : await sendFrom(fresh, s.radiusStartKm, s);
  await prisma.itemList.updateMany({ where: { id: listId, round: res.round }, data: { radiusKm: more.radiusKm, lastWidenedAt: new Date() } });
  if (sent + more.sent === 0) await markNoStores(listId, list.customerId);
}

/** Once per round: remind the customer their offers expire soon. */
async function remindIfDue(list: NonNullable<Awaited<ReturnType<typeof loadList>>>, s: ListSettings, now: Date) {
  const left = list.expiresAt.getTime() - now.getTime();
  if (list.reminderSentAt || left <= 0 || left > reminderLeadMs(s)) return false;
  const claimed = await prisma.itemList.updateMany({
    where: { id: list.id, status: "BIDDING", round: list.round, reminderSentAt: null },
    data: { reminderSentAt: now },
  });
  if (claimed.count !== 1) return false;
  const hours = Math.max(1, Math.round(left / 3600_000));
  await sendNotification({
    userId: list.customerId,
    type: "LIST_OFFERS_EXPIRING",
    title: `Your offers expire in ${hours} hour${hours === 1 ? "" : "s"} — choose one`,
    body: "Pick the offer you like before the time runs out, or your list starts a new round.",
    metadata: { listId: list.id, round: list.round },
  }).catch(() => {});
  return true;
}

/** Advance one list: end its round, remind, widen or give up, if it's due. Safe to call often and in parallel. */
export async function tickList(listId: string, now = new Date()): Promise<TickResult> {
  const list = await loadList(listId);
  if (!list || list.status !== "BIDDING") return "CLOSED";

  if (list.expiresAt.getTime() <= now.getTime()) {
    const res = await endRoundIfDue(listId, list.round, now);
    if (res.kind === "RESTARTED") {
      await afterRestart(listId, res);
      return "RESTARTED";
    }
    if (res.kind === "EXPIRED") return "EXPIRED";
    return res.kind === "CLOSED" ? "CLOSED" : "UNCHANGED";
  }

  const s = await getListSettings();
  // C-06: someone has made an offer this round — nothing to widen; maybe remind the customer.
  if (list.bids.some((b) => b.round === list.round)) {
    return (await remindIfDue(list, s, now)) ? "REMINDED" : "UNCHANGED";
  }

  // At the largest radius with stores that have it: nothing more to widen. Wait for
  // the window to end (then the list restarts; stocks change), don't end it early.
  const everSent = list.broadcasts.length > 0;
  if (list.radiusKm >= s.radiusMaxKm && everSent) return "UNCHANGED";

  const current = list.broadcasts.filter((b) => b.round === list.round);
  const allDeclined = current.length > 0 && current.every((b) => b.declinedAt);
  const dueByTime = now.getTime() - list.lastWidenedAt.getTime() >= s.radiusStepMins * 60_000;
  if (!allDeclined && !dueByTime) return "UNCHANGED";

  if (list.radiusKm >= s.radiusMaxKm) {
    // Never sent to any store (see the early return above).
    await markNoStores(listId, list.customerId);
    return "NO_STORES";
  }

  // Claim this widening step so two parallel ticks don't both widen.
  const claimed = await prisma.itemList.updateMany({
    where: { id: listId, status: "BIDDING", round: list.round, radiusKm: list.radiusKm, lastWidenedAt: list.lastWidenedAt },
    data: { lastWidenedAt: now },
  });
  if (claimed.count !== 1) return "UNCHANGED";

  const res = await sendFrom(list, list.radiusKm + s.radiusStepKm, s);
  await prisma.itemList.updateMany({ where: { id: listId, round: list.round }, data: { radiusKm: res.radiusKm } });
  if (res.sent === 0) {
    // Reached the largest radius without a new store. Only give up if no store ever got it.
    if (everSent) return "UNCHANGED";
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
        { reminderSentAt: null, expiresAt: { lte: new Date(now.getTime() + reminderLeadMs(s)) }, bids: { some: { status: "PENDING" } } },
        // Widening is only due below the largest radius; at it, only the window end and reminder matter.
        { radiusKm: { lt: s.radiusMaxKm }, lastWidenedAt: { lte: new Date(now.getTime() - s.radiusStepMins * 60_000) } },
        { radiusKm: { lt: s.radiusMaxKm }, broadcasts: { some: { declinedAt: { not: null } } } },
      ],
    },
    select: { id: true },
    orderBy: { lastWidenedAt: "asc" },
    take: opts.limit ?? 100,
  });
  const results: Record<TickResult, number> = { UNCHANGED: 0, WIDENED: 0, NO_STORES: 0, EXPIRED: 0, RESTARTED: 0, REMINDED: 0, CLOSED: 0 };
  for (const l of due) {
    // One bad list must not stop the rest.
    const r = await tickList(l.id, now).catch((e) => {
      console.error("[lists] tick", l.id, e);
      return "UNCHANGED" as const;
    });
    results[r]++;
  }
  return { checked: due.length, ...results };
}
