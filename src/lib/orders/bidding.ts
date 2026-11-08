/**
 * Rider bidding (InDrive-style delivery auction).
 *
 * Flow: at checkout the customer opens a DeliveryRequest for their cart → eligible
 * riders submit fee bids → the customer accepts one → the accepted bid becomes the
 * delivery fee AND the rider's earning, and that rider is assigned. Payment then
 * runs through the existing flow. All acceptance is concurrency-safe (one winner).
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { haversineKm, roundTripKm } from "@/lib/orders/delivery-fee";
import { isRiderEligibleForAssignment, riderBidEligibility } from "@/lib/riders/eligibility";
import { notifyBidAccepted } from "@/lib/notifications/bidding-events";

const DEFAULT_BID_WINDOW_SECS = 180;
const MAX_BID_AMOUNT = 10000; // sanity cap (PKR)

export class BiddingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BiddingError";
  }
}

export type DeliverySummary = {
  itemCount: number;
  storeCount: number;
  distanceKm: number;
  pickup: string[];
  drop: { city: string | null; area: string | null };
};

async function bidWindowSecs(): Promise<number> {
  const s = await prisma.storeSettings.findFirst({ select: { bidWindowSecs: true } });
  return s?.bidWindowSecs && s.bidWindowSecs > 0 ? s.bidWindowSecs : DEFAULT_BID_WINDOW_SECS;
}

/** Lightweight pickup/drop/distance snapshot for riders (no cart internals / prices). */
async function summarizeCart(userId: string, addressId: string): Promise<DeliverySummary | null> {
  const cart = await prisma.cart.findFirst({
    where: { userId },
    include: {
      items: {
        include: {
          product: {
            select: {
              store: { select: { id: true, name: true, city: true, area: true, latitude: true, longitude: true } },
            },
          },
        },
      },
    },
  });
  if (!cart || cart.items.length === 0) return null;

  const address = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: { city: true, area: true, latitude: true, longitude: true },
  });

  const stores = new Map<string, { name: string; city: string; area: string | null; latitude: number | null; longitude: number | null }>();
  for (const it of cart.items) {
    const s = it.product.store;
    if (s) stores.set(s.id, s);
  }

  const storeList = Array.from(stores.values());
  let oneWay = 0;
  if (address?.latitude != null && address?.longitude != null) {
    for (const s of storeList) {
      if (s.latitude != null && s.longitude != null) {
        oneWay += haversineKm(Number(address.latitude), Number(address.longitude), Number(s.latitude), Number(s.longitude));
      }
    }
  }

  return {
    itemCount: cart.items.reduce((n, i) => n + i.quantity, 0),
    storeCount: stores.size,
    distanceKm: Math.round(roundTripKm(oneWay) * 10) / 10,
    pickup: storeList.map((s) => s.area || s.city || s.name),
    drop: { city: address?.city ?? null, area: address?.area ?? null },
  };
}

/** Mark an OPEN request that has passed its deadline. Returns the (possibly updated) status. */
async function expireIfStale(req: { id: string; status: string; expiresAt: Date; bidCount?: number }) {
  if (req.status !== "OPEN" || req.expiresAt.getTime() > Date.now()) return req.status;
  const next = req.bidCount && req.bidCount > 0 ? "EXPIRED" : "NO_BIDS";
  await prisma.deliveryRequest.updateMany({
    where: { id: req.id, status: "OPEN" },
    data: { status: next as never },
  });
  return next;
}

