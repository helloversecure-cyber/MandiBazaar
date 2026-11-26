/**
 * Rider bidding after packing (W8, test cases G-01 … G-17).
 *
 * Only for orders that started as an item list (Order.itemList set). Normal cart
 * orders keep today's flow: their bidding happens before checkout (bidding.ts)
 * or admin assigns a rider.
 *
 *   store marks the list order ready (READY_FOR_DISPATCH)
 *     → one DeliveryRequest, trigger POST_PACK, orderId set, city, window
 *       (StoreSettings.postPackBidWindowSecs), riders near the store notified
 *   riders bid a delivery fee (Rs 1 … 10,000), edit or withdraw while open
 *   customer accepts one bid (row locks, one winner)
 *     → order ASSIGNED_TO_RIDER, deliveryFee = bid, fee paid in cash to the rider
 *       with the products, Delivery row, RIDER_EARNING ledger, others REJECTED
 *   no bid when the window ends → re-opened once with twice the radius; still
 *   none → NO_BIDS, customer + store + admins told, admin assigns by hand.
 *
 * Timers run lazily (whenever a rider, the customer or a cron touches it), since
 * Vercel Hobby only runs crons once a day.
 */
import { OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/password-check";
import { recordRiderEarningLedger } from "@/lib/finance/ledger";
import { getListSettings } from "@/lib/lists/settings";
import {
  notifyOrderEvent,
  notifyRiderAssignment,
  notifySuperAdminsInApp,
  sendNotification,
} from "@/lib/notifications/service";
import { notifyBidAccepted } from "@/lib/notifications/bidding-events";
import { storeRecipientIds } from "@/lib/notifications/order-events";
import { BiddingError, MAX_BID_AMOUNT, RIDER_INELIGIBLE_MESSAGES, type DeliverySummary } from "@/lib/orders/bidding";
import { haversineKm } from "@/lib/orders/delivery-fee";
import { syncFulfillmentsToOrderStatus } from "@/lib/orders/fulfillment-sync";
import { recordStatusEvent } from "@/lib/orders/status-events";
import { customerDeliveryCodeView, issueDeliveryCodeOnAssign, sendDeliveryCodeToCustomer } from "@/lib/orders/delivery-code";
import { ELIGIBLE_RIDER_WHERE, riderBidEligibility, riderHasActiveDelivery } from "@/lib/riders/eligibility";
import { formatCurrency } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** A request with no bids is re-opened this many times before admin takes over (plan 3.2). */
export const POST_PACK_MAX_REOPENS = 1;
/** A rider position older than this is treated as unknown (city match instead). */
export const RIDER_LOCATION_FRESH_MINS = 30;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What a rider sees before winning: areas and distance only, never the customer's phone or house. */
export type PostPackSummary = DeliverySummary & {
  trigger: "POST_PACK";
  storeName: string;
  /** The store's public map pin (riders need it to judge the pickup trip). */
  pickupPoint: { latitude: number; longitude: number } | null;
};

/** Riders within this radius of the store see the request: base radius, doubled on the re-open. */
export function postPackRadiusKm(baseKm: number, reopenCount: number): number {
  return Math.max(1, baseKm) * (1 + Math.max(0, reopenCount));
}

type RiderPosition = {
  city: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: Date | null;
};

/**
 * Pure: is this rider close enough to the pickup? A rider with a recent position
 * must be within `radiusKm` of the store pin. A rider without one (or a store
 * without a pin) matches on city, the same fallback list broadcasting uses for
 * stores without a pin.
 */
export function riderNearPickup(
  rider: RiderPosition,
  pickup: { point: { latitude: number; longitude: number } | null; city: string | null },
  radiusKm: number,
  now = new Date()
): { near: boolean; distanceKm: number | null } {
  const fresh =
    rider.lastLatitude != null &&
    rider.lastLongitude != null &&
    rider.lastLocationAt != null &&
    now.getTime() - rider.lastLocationAt.getTime() <= RIDER_LOCATION_FRESH_MINS * 60_000;
  if (fresh && pickup.point) {
    const d = haversineKm(rider.lastLatitude!, rider.lastLongitude!, pickup.point.latitude, pickup.point.longitude);
    return { near: d <= radiusKm, distanceKm: Math.round(d * 10) / 10 };
  }
  const a = rider.city?.trim().toLowerCase();
  const b = pickup.city?.trim().toLowerCase();
  return { near: !!a && !!b && a === b, distanceKm: null };
}

function pickupOf(req: { summary: Prisma.JsonValue; city: string | null }) {
  const s = (req.summary ?? {}) as Partial<PostPackSummary>;
  const p = s.pickupPoint;
  const point =
    p && typeof p.latitude === "number" && typeof p.longitude === "number"
      ? { latitude: p.latitude, longitude: p.longitude }
      : null;
  return { point, city: req.city };
}

// ---------------------------------------------------------------------------
// Opening (store marks a list order ready)
// ---------------------------------------------------------------------------

export type OpenPostPackResult = { isListOrder: boolean; created: boolean; requestId: string | null };

/**
 * Call inside the transaction that made the order READY_FOR_DISPATCH. Opens the
 * after-packing request for an item-list order; does nothing for cart orders
 * (G-16) or when one already exists (G-02: DeliveryRequest.orderId is unique).
 */
export async function openPostPackRequest(tx: Tx, orderId: string): Promise<OpenPostPackResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      orderStatus: true,
      riderId: true,
      deliveryAddressSnapshot: true,
      items: { select: { quantity: true, storeId: true } },
      itemList: { select: { id: true, city: true } },
      deliveryRequest: { select: { id: true } },
    },
  });
  if (!order?.itemList) return { isListOrder: false, created: false, requestId: null };
  if (order.deliveryRequest) return { isListOrder: true, created: false, requestId: order.deliveryRequest.id };
  if (order.orderStatus !== OrderStatus.READY_FOR_DISPATCH || order.riderId) {
    return { isListOrder: true, created: false, requestId: null };
  }

  const storeIds = Array.from(new Set(order.items.map((i) => i.storeId)));
  const stores = await tx.store.findMany({
    where: { id: { in: storeIds } },
    select: { name: true, area: true, city: true, latitude: true, longitude: true },
  });
  const store = stores[0];
  const drop = (order.deliveryAddressSnapshot ?? {}) as {
    area?: string;
    city?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  const pickupPoint =
    store?.latitude != null && store?.longitude != null ? { latitude: store.latitude, longitude: store.longitude } : null;
  const distanceKm =
    pickupPoint && drop.latitude != null && drop.longitude != null
      ? Math.round(haversineKm(pickupPoint.latitude, pickupPoint.longitude, Number(drop.latitude), Number(drop.longitude)) * 10) / 10
      : 0;
  const summary: PostPackSummary = {
    trigger: "POST_PACK",
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
    storeCount: storeIds.length,
    distanceKm,
    pickup: stores.map((s) => (s.area ? `${s.area}, ${s.city}` : s.city || s.name)),
    drop: { city: drop.city ?? null, area: drop.area ?? null },
    storeName: store?.name ?? "Store",
    pickupPoint,
  };

  const s = await getListSettings(tx);
  const created = await tx.deliveryRequest.createMany({
    data: [
      {
        customerId: order.customerId,
        orderId: order.id,
        status: "OPEN",
        trigger: "POST_PACK",
        city: order.itemList.city || drop.city || store?.city || null,
        expiresAt: new Date(Date.now() + Math.max(30, s.postPackBidWindowSecs) * 1000),
        summary: summary as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  const row = await tx.deliveryRequest.findUnique({ where: { orderId: order.id }, select: { id: true } });
  return { isListOrder: true, created: created.count === 1, requestId: row?.id ?? null };
}

/**
 * Eligible riders (approved, active, online, no overdue COD cash, not busy)
 * near the request's pickup. Used for notifications.
 */
export async function eligibleRidersForRequest(
  req: { summary: Prisma.JsonValue; city: string | null; reopenCount: number },
  now = new Date()
) {
  const s = await getListSettings();
  const radiusKm = postPackRadiusKm(s.postPackRiderRadiusKm, req.reopenCount);
  const pickup = pickupOf(req);
  const candidates = await prisma.rider.findMany({
    where: { ...ELIGIBLE_RIDER_WHERE, codRestrictedAt: null, userId: { not: null } },
    select: { id: true, userId: true, city: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
    take: 500,
  });
  const out: { id: string; userId: string; distanceKm: number | null }[] = [];
  for (const r of candidates) {
    const near = riderNearPickup(r, pickup, radiusKm, now);
    if (!near.near) continue;
    if (await riderHasActiveDelivery(r.id)) continue;
    out.push({ id: r.id, userId: r.userId!, distanceKm: near.distanceKm });
  }
  return out;
}

/**
 * After commit: tell nearby riders (in-app + push) and, on the first opening,
 * the customer. Never throws. Returns the number of riders notified.
 */
export async function notifyPostPackOpened(requestId: string, opts: { reopened?: boolean } = {}): Promise<number> {
  try {
    const req = await prisma.deliveryRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, summary: true, city: true, reopenCount: true, orderId: true, customerId: true, order: { select: { orderNumber: true } } },
    });
    if (!req || req.status !== "OPEN") return 0;
    const s = (req.summary ?? {}) as Partial<PostPackSummary>;
    const pickup = s.pickup?.[0] ?? "a nearby store";
    const dropArea = [s.drop?.area, s.drop?.city].filter(Boolean).join(", ") || "nearby";
    const riders = await eligibleRidersForRequest(req);
    await Promise.all(
      riders.map((r) =>
        sendNotification({
          userId: r.userId,
          type: "NEW_DELIVERY_REQUEST",
          title: opts.reopened ? "Delivery request still open" : "New delivery request near you",
          body: `Pickup in ${pickup}, drop in ${dropArea}${s.distanceKm ? ` (${s.distanceKm} km)` : ""}. Open Delivery requests to bid your fee.`,
          metadata: { requestId: req.id, trigger: "POST_PACK" },
        }).catch(() => {})
      )
    );
    if (!opts.reopened) {
      await sendNotification({
        userId: req.customerId,
        orderId: req.orderId ?? undefined,
        type: "RIDER_BIDDING_OPEN",
        title: "Riders are bidding",
        body: `Your order ${req.order?.orderNumber ?? ""} is packed. Nearby riders are bidding on the delivery fee. Open your order to choose one.`,
        metadata: { requestId: req.id },
      }).catch(() => {});
    }
    return riders.length;
  } catch (e) {
    console.error("[post-pack:notify-open]", e);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Rider side
// ---------------------------------------------------------------------------

/**
 * Which of these requests a rider may see (POST_PACK only), with the rider's
 * distance to the pickup when known. Map of requestId → distance (or null).
 */
export async function postPackVisibility(
  riderId: string,
  reqs: { id: string; trigger: string; summary: Prisma.JsonValue; city: string | null; reopenCount: number }[],
  now = new Date()
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const post = reqs.filter((r) => r.trigger === "POST_PACK");
  if (!post.length) return out;
  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    select: { city: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
  });
  if (!rider) return out;
  const s = await getListSettings();
  for (const r of post) {
    const near = riderNearPickup(rider, pickupOf(r), postPackRadiusKm(s.postPackRiderRadiusKm, r.reopenCount), now);
    if (near.near) out.set(r.id, near.distanceKm);
  }
  return out;
}

async function assertRiderMayBid(tx: Db, riderId: string, req: { summary: Prisma.JsonValue; city: string | null; reopenCount: number }) {
  const eligibility = await riderBidEligibility(riderId, tx);
  if (!eligibility.eligible) {
    throw new BiddingError(
      "INELIGIBLE",
      RIDER_INELIGIBLE_MESSAGES[eligibility.reason] || "You can't bid right now.",
      403
    );
  }
  const rider = await tx.rider.findUnique({
    where: { id: riderId },
    select: { city: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
  });
  const s = await getListSettings(tx);
  if (!rider || !riderNearPickup(rider, pickupOf(req), postPackRadiusKm(s.postPackRiderRadiusKm, req.reopenCount)).near) {
    throw new BiddingError("TOO_FAR", "This delivery is too far from you.", 403);
  }
}

/**
 * A rider bids (or changes their bid) on an after-packing request. New bids are
 * taken while the window is open; a rider who already bid may change the amount
 * until the customer chooses. The request row is locked so a bid can't land on a
 * request the customer just closed.
 */
export async function submitPostPackBid(opts: { riderId: string; requestId: string; amount: number; note?: string }) {
  const amount = Math.round(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BiddingError("BAD_AMOUNT", "Enter a valid delivery fee.");
  if (amount > MAX_BID_AMOUNT) throw new BiddingError("BAD_AMOUNT", "That delivery fee is too high.");

  await tickPostPackRequest(opts.requestId).catch((e) => console.error("[post-pack:tick]", e));

  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DeliveryRequest" WHERE id = ${opts.requestId} FOR UPDATE`;
    const req = await tx.deliveryRequest.findUnique({
      where: { id: opts.requestId },
      select: { id: true, status: true, expiresAt: true, trigger: true, summary: true, city: true, reopenCount: true, customerId: true, orderId: true },
    });
    if (!req || req.trigger !== "POST_PACK") throw new BiddingError("NOT_FOUND", "Delivery request not found.", 404);
    if (req.status !== "OPEN") throw new BiddingError("CLOSED", "This delivery request is no longer open.", 409);
    const mine = await tx.riderBid.findUnique({
      where: { deliveryRequestId_riderId: { deliveryRequestId: req.id, riderId: opts.riderId } },
      select: { status: true },
    });
    const editing = mine?.status === "PENDING";
    if (!editing && req.expiresAt.getTime() <= Date.now()) {
      throw new BiddingError("EXPIRED", "Bidding on this delivery has closed.", 409);
    }
    // A withdrawn bid, or one that lapsed while the rider was offline, may be placed again.
    if (mine && !["PENDING", "WITHDRAWN", "EXPIRED"].includes(mine.status)) {
      throw new BiddingError("CLOSED", "Your bid on this delivery is closed.", 409);
    }
    await assertRiderMayBid(tx, opts.riderId, req);
    const note = opts.note?.trim().slice(0, 200) || null;
    const bid = await tx.riderBid.upsert({
      where: { deliveryRequestId_riderId: { deliveryRequestId: req.id, riderId: opts.riderId } },
      create: { deliveryRequestId: req.id, riderId: opts.riderId, amount, note, expiresAt: req.expiresAt, status: "PENDING" },
      update: { amount, note, status: "PENDING" },
    });
    return { bid, isNew: !editing, customerId: req.customerId, orderId: req.orderId };
  });

  if (out.isNew) {
    await sendNotification({
      userId: out.customerId,
      orderId: out.orderId ?? undefined,
      type: "RIDER_BID_NEW",
      title: "New rider bid",
      body: `A rider offered to deliver your order for ${formatCurrency(amount)}. Open your order to choose a rider.`,
      metadata: { requestId: opts.requestId },
    }).catch(() => {});
  }
  return out.bid;
}

/** A rider takes back their bid while the customer hasn't chosen yet. */
export async function withdrawPostPackBid(riderId: string, requestId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DeliveryRequest" WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.deliveryRequest.findUnique({ where: { id: requestId }, select: { status: true, trigger: true } });
    if (!req || req.trigger !== "POST_PACK") throw new BiddingError("NOT_FOUND", "Delivery request not found.", 404);
    const bid = await tx.riderBid.findUnique({
      where: { deliveryRequestId_riderId: { deliveryRequestId: requestId, riderId } },
      select: { id: true, status: true },
    });
    if (!bid || bid.status !== "PENDING") throw new BiddingError("NO_BID", "You have no open bid on this delivery.", 404);
    if (req.status !== "OPEN") throw new BiddingError("CLOSED", "The customer has already chosen a rider.", 409);
    await tx.riderBid.update({ where: { id: bid.id }, data: { status: "WITHDRAWN" } });
    return { bidId: bid.id, status: "WITHDRAWN" as const };
  });
}

// ---------------------------------------------------------------------------
// Customer side
// ---------------------------------------------------------------------------

async function findCustomerListOrder(customerId: string, orderNumber: string) {
  const order = await prisma.order.findFirst({
    where: { orderNumber, customerId },
    select: {
      id: true,
      orderNumber: true,
      orderStatus: true,
      deliveryFee: true,
      grandTotal: true,
      remainingAmount: true,
      deliveryFeePaymentStatus: true,
      itemList: { select: { id: true } },
      deliveryRequest: { select: { id: true, status: true } },
    },
  });
  // Cart orders have no after-packing bidding: same 404 as someone else's order.
  if (!order || !order.itemList) throw new BiddingError("NOT_FOUND", "Order not found.", 404);
  return order;
}

/** The customer's view of rider bids on their list order (no rider phone until accepted). */
export async function getOrderRiderBids(customerId: string, orderNumber: string) {
  const first = await findCustomerListOrder(customerId, orderNumber);
  if (first.deliveryRequest?.status === "OPEN") {
    await tickPostPackRequest(first.deliveryRequest.id).catch((e) => console.error("[post-pack:tick]", e));
  }
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: first.id },
    select: {
      orderNumber: true,
      orderStatus: true,
      deliveryFee: true,
      grandTotal: true,
      remainingAmount: true,
      deliveryFeePaymentStatus: true,
      rider: { select: { name: true, phone: true, vehicleType: true, photoUrl: true } },
      deliveryRequest: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          reopenCount: true,
          acceptedBidId: true,
          bids: {
            where: { status: { in: ["PENDING", "ACCEPTED"] } },
            orderBy: [{ amount: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              amount: true,
              status: true,
              note: true,
              createdAt: true,
              rider: {
                select: {
                  name: true,
                  vehicleType: true,
                  photoUrl: true,
                  _count: { select: { deliveries: { where: { deliveredAt: { not: null } } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  const req = order.deliveryRequest;
  const now = Date.now();
  return {
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    deliveryFee: req?.status === "ASSIGNED" ? Number(order.deliveryFee) : null,
    grandTotal: Number(order.grandTotal),
    remainingAmount: Number(order.remainingAmount),
    deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
    request: req
      ? {
          id: req.id,
          status: req.status,
          expiresAt: req.expiresAt,
          reopenCount: req.reopenCount,
          biddingOpen: req.status === "OPEN" && req.expiresAt.getTime() > now,
          /** No rider took it: MandiBazaar will assign one. */
          needsAdmin: req.status === "NO_BIDS",
        }
      : null,
    bids: (req?.bids ?? []).map((b) => ({
      id: b.id,
      amount: Number(b.amount),
      status: b.status,
      note: b.note,
      createdAt: b.createdAt,
      rider: {
        name: b.rider.name,
        vehicleType: b.rider.vehicleType,
        photoUrl: b.rider.photoUrl,
        completedDeliveries: b.rider._count.deliveries,
        /** Riders have no ratings yet. */
        rating: null as number | null,
      },
    })),
    /** Contact details only once the customer has chosen this rider. */
    assignedRider:
      req?.status === "ASSIGNED" && order.rider
        ? { name: order.rider.name, phone: order.rider.phone, vehicleType: order.rider.vehicleType, photoUrl: order.rider.photoUrl }
        : null,
  };
}

export const acceptRiderBidSchema = z.object({
  idempotencyKey: z
    .string({ error: "Missing request key" })
    .trim()
    .min(8, "Missing request key")
    .max(100, "Request key is too long"),
  /** The fee the customer saw; refused if the rider changed it since. */
  expectedAmount: z.coerce.number().positive().optional(),
});
export type AcceptRiderBidInput = z.infer<typeof acceptRiderBidSchema>;

export type AcceptRiderBidResult = {
  reused: boolean;
  orderNumber: string;
  orderStatus: string;
  bidId: string;
  deliveryFee: number;
  grandTotal: number;
  /** Cash the rider collects: products + delivery fee. */
  remainingAmount: number;
  deliveryFeePaymentStatus: string;
  rider: { name: string; phone: string; vehicleType: string };
  /** W9: the 4-digit code the customer gives the rider at the door. */
  deliveryCode: string | null;
};

/**
 * The customer accepts one rider's bid. One transaction with the order, the
 * request and the rider locked (in that order), so two accepts on one order or
 * one rider winning two orders at once can't both succeed (G-11, G-13).
 * Accepting the bid that already won returns the same result (idempotent).
 */
export async function acceptPostPackBid(
  actor: { id: string },
  orderNumber: string,
  bidId: string,
  input: AcceptRiderBidInput,
  meta: RequestMeta = {}
): Promise<AcceptRiderBidResult> {
  const order = await findCustomerListOrder(actor.id, orderNumber);
  if (!order.deliveryRequest) {
    throw new BiddingError("NOT_READY", "Riders can bid once the store has packed your order.", 409);
  }
  const requestId = order.deliveryRequest.id;
  if (order.deliveryRequest.status === "OPEN") {
    await tickPostPackRequest(requestId).catch((e) => console.error("[post-pack:tick]", e));
  }

  const out = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "DeliveryRequest" WHERE id = ${requestId} FOR UPDATE`;
      const req = await tx.deliveryRequest.findUniqueOrThrow({ where: { id: requestId } });
      const bid = await tx.riderBid.findFirst({
        where: { id: bidId, deliveryRequestId: requestId },
        include: { rider: { select: { id: true, name: true, phone: true, vehicleType: true, userId: true } } },
      });
      if (!bid) throw new BiddingError("BID_NOT_FOUND", "That bid is no longer available.", 404);
      if (req.status === "ASSIGNED" && req.acceptedBidId === bid.id) return { kind: "reused" as const, bid };
      if (req.status === "ASSIGNED") throw new BiddingError("ALREADY_ASSIGNED", "You have already chosen a rider for this order.", 409);
      if (req.status !== "OPEN") throw new BiddingError("CLOSED", "Rider bidding on this order is closed.", 409);
      if (bid.status !== "PENDING") throw new BiddingError("BID_UNAVAILABLE", "That bid is no longer available. Please choose another.", 409);
      if (input.expectedAmount != null && Math.abs(input.expectedAmount - Number(bid.amount)) > 0.009) {
        throw new BiddingError("BID_CHANGED", "The rider changed this bid. Please check it again.", 409);
      }

      const o = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { orderStatus: true, riderId: true, subtotal: true, discount: true, productAmountPaid: true, deliveryFeePaid: true, deliveryFee: true },
      });
      if (o.orderStatus !== OrderStatus.READY_FOR_DISPATCH || o.riderId) {
        throw new BiddingError("ORDER_CHANGED", "This order can't take a rider right now.", 409);
      }

      // Serialise per rider: a rider can't win two orders at the same moment (G-13).
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${bid.riderId} FOR UPDATE`;
      const eligibility = await riderBidEligibility(bid.riderId, tx);
      if (!eligibility.eligible) return { kind: "rider_gone" as const, bid };

      const fee = round2(Number(bid.amount));
      const productDue = round2(Number(o.subtotal) - Number(o.discount));
      const productRemaining = Math.max(0, round2(productDue - Number(o.productAmountPaid)));
      const feeRemaining = Math.max(0, round2(fee - Number(o.deliveryFeePaid)));

      await tx.deliveryRequest.update({
        where: { id: requestId },
        data: { status: "ASSIGNED", acceptedBidId: bid.id, acceptedRiderId: bid.riderId, acceptedFee: bid.amount },
      });
      await tx.riderBid.update({ where: { id: bid.id }, data: { status: "ACCEPTED" } });
      const losers = await tx.riderBid.findMany({
        where: { deliveryRequestId: requestId, id: { not: bid.id }, status: "PENDING" },
        select: { id: true, rider: { select: { userId: true } } },
      });
      await tx.riderBid.updateMany({ where: { id: { in: losers.map((l) => l.id) } }, data: { status: "REJECTED" } });

      // Plan decision 4: the delivery fee is paid in cash to the rider, with the products.
      const changed = await tx.order.updateMany({
        where: { id: order.id, orderStatus: OrderStatus.READY_FOR_DISPATCH, riderId: null },
        data: {
          deliveryFee: fee,
          grandTotal: round2(productDue + fee),
          remainingAmount: round2(productRemaining + feeRemaining),
          deliveryFeePaymentStatus: "CASH_ON_DELIVERY",
          riderId: bid.riderId,
          orderStatus: OrderStatus.ASSIGNED_TO_RIDER,
        },
      });
      if (changed.count !== 1) throw new BiddingError("ORDER_CHANGED", "This order can't take a rider right now.", 409);

      // Same Delivery row the admin "Assign rider" creates. riderFee stays empty: the
      // rider keeps the cash fee, and MARK_DELIVERED fixes the platform-owed part
      // (online-paid fee only, NEW-01) so the fee is never paid twice.
      const now = new Date();
      await tx.delivery.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, riderId: bid.riderId, assignedAt: now },
        update: { riderId: bid.riderId, assignedAt: now },
      });
      await syncFulfillmentsToOrderStatus(tx, order.id, OrderStatus.ASSIGNED_TO_RIDER);
      await recordStatusEvent(tx, {
        orderId: order.id,
        status: OrderStatus.ASSIGNED_TO_RIDER,
        actorId: actor.id,
        actorRole: "CUSTOMER",
        note: `Accepted ${bid.rider.name}'s delivery bid of Rs ${fee}`,
      });
      await recordRiderEarningLedger(tx, { orderId: order.id, riderId: bid.riderId, amount: fee, refId: bid.id });
      // W9: the customer's 4-digit delivery code (only its keyed hash is stored).
      const newCode = await issueDeliveryCodeOnAssign(tx, order.id);

      return {
        kind: "accepted" as const,
        bid,
        fee,
        newCode,
        loserUserIds: losers.map((l) => l.rider.userId).filter((v): v is string => !!v),
        previousFee: Number(o.deliveryFee),
      };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );

  if (out.kind === "rider_gone") {
    await prisma.riderBid.updateMany({ where: { id: out.bid.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw new BiddingError("RIDER_GONE", "That rider just became unavailable. Please choose another.", 409);
  }

  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: {
      id: true,
      orderNumber: true,
      orderStatus: true,
      deliveryFee: true,
      grandTotal: true,
      remainingAmount: true,
      deliveryFeePaymentStatus: true,
      deliveryAddressSnapshot: true,
      fulfillments: { select: { pickupAddress: true, store: { select: { id: true, ownerId: true, members: { select: { userId: true, isActive: true } } } } } },
    },
  });
  const result: AcceptRiderBidResult = {
    reused: out.kind === "reused",
    orderNumber: fresh.orderNumber,
    orderStatus: fresh.orderStatus,
    bidId: out.bid.id,
    deliveryFee: Number(fresh.deliveryFee),
    grandTotal: Number(fresh.grandTotal),
    remainingAmount: Number(fresh.remainingAmount),
    deliveryFeePaymentStatus: fresh.deliveryFeePaymentStatus,
    rider: { name: out.bid.rider.name, phone: out.bid.rider.phone, vehicleType: out.bid.rider.vehicleType },
    deliveryCode: (await customerDeliveryCodeView(order.id))?.code ?? null,
  };
  if (out.kind === "reused") return result;
  if (out.newCode) await sendDeliveryCodeToCustomer(order.id, out.newCode);

  await writeAuditLog({
    userId: actor.id,
    action: "RIDER_BID_ACCEPTED",
    entity: "Order",
    entityId: order.id,
    previousValue: { status: "READY_FOR_DISPATCH", deliveryFee: out.previousFee, riderId: null },
    newValue: {
      status: "ASSIGNED_TO_RIDER",
      orderNumber: fresh.orderNumber,
      requestId,
      bidId: out.bid.id,
      riderId: out.bid.riderId,
      deliveryFee: out.fee,
      grandTotal: result.grandTotal,
      rejected: out.loserUserIds.length,
      idempotencyKey: input.idempotencyKey,
    },
    ...meta,
  }).catch((e) => console.error("[post-pack:accept] audit", e));

  await notifyAfterRiderAccept(fresh, out.bid.rider, out.fee, out.loserUserIds, result).catch((e) =>
    console.error("[post-pack:accept] notify", e)
  );
  return result;
}

async function notifyAfterRiderAccept(
  order: {
    id: string;
    orderNumber: string;
    deliveryAddressSnapshot: Prisma.JsonValue;
    fulfillments: { pickupAddress: Prisma.JsonValue; store: { id: string; ownerId: string; members: { userId: string; isActive: boolean }[] } }[];
  },
  rider: { id: string; name: string; phone: string; userId: string | null },
  fee: number,
  loserUserIds: string[],
  result: AcceptRiderBidResult
) {
  // Winner: "your bid was accepted" + the usual assignment message with pickup, drop and cash.
  await notifyBidAccepted(rider.id, fee);
  const addr = (order.deliveryAddressSnapshot ?? {}) as Record<string, string | undefined>;
  await notifyRiderAssignment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    riderPhone: rider.phone,
    riderUserId: rider.userId,
    pickupLines: order.fulfillments.map((f) => {
      const p = (f.pickupAddress ?? {}) as { name?: string; addressLine?: string; city?: string };
      return `${p.name || "Store"} — ${p.addressLine || ""}, ${p.city || ""}`;
    }),
    dropAddress: [addr.fullName, addr.phone, addr.houseBuilding, addr.area, addr.city].filter(Boolean).join(", "),
    cashToCollect: result.remainingAmount,
  }).catch((e) => console.error("[post-pack:accept] rider assignment", e));

  for (const userId of loserUserIds) {
    await sendNotification({
      userId,
      type: "RIDER_BID_NOT_SELECTED",
      title: "Customer chose another rider",
      body: "The customer picked another rider for this delivery. Thanks for bidding.",
    }).catch(() => {});
  }

  await notifyOrderEvent(
    order.id,
    "ORDER_STATUS",
    "Rider assigned",
    `${rider.name} will deliver your order ${order.orderNumber}. Delivery fee ${formatCurrency(fee)}. Pay ${formatCurrency(result.remainingAmount)} in cash to the rider (products + delivery).`
  );

  for (const f of order.fulfillments) {
    for (const userId of storeRecipientIds(f.store)) {
      await sendNotification({
        userId,
        orderId: order.id,
        type: "RIDER_ASSIGNED_STORE",
        title: "Rider on the way",
        body: `${rider.name} will pick up order ${order.orderNumber}. Hand over the packed bag.`,
        metadata: { storeId: f.store.id },
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Timers: re-open once, then give up (G-14)
// ---------------------------------------------------------------------------

export type PostPackTick = "UNCHANGED" | "WAITING_FOR_CHOICE" | "REOPENED" | "GAVE_UP" | "CLOSED";

/** Close an open request (order cancelled or a rider assigned by admin). Safe inside a transaction. */
export async function closePostPackRequest(db: Db, orderId: string): Promise<number> {
  const req = await db.deliveryRequest.findFirst({
    where: { orderId, trigger: "POST_PACK", status: "OPEN" },
    select: { id: true },
  });
  if (!req) return 0;
  const r = await db.deliveryRequest.updateMany({ where: { id: req.id, status: "OPEN" }, data: { status: "CANCELLED" } });
  if (r.count) {
    await db.riderBid.updateMany({ where: { deliveryRequestId: req.id, status: "PENDING" }, data: { status: "REJECTED" } });
  }
  return r.count;
}

/** Advance one after-packing request if it is due. Safe to call often and in parallel. */
export async function tickPostPackRequest(requestId: string, now = new Date()): Promise<PostPackTick> {
  const req = await prisma.deliveryRequest.findUnique({
    where: { id: requestId },
    include: {
      order: { select: { id: true, orderNumber: true, orderStatus: true, riderId: true, customerId: true } },
      bids: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  if (!req || req.trigger !== "POST_PACK" || req.status !== "OPEN") return "CLOSED";
  if (!req.order || req.order.orderStatus !== OrderStatus.READY_FOR_DISPATCH || req.order.riderId) {
    if (req.order) await closePostPackRequest(prisma, req.order.id);
    else await prisma.deliveryRequest.updateMany({ where: { id: req.id, status: "OPEN" }, data: { status: "CANCELLED" } });
    return "CLOSED";
  }
  if (req.expiresAt.getTime() > now.getTime()) return "UNCHANGED";
  // Bids are waiting: the customer can still choose (bids are re-checked at accept).
  if (req.bids.length > 0) return "WAITING_FOR_CHOICE";

  if (req.reopenCount < POST_PACK_MAX_REOPENS) {
    const s = await getListSettings();
    const claimed = await prisma.deliveryRequest.updateMany({
      where: { id: req.id, status: "OPEN", reopenCount: req.reopenCount, expiresAt: req.expiresAt },
      data: {
        reopenCount: req.reopenCount + 1,
        expiresAt: new Date(now.getTime() + Math.max(30, s.postPackBidWindowSecs) * 1000),
      },
    });
    if (claimed.count !== 1) return "UNCHANGED";
    await writeAuditLog({
      action: "RIDER_BIDDING_REOPENED",
      entity: "DeliveryRequest",
      entityId: req.id,
      previousValue: { reopenCount: req.reopenCount },
      newValue: {
        reopenCount: req.reopenCount + 1,
        orderNumber: req.order.orderNumber,
        radiusKm: postPackRadiusKm(s.postPackRiderRadiusKm, req.reopenCount + 1),
      },
    }).catch(() => {});
    await notifyPostPackOpened(req.id, { reopened: true });
    return "REOPENED";
  }

  const r = await prisma.deliveryRequest.updateMany({
    where: { id: req.id, status: "OPEN", reopenCount: req.reopenCount, expiresAt: req.expiresAt },
    data: { status: "NO_BIDS" },
  });
  if (r.count !== 1) return "UNCHANGED";
  await writeAuditLog({
    action: "RIDER_BIDDING_NO_BIDS",
    entity: "DeliveryRequest",
    entityId: req.id,
    previousValue: { status: "OPEN", reopenCount: req.reopenCount },
    newValue: { status: "NO_BIDS", orderNumber: req.order.orderNumber },
  }).catch(() => {});
  await notifyNoRider(req.order).catch((e) => console.error("[post-pack:no-rider]", e));
  return "GAVE_UP";
}

async function notifyNoRider(order: { id: string; orderNumber: string; customerId: string }) {
  await sendNotification({
    userId: order.customerId,
    orderId: order.id,
    type: "RIDER_BIDDING_NO_BIDS",
    title: "Finding you a rider",
    body: `No rider has bid on order ${order.orderNumber} yet. MandiBazaar will assign a rider for you.`,
  }).catch(() => {});
  const stores = await prisma.storeFulfillment.findMany({
    where: { orderId: order.id },
    select: { store: { select: { id: true, ownerId: true, members: { select: { userId: true, isActive: true } } } } },
  });
  for (const { store } of stores) {
    for (const userId of storeRecipientIds(store)) {
      await sendNotification({
        userId,
        orderId: order.id,
        type: "RIDER_BIDDING_NO_BIDS",
        title: "No rider yet",
        body: `No rider has bid on order ${order.orderNumber}. MandiBazaar will assign one. Keep the bag ready.`,
        metadata: { storeId: store.id },
      }).catch(() => {});
    }
  }
  await notifySuperAdminsInApp({
    type: "ORDER_NEEDS_RIDER",
    title: "Needs rider",
    body: `No rider bid on list order ${order.orderNumber}. Assign a rider from the order page.`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
  });
}

/** Tick every after-packing request that may be due (cron + lazy sweeps). */
export async function tickDuePostPackRequests(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const due = await prisma.deliveryRequest.findMany({
    where: {
      trigger: "POST_PACK",
      status: "OPEN",
      OR: [
        { expiresAt: { lte: now }, bids: { none: { status: "PENDING" } } },
        { order: { OR: [{ orderStatus: { not: OrderStatus.READY_FOR_DISPATCH } }, { riderId: { not: null } }] } },
        { orderId: null },
      ],
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: opts.limit ?? 100,
  });
  const results: Record<PostPackTick, number> = { UNCHANGED: 0, WAITING_FOR_CHOICE: 0, REOPENED: 0, GAVE_UP: 0, CLOSED: 0 };
  for (const r of due) results[await tickPostPackRequest(r.id, now)]++;
  return { checked: due.length, ...results };
}
