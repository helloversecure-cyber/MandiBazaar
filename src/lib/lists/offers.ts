/**
 * The customer's view of the store offers on their list (test cases E-01, E-02).
 *
 * Only what a customer needs to choose: store name, area, rating, distance, the
 * per-item prices and "don't have" items, totals, discount, preparation time and
 * an estimated delivery fee. Never the store's phone, owner, bank details,
 * commission or any other store's private data.
 */
import { prisma } from "@/lib/db";
import { listLineTotal } from "@/lib/lists/line-total";
import { computeDeliveryFee, getDeliverySettings } from "@/lib/orders/delivery-fee";
import { ratingOf, storeRatings } from "@/lib/stores/reviews";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OfferTag = "LOWEST_PRICE" | "FASTEST";

export type CustomerOffer = {
  bidId: string;
  status: "PENDING" | "ACCEPTED" | "NOT_SELECTED" | "EXPIRED";
  /** Offer round this offer belongs to (always the list's current round). */
  round: number;
  /** False when the store must update the offer first (list edited after it bid, D-17 / E-07). */
  acceptable: boolean;
  needsUpdate: boolean;
  store: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    area: string | null;
    city: string;
    rating: number | null;
    ratingCount: number;
  };
  distanceKm: number | null;
  itemsTotal: number;
  discount: number;
  total: number;
  coveredCount: number;
  lineCount: number;
  fullCoverage: boolean;
  missingItems: string[];
  prepMinutes: number | null;
  note: string | null;
  /** What a rider would roughly charge (the real fee comes from rider bids after packing). */
  estimatedDeliveryFee: number | null;
  tags: OfferTag[];
  submittedAt: Date;
  updatedAt: Date;
  lines: {
    lineId: string;
    name: string;
    quantity: number;
    unit: string;
    available: boolean;
    unitPrice: number | null;
    lineTotal: number | null;
  }[];
};

/**
 * Sort: the accepted offer first, then offers that can be accepted now, then
 * by items covered (full coverage first), then lowest total, then fastest.
 */
export function compareOffers(a: CustomerOffer, b: CustomerOffer): number {
  const rank = (o: CustomerOffer) => (o.status === "ACCEPTED" ? 0 : o.acceptable ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    b.coveredCount - a.coveredCount ||
    a.total - b.total ||
    (a.prepMinutes ?? Infinity) - (b.prepMinutes ?? Infinity) ||
    a.submittedAt.getTime() - b.submittedAt.getTime()
  );
}

/** E-02: "Lowest price" and "Fastest" among the offers that can be accepted now (ties share the tag). */
export function tagOffers<T extends { acceptable: boolean; total: number; prepMinutes: number | null; tags: OfferTag[] }>(
  offers: T[]
): T[] {
  const open = offers.filter((o) => o.acceptable);
  if (open.length < 2) return offers;
  const minTotal = Math.min(...open.map((o) => o.total));
  const timed = open.filter((o) => o.prepMinutes != null);
  const minPrep = timed.length ? Math.min(...timed.map((o) => o.prepMinutes!)) : null;
  for (const o of open) {
    if (o.total === minTotal) o.tags.push("LOWEST_PRICE");
    if (minPrep != null && o.prepMinutes === minPrep && timed.length > 1) o.tags.push("FASTEST");
  }
  return offers;
}

/**
 * Offers on one list in its current round (caller has already checked the customer
 * owns it). Withdrawn offers are hidden (D-13); earlier rounds' offers are kept as
 * EXPIRED records but not shown.
 */
export async function offersForList(listId: string): Promise<CustomerOffer[]> {
  const list = await prisma.itemList.findUniqueOrThrow({
    where: { id: listId },
    select: {
      status: true,
      version: true,
      latitude: true,
      longitude: true,
      city: true,
      addressSnapshot: true,
      expiresAt: true,
      round: true,
      lines: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, quantity: true, unit: true } },
      broadcasts: { select: { storeId: true, distanceKm: true } },
      bids: {
        where: { status: { in: ["PENDING", "ACCEPTED", "NOT_SELECTED", "EXPIRED"] } },
        select: {
          id: true,
          round: true,
          status: true,
          storeId: true,
          itemsTotal: true,
          discount: true,
          prepMinutes: true,
          note: true,
          coveredCount: true,
          listVersion: true,
          createdAt: true,
          updatedAt: true,
          lines: { select: { lineId: true, available: true, unitPrice: true } },
          store: {
            select: { id: true, name: true, slug: true, logoUrl: true, area: true, city: true, latitude: true, longitude: true, status: true },
          },
        },
      },
    },
  });
  const bids = list.bids.filter((b) => b.round === list.round);
  if (!bids.length) return [];

  const storeIds = bids.map((b) => b.storeId);
  // W9: real customer ratings (StoreReview), shared with the public store pages.
  const [ratingBy, deliverySettings] = await Promise.all([storeRatings(storeIds), getDeliverySettings()]);
  const distanceBy = new Map(list.broadcasts.map((b) => [b.storeId, b.distanceKm == null ? null : Number(b.distanceKm)]));
  const open = list.status === "BIDDING" && list.expiresAt.getTime() > Date.now();
  const area = (list.addressSnapshot as { area?: string } | null)?.area ?? "";

  const offers = bids.map((b): CustomerOffer => {
    const answers = new Map(b.lines.map((l) => [l.lineId, l]));
    const lines = list.lines.map((l) => {
      const a = answers.get(l.id);
      const available = !!a?.available;
      const unitPrice = available && a?.unitPrice != null ? Number(a.unitPrice) : null;
      const quantity = Number(l.quantity);
      return {
        lineId: l.id,
        name: l.name,
        quantity,
        unit: l.unit,
        available,
        unitPrice,
        lineTotal: unitPrice == null ? null : listLineTotal(unitPrice, quantity),
      };
    });
    const itemsTotal = Number(b.itemsTotal);
    const discount = Number(b.discount);
    const total = round2(itemsTotal - discount);
    const needsUpdate = b.status === "PENDING" && b.listVersion !== list.version;
    const r = ratingOf(ratingBy, b.storeId);
    const fee = computeDeliveryFee(
      {
        city: list.city,
        area,
        latitude: list.latitude,
        longitude: list.longitude,
        productsSubtotal: total,
        stores: [{ storeId: b.store.id, latitude: b.store.latitude, longitude: b.store.longitude, city: b.store.city }],
      },
      deliverySettings
    );
    return {
      bidId: b.id,
      status: b.status as CustomerOffer["status"],
      round: b.round,
      acceptable: open && b.status === "PENDING" && !needsUpdate && b.store.status === "APPROVED",
      needsUpdate,
      store: {
        id: b.store.id,
        name: b.store.name,
        slug: b.store.slug,
        logoUrl: b.store.logoUrl,
        area: b.store.area,
        city: b.store.city,
        rating: r.average,
        ratingCount: r.count,
      },
      distanceKm: distanceBy.get(b.storeId) ?? null,
      itemsTotal,
      discount,
      total,
      coveredCount: b.coveredCount,
      lineCount: list.lines.length,
      fullCoverage: !needsUpdate && b.coveredCount === list.lines.length,
      missingItems: needsUpdate ? [] : lines.filter((l) => !l.available).map((l) => l.name),
      prepMinutes: b.prepMinutes,
      note: b.note,
      estimatedDeliveryFee: fee.notionalFee,
      tags: [],
      submittedAt: b.createdAt,
      updatedAt: b.updatedAt,
      lines,
    };
  });

  return tagOffers(offers).sort(compareOffers);
}
