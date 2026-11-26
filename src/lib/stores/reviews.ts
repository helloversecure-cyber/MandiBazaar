/**
 * W9: customers rate the store after a delivered order (H-09 … H-11).
 *
 * One rating per order (StoreReview.orderId is unique). An item-list order has
 * one store. A cart order with several stores: the customer picks which store
 * the rating is for (`storeId`), and it is still one rating for that order.
 * The store's average and count come from these rows and show on the public
 * store list / store page and on the customer's offers screen.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { sendNotification } from "@/lib/notifications/service";
import { storeRecipientIds } from "@/lib/notifications/order-events";

type Db = Prisma.TransactionClient | typeof prisma;

export class StoreReviewError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "StoreReviewError";
  }
}

export const storeReviewSchema = z.object({
  orderId: z.string({ error: "Choose the order to rate" }).trim().min(1, "Choose the order to rate").max(64),
  storeId: z.string().trim().min(1).max(64).optional(),
  rating: z
    .number({ error: "Pick 1 to 5 stars" })
    .int({ error: "Pick 1 to 5 stars" })
    .min(1, "Pick 1 to 5 stars")
    .max(5, "Pick 1 to 5 stars"),
  comment: z
    .string()
    .max(1000, "Keep the comment under 1000 characters")
    .optional()
    .nullable()
    .transform((v) => {
      // eslint-disable-next-line no-control-regex
      const t = (v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
      return t || null;
    }),
});
export type StoreReviewInput = z.infer<typeof storeReviewSchema>;

export type StoreRating = { average: number | null; count: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Average (1 decimal) and count per store. Stores without ratings are absent. */
export async function storeRatings(storeIds: string[], db: Db = prisma): Promise<Map<string, StoreRating>> {
  const ids = Array.from(new Set(storeIds.filter(Boolean)));
  if (!ids.length) return new Map();
  const rows = await db.storeReview.groupBy({
    by: ["storeId"],
    where: { storeId: { in: ids } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(
    rows.map((r) => [
      r.storeId,
      { average: r._avg.rating != null ? round1(r._avg.rating) : null, count: r._count._all },
    ])
  );
}

export function ratingOf(map: Map<string, StoreRating>, storeId: string): StoreRating {
  return map.get(storeId) ?? { average: null, count: 0 };
}

function serialize(r: {
  id: string;
  orderId: string;
  storeId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  store?: { name: string } | null;
}) {
  return {
    id: r.id,
    orderId: r.orderId,
    storeId: r.storeId,
    storeName: r.store?.name ?? null,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
  };
}

/** The customer's own rating on their order (null if none or not theirs). */
export async function storeReviewForOrder(userId: string, orderId: string) {
  const r = await prisma.storeReview.findFirst({
    where: { orderId, userId },
    include: { store: { select: { name: true } } },
  });
  return r ? serialize(r) : null;
}

/** Lookup by order id or order number, for the customer's own order only. */
export async function findOwnStoreReview(userId: string, ref: { orderId?: string | null; orderNumber?: string | null }) {
  const order = await prisma.order.findFirst({
    where: {
      customerId: userId,
      ...(ref.orderId ? { id: ref.orderId } : { orderNumber: ref.orderNumber ?? "" }),
    },
    select: { id: true, orderNumber: true, orderStatus: true, items: { select: { storeId: true, storeName: true } } },
  });
  if (!order) throw new StoreReviewError("NOT_FOUND", "Order not found", 404);
  const review = await storeReviewForOrder(userId, order.id);
  const stores = uniqueStores(order.items);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    canRate: order.orderStatus === "DELIVERED" && !review,
    stores,
    review,
  };
}

function uniqueStores(items: { storeId: string; storeName: string }[]) {
  const m = new Map<string, string>();
  for (const i of items) if (!m.has(i.storeId)) m.set(i.storeId, i.storeName);
  return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
}

/** Save the customer's rating. 404 not theirs, 400 not delivered / bad store, 409 already rated. */
export async function createStoreReview(user: { id: string }, input: StoreReviewInput) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, customerId: user.id },
    select: {
      id: true,
      orderNumber: true,
      orderStatus: true,
      items: { select: { storeId: true, storeName: true } },
      storeReview: { select: { id: true } },
    },
  });
  if (!order) throw new StoreReviewError("NOT_FOUND", "Order not found", 404);
  if (order.orderStatus !== "DELIVERED") {
    throw new StoreReviewError("NOT_DELIVERED", "You can rate the store once the order is delivered", 400);
  }
  if (order.storeReview) throw new StoreReviewError("ALREADY_RATED", "You have already rated this order", 409);

  const stores = uniqueStores(order.items);
  let storeId = input.storeId;
  if (storeId) {
    if (!stores.some((s) => s.id === storeId)) {
      throw new StoreReviewError("BAD_STORE", "That store is not part of this order", 400);
    }
  } else if (stores.length === 1) {
    storeId = stores[0].id;
  } else {
    throw new StoreReviewError("STORE_REQUIRED", "This order has more than one store. Choose the store to rate", 400);
  }

  let review;
  try {
    review = await prisma.storeReview.create({
      data: { orderId: order.id, storeId, userId: user.id, rating: input.rating, comment: input.comment },
      include: { store: { select: { name: true, ownerId: true, members: { select: { userId: true, isActive: true } } } } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new StoreReviewError("ALREADY_RATED", "You have already rated this order", 409);
    }
    throw e;
  }

  await writeAuditLog({
    userId: user.id,
    action: "STORE_REVIEW_CREATED",
    entity: "StoreReview",
    entityId: review.id,
    newValue: { orderId: order.id, orderNumber: order.orderNumber, storeId, rating: input.rating },
  }).catch((e) => console.error("[store-review:audit]", e));

  const stars = `${input.rating} star${input.rating === 1 ? "" : "s"}`;
  for (const userId of storeRecipientIds(review.store)) {
    await sendNotification({
      userId,
      orderId: order.id,
      type: "STORE_REVIEW_NEW",
      title: "New store rating",
      body: `A customer rated your store ${stars} for order ${order.orderNumber}.${input.comment ? ` "${input.comment.slice(0, 140)}"` : ""}`,
      metadata: { storeId, rating: input.rating },
    }).catch((e) => console.error("[store-review:notify]", e));
  }

  const rating = ratingOf(await storeRatings([storeId]), storeId);
  return { ...serialize(review), storeRating: rating };
}