/** Open (or refresh) the customer's delivery request for their current cart. */
export async function openDeliveryRequest(userId: string, addressId: string) {
  const summary = await summarizeCart(userId, addressId);
  if (!summary) throw new BiddingError("EMPTY_CART", "Your cart is empty.");

  const secs = await bidWindowSecs();
  const expiresAt = new Date(Date.now() + secs * 1000);

  // Opening a fresh auction means the customer changed their mind: cancel any
  // earlier ASSIGNED-but-unplaced request so a previously-chosen rider isn't left
  // committed to an order that never happens (and is freed to bid again).
  await prisma.deliveryRequest.updateMany({
    where: { customerId: userId, status: "ASSIGNED", orderId: null },
    data: { status: "CANCELLED" },
  });

  // One active request per customer: reuse an OPEN one, else start fresh.
  const existing = await prisma.deliveryRequest.findFirst({
    where: { customerId: userId, status: "OPEN", orderId: null },
    select: { id: true },
  });
  if (existing) {
    return prisma.deliveryRequest.update({
      where: { id: existing.id },
      data: { summary: summary as unknown as Prisma.InputJsonValue, expiresAt },
    });
  }
  const created = await prisma.deliveryRequest.create({
    data: {
      customerId: userId,
      status: "OPEN",
      expiresAt,
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  // Ping online riders so they can bid right away (best-effort, never blocks).
  void (async () => {
    try {
      const { notifyRidersOfNewRequest } = await import("@/lib/notifications/bidding-events");
      await notifyRidersOfNewRequest(created.id);
    } catch {
      /* non-blocking */
    }
  })();
  return created;
}

/** The customer's current request + its live bids (for the "choose your rider" step). */
export async function getCustomerRequest(userId: string) {
  const req = await prisma.deliveryRequest.findFirst({
    where: { customerId: userId, orderId: null, status: { in: ["OPEN", "ASSIGNED"] } },
    orderBy: { createdAt: "desc" },
    include: {
      bids: {
        where: { status: { in: ["PENDING", "ACCEPTED"] } },
        orderBy: { amount: "asc" },
        include: {
          rider: {
            select: {
              id: true,
              name: true,
              vehicleType: true,
              _count: { select: { deliveries: true } },
            },
          },
        },
      },
    },
  });
  if (!req) return null;

  const bidCount = req.bids.length;
  const status = await expireIfStale({ ...req, bidCount });

  return {
    id: req.id,
    status,
    expiresAt: req.expiresAt,
    summary: req.summary,
    acceptedFee: req.acceptedFee ? Number(req.acceptedFee) : null,
    acceptedRiderId: req.acceptedRiderId,
    bids: req.bids.map((b) => ({
      id: b.id,
      amount: Number(b.amount),
      status: b.status,
      note: b.note,
      rider: {
        id: b.rider.id,
        name: b.rider.name,
        vehicleType: b.rider.vehicleType,
        completedDeliveries: b.rider._count.deliveries,
      },
    })),
  };
}

/** OPEN requests a rider can bid on, with this rider's own bid (if any). */
export async function listRequestsForRider(riderId: string) {
  // Only riders who could actually win a bid see (and can act on) open requests.
  const eligibility = await riderBidEligibility(riderId);
  if (!eligibility.eligible) {
    return { eligible: false as const, reason: eligibility.reason, requests: [] };
  }
  const reqs = await prisma.deliveryRequest.findMany({
    where: { status: "OPEN", expiresAt: { gt: new Date() }, orderId: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { bids: { where: { riderId }, select: { id: true, amount: true, status: true } } },
  });
  return {
    eligible: true as const,
    reason: null,
    requests: reqs.map((r) => ({
      id: r.id,
      expiresAt: r.expiresAt,
      summary: r.summary,
      myBid: r.bids[0] ? { id: r.bids[0].id, amount: Number(r.bids[0].amount), status: r.bids[0].status } : null,
    })),
  };
}

/** A rider submits (or updates) their fee bid on an open request. */
export async function submitBid(opts: { riderId: string; requestId: string; amount: number; note?: string }) {
  const amount = Math.round(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BiddingError("BAD_AMOUNT", "Enter a valid delivery fee.");
  if (amount > MAX_BID_AMOUNT) throw new BiddingError("BAD_AMOUNT", "That delivery fee is too high.");

  const req = await prisma.deliveryRequest.findUnique({
    where: { id: opts.requestId },
    select: { status: true, expiresAt: true },
  });
  if (!req || req.status !== "OPEN") throw new BiddingError("CLOSED", "This delivery request is no longer open.");
  if (req.expiresAt.getTime() <= Date.now()) throw new BiddingError("EXPIRED", "This delivery request has expired.");

  const eligibility = await riderBidEligibility(opts.riderId);
  if (!eligibility.eligible) {
    const REASON_MSG: Record<string, string> = {
      NOT_APPROVED: "Your rider account is still under review — you can bid once MandiBazaar approves you.",
      SUSPENDED: "Your rider account is suspended. Please contact MandiBazaar support.",
      OFFLINE: "You're offline. Go online from your dashboard to bid.",
      BUSY: "You're on an active delivery. Finish it before bidding on new requests.",
      COD_OVERDUE: "You have overdue COD cash to remit. Settle it to take new deliveries.",
    };
    throw new BiddingError("INELIGIBLE", REASON_MSG[eligibility.reason] || "You can't bid right now.");
  }

  // Dedup via @@unique([deliveryRequestId, riderId]) — one active bid per rider.
  return prisma.riderBid.upsert({
    where: { deliveryRequestId_riderId: { deliveryRequestId: opts.requestId, riderId: opts.riderId } },
    create: {
      deliveryRequestId: opts.requestId,
      riderId: opts.riderId,
      amount,
      note: opts.note?.slice(0, 200),
      expiresAt: req.expiresAt,
      status: "PENDING",
    },
    update: { amount, note: opts.note?.slice(0, 200), status: "PENDING" },
  });
}

/**
 * Customer accepts a bid. Concurrency-safe: the request is atomically claimed
 * (OPEN → ASSIGNED); only one acceptance can win. Re-validates rider eligibility.
 */
export async function acceptBid(userId: string, bidId: string) {
  return prisma.$transaction(async (tx) => {
    const bid = await tx.riderBid.findUnique({
      where: { id: bidId },
      include: { deliveryRequest: { select: { id: true, customerId: true, status: true, expiresAt: true } } },
    });
    if (!bid || bid.deliveryRequest.customerId !== userId) {
      throw new BiddingError("NOT_FOUND", "That bid is no longer available.");
    }
    if (bid.deliveryRequest.status !== "OPEN") {
      throw new BiddingError("CLOSED", "This delivery request is already closed.");
    }
    // Accept must respect the bid window (submitBid does; accept did not before).
    if (bid.deliveryRequest.expiresAt.getTime() <= Date.now()) {
      await tx.deliveryRequest.updateMany({
        where: { id: bid.deliveryRequest.id, status: "OPEN" },
        data: { status: "EXPIRED" },
      });
      throw new BiddingError("EXPIRED", "This delivery request has expired. Please request riders again.");
    }
    // Serialise per rider so one rider can't win two auctions at the same instant.
    await tx.$queryRaw`SELECT id FROM "Rider" WHERE id = ${bid.riderId} FOR UPDATE`;
    if (!(await isRiderEligibleForAssignment(bid.riderId, tx))) {
      // Mark this bid dead so the customer re-picks.
      await tx.riderBid.update({ where: { id: bidId }, data: { status: "EXPIRED" } });
      throw new BiddingError("RIDER_GONE", "That rider just became unavailable. Please choose another.");
    }

    // Atomic claim — only one acceptBid can flip OPEN → ASSIGNED.
    const claimed = await tx.deliveryRequest.updateMany({
      where: { id: bid.deliveryRequest.id, status: "OPEN" },
      data: {
        status: "ASSIGNED",
        acceptedBidId: bid.id,
        acceptedRiderId: bid.riderId,
        acceptedFee: bid.amount,
      },
    });
    if (claimed.count !== 1) throw new BiddingError("RACE", "This request was just closed. Please try again.");

    await tx.riderBid.update({ where: { id: bid.id }, data: { status: "ACCEPTED" } });
    await tx.riderBid.updateMany({
      where: { deliveryRequestId: bid.deliveryRequest.id, id: { not: bid.id }, status: "PENDING" },
      data: { status: "REJECTED" },
    });

    return { riderId: bid.riderId, amount: Number(bid.amount), requestId: bid.deliveryRequest.id };
  }).then(async (result) => {
    // Best-effort, after commit: tell the winning rider their bid was accepted.
    await notifyBidAccepted(result.riderId, result.amount);
    return result;
  });
}

/** Customer cancels their open/assigned request (retry or abandon). */
export async function cancelRequest(userId: string, requestId: string) {
  await prisma.deliveryRequest.updateMany({
    where: { id: requestId, customerId: userId, orderId: null, status: { in: ["OPEN", "ASSIGNED"] } },
    data: { status: "CANCELLED" },
  });
}

/** For checkout: the customer's accepted (ASSIGNED) request, not yet linked to an
 *  order and still within the 30-minute acceptance grace window (older = stale). */
export async function getAcceptedRequestForCheckout(userId: string) {
  const req = await prisma.deliveryRequest.findFirst({
    where: {
      customerId: userId,
      status: "ASSIGNED",
      orderId: null,
      updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, acceptedRiderId: true, acceptedFee: true, summary: true },
  });
  if (!req || !req.acceptedRiderId || req.acceptedFee == null) return null;
  // summary is the snapshot the rider bid on (itemCount/storeCount/distanceKm) —
  // checkout uses it to confirm the order still matches before honoring the fee.
  return {
    requestId: req.id,
    riderId: req.acceptedRiderId,
    fee: Number(req.acceptedFee),
    summary: (req.summary ?? null) as {
      itemCount?: number;
      storeCount?: number;
      distanceKm?: number;
    } | null,
  };
}

/** Link the accepted request to the created order (called inside the checkout transaction). */
export async function linkRequestToOrder(
  tx: Prisma.TransactionClient,
  requestId: string,
  orderId: string
) {
  await tx.deliveryRequest.update({ where: { id: requestId }, data: { orderId } });
}

// ---------------------------------------------------------------------------
// Admin oversight
// ---------------------------------------------------------------------------

/** Read view of live delivery auctions for the Super Admin (open + recently assigned). */
export async function listDeliveryRequestsForAdmin() {
  const reqs = await prisma.deliveryRequest.findMany({
    where: { orderId: null, status: { in: ["OPEN", "ASSIGNED"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      bids: {
        orderBy: { amount: "asc" },
        include: { rider: { select: { id: true, name: true } } },
      },
    },
  });
  const customerIds = Array.from(new Set(reqs.map((r) => r.customerId)));
  const customers = await prisma.user.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, fullName: true, phone: true },
  });
  const custById = new Map(customers.map((c) => [c.id, c]));
  const now = Date.now();
  return reqs.map((r) => {
    const c = custById.get(r.customerId);
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      expired: r.status === "OPEN" && r.expiresAt.getTime() <= now,
      customer: c ? { name: c.fullName, phone: c.phone } : null,
      acceptedRiderId: r.acceptedRiderId,
      acceptedFee: r.acceptedFee != null ? Number(r.acceptedFee) : null,
      summary: r.summary,
      bids: r.bids.map((b) => ({
        id: b.id,
        riderId: b.riderId,
        riderName: b.rider?.name ?? null,
        amount: Number(b.amount),
        status: b.status,
      })),
    };
  });
}

/** Admin override: cancel a live delivery request (reject its bids). Not customer-scoped. */
export async function adminCancelRequest(requestId: string) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.deliveryRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, orderId: true },
    });
    if (!req) throw new BiddingError("NOT_FOUND", "That delivery request no longer exists.");
    if (req.orderId) throw new BiddingError("LINKED", "This request is already attached to an order.");
    if (req.status !== "OPEN" && req.status !== "ASSIGNED") {
      throw new BiddingError("CLOSED", "This request is already closed.");
    }
    await tx.deliveryRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
    await tx.riderBid.updateMany({
      where: { deliveryRequestId: requestId, status: { in: ["PENDING", "ACCEPTED"] } },
      data: { status: "REJECTED" },
    });
    return { ok: true };
  });
}
