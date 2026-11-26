/**
 * Customer accepts one store's offer on their list → a normal Order (test cases
 * E-03 … E-12, E-14).
 *
 * In one transaction, with the list and its bids locked:
 *   - the chosen bid → ACCEPTED, the other open bids → NOT_SELECTED,
 *   - the list → ACCEPTED (acceptedBidId, orderId),
 *   - an Order + OrderItems (only the items the store has, at the store's prices)
 *     + one StoreFulfillment, CONFIRMED, products cash on delivery,
 *   - an OrderStatusEvent and the confirmed-order ledger snapshot (same as a COD
 *     cart order).
 *
 * The delivery fee is NOT known yet: nearby riders bid on it once the store marks
 * the order ready (W8). Until then the order has deliveryFee 0 with
 * deliveryFeePaymentStatus PENDING, and grandTotal is the products total only.
 *
 * Normal cart checkout (src/lib/orders/checkout.ts) is not used or changed.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/password-check";
import { recordOrderConfirmedLedger } from "@/lib/finance/ledger";
import { reserveStock } from "@/lib/inventory/stock";
import { assertListBiddingAllowed, ListError } from "@/lib/lists/service";
import { notifyOrderEvent, sendNotification } from "@/lib/notifications/service";
import { storeRecipientIds } from "@/lib/notifications/order-events";
import { minimumOrderStatus } from "@/lib/orders/cart-summary";
import { computeDeliveryFee, getDeliverySettings } from "@/lib/orders/delivery-fee";
import { recordStatusEvent } from "@/lib/orders/status-events";
import { formatCurrency, generateOrderNumber } from "@/lib/utils";

export const acceptOfferSchema = z.object({
  bidId: z.string({ error: "Choose an offer" }).min(1, "Choose an offer").max(40),
  addressId: z.string({ error: "Choose a delivery address" }).min(1, "Choose a delivery address").max(40),
  /** The list version the customer was looking at; refused if the list changed since. */
  listVersion: z.coerce.number().int().positive().optional(),
  /** The offer total the customer saw; refused if the store changed its prices since. */
  expectedTotal: z.coerce.number().nonnegative().optional(),
  idempotencyKey: z
    .string({ error: "Missing request key" })
    .trim()
    .min(8, "Missing request key")
    .max(100, "Request key is too long"),
});
export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;

type Actor = { id: string; email?: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AcceptOfferResult = {
  reused: boolean;
  listId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  storeId: string;
  storeName: string;
  subtotal: number;
  discount: number;
  /** Products total the customer pays the rider in cash. */
  productTotal: number;
  /** null until a rider's bid is accepted after packing (W8). */
  deliveryFee: number | null;
  deliveryFeePending: true;
  paymentMethod: string;
  productPaymentStatus: string;
  itemCount: number;
  /** List items the store didn't have, left out of the order (E-04). */
  droppedItems: string[];
};

/** Key stored on Order.idempotencyKey, scoped to the list so it can't collide with cart checkouts. */
const orderKey = (listId: string, key: string) => `list:${listId}:${key}`;

type OrderForResult = Prisma.OrderGetPayload<{ include: { items: true; itemList: { include: { lines: true } } } }>;

function toResult(order: OrderForResult, reused: boolean, droppedItems?: string[]): AcceptOfferResult {
  const first = order.items[0];
  const subtotal = Number(order.subtotal);
  const discount = Number(order.discount);
  let dropped = droppedItems;
  if (!dropped && order.itemList) {
    const kept = new Set(order.items.map((i) => i.sku));
    dropped = order.itemList.lines.filter((l) => !kept.has(listSku(l.id))).map((l) => l.name);
  }
  return {
    reused,
    listId: order.itemList?.id ?? "",
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    storeId: first?.storeId ?? "",
    storeName: first?.storeName ?? "",
    subtotal,
    discount,
    productTotal: round2(subtotal - discount),
    deliveryFee: null,
    deliveryFeePending: true,
    paymentMethod: order.paymentMethod,
    productPaymentStatus: order.productPaymentStatus,
    itemCount: order.items.length,
    droppedItems: dropped ?? [],
  };
}

/** SKU of an order item made from a list line (stable, lets us tell which lines made it in). */
const listSku = (lineId: string) => `LIST-${lineId}`;

async function findByKey(db: Prisma.TransactionClient | typeof prisma, key: string) {
  return db.order.findUnique({
    where: { idempotencyKey: key },
    include: { items: true, itemList: { include: { lines: true } } },
  });
}

/** Spread the store's discount over the items (by value), so each item's finalPrice is what the store is paid. */
function allocateDiscount(lineTotals: number[], discount: number): number[] {
  const sum = lineTotals.reduce((a, b) => a + b, 0);
  if (discount <= 0 || sum <= 0) return lineTotals.map(() => 0);
  let left = round2(discount);
  return lineTotals.map((t, i) => {
    if (i === lineTotals.length - 1) return left;
    const share = Math.min(left, round2((discount * t) / sum));
    left = round2(left - share);
    return share;
  });
}

export async function acceptOffer(
  actor: Actor,
  listId: string,
  input: AcceptOfferInput,
  meta: RequestMeta = {}
): Promise<AcceptOfferResult> {
  await assertListBiddingAllowed(actor);

  const owned = await prisma.itemList.findFirst({ where: { id: listId, customerId: actor.id }, select: { id: true } });
  if (!owned) throw new ListError("NOT_FOUND", "List not found.", 404);

  const key = orderKey(listId, input.idempotencyKey);
  const prior = await findByKey(prisma, key);
  if (prior) return toResult(prior, true);

  const addr = await prisma.address.findFirst({ where: { id: input.addressId, userId: actor.id } });
  if (!addr) throw new ListError("ADDRESS_NOT_FOUND", "Choose one of your saved addresses.", 404, "addressId");

  const deliverySettings = await getDeliverySettings();
  const addressSnapshot = {
    label: addr.label,
    fullName: addr.fullName,
    phone: addr.phone,
    houseBuilding: addr.houseBuilding,
    street: addr.street || undefined,
    area: addr.area,
    city: addr.city,
    province: addr.province,
    postalCode: addr.postalCode || undefined,
    nearbyLandmark: addr.nearbyLandmark || undefined,
    deliveryInstructions: addr.deliveryInstructions || undefined,
    latitude: addr.latitude,
    longitude: addr.longitude,
  };

  const run = () =>
    prisma.$transaction(async (tx) => {
      // Lock the list, then its bids: accepts, bids, edits and cancels on this list run one at a time.
      await tx.$queryRaw`SELECT id FROM "ItemList" WHERE id = ${listId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "StoreBid" WHERE "listId" = ${listId} FOR UPDATE`;

      // Same key, already done while we waited for the lock → same order.
      const done = await findByKey(tx, key);
      if (done) return { kind: "reused" as const, order: done };

      const list = await tx.itemList.findUniqueOrThrow({
        where: { id: listId },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (list.status === "ACCEPTED") {
        throw new ListError("ORDER_PLACED", "You already accepted an offer on this list.", 409);
      }
      if (list.status !== "BIDDING" || list.expiresAt.getTime() <= Date.now()) {
        throw new ListError("LIST_CLOSED", "This list is closed.", 409);
      }
      if (input.listVersion != null && input.listVersion !== list.version) {
        throw new ListError("LIST_CHANGED", "Your list has changed. Please review the offers again.", 409);
      }

      const bid = await tx.storeBid.findFirst({
        where: { id: input.bidId, listId },
        include: {
          lines: true,
          store: {
            select: {
              id: true,
              name: true,
              status: true,
              addressLine: true,
              city: true,
              latitude: true,
              longitude: true,
              ownerId: true,
              members: { select: { userId: true, isActive: true } },
            },
          },
        },
      });
      if (!bid) throw new ListError("OFFER_NOT_FOUND", "Offer not found.", 404, "bidId");
      if (bid.status !== "PENDING") {
        throw new ListError("OFFER_UNAVAILABLE", "This offer is no longer available.", 409, "bidId");
      }
      if (bid.listVersion !== list.version) {
        throw new ListError("OFFER_OUTDATED", "Store is updating this offer. Please wait or choose another.", 409, "bidId");
      }
      if (bid.store.status !== "APPROVED") {
        throw new ListError("STORE_UNAVAILABLE", "This store can't take orders right now. Please choose another offer.", 409, "bidId");
      }

      // Items the store has, at its prices (E-03); the rest are dropped (E-04).
      const answers = new Map(bid.lines.map((l) => [l.lineId, l]));
      const covered = list.lines.filter((l) => answers.get(l.id)?.available && answers.get(l.id)?.unitPrice != null);
      const droppedItems = list.lines.filter((l) => !covered.includes(l)).map((l) => l.name);
      if (!covered.length) throw new ListError("OFFER_UNAVAILABLE", "This offer has no items.", 409, "bidId");

      // Catalog lines that are this store's own product (no variants, enough stock) keep the product link and reserve stock.
      const productIds = covered.map((l) => l.productId).filter((v): v is string => !!v);
      const products = productIds.length
        ? await tx.product.findMany({
            where: { id: { in: productIds }, storeId: bid.storeId, status: "ACTIVE", variants: { none: {} } },
            select: { id: true, sku: true, stockQuantity: true, reservedStock: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } },
          })
        : [];
      const productBy = new Map(products.map((p) => [p.id, p]));

      const rows = covered.map((l) => {
        const unitPrice = Number(answers.get(l.id)!.unitPrice);
        const qty = Number(l.quantity);
        const whole = Number.isInteger(qty);
        const lineTotal = round2(unitPrice * qty);
        const p = l.productId ? productBy.get(l.productId) : undefined;
        const linked = !!p && whole && p.stockQuantity - p.reservedStock >= qty;
        return {
          line: l,
          productId: linked ? p!.id : null,
          imageUrl: linked ? p!.images[0]?.url ?? null : null,
          // OrderItem.quantity is a whole number: "1.5 kg" becomes 1 × "1.5 kg" at the line price.
          quantity: whole ? qty : 1,
          unit: whole ? l.unit : `${qty} ${l.unit}`,
          unitPrice: whole ? unitPrice : lineTotal,
          lineTotal,
        };
      });

      const subtotal = round2(rows.reduce((s, r) => s + r.lineTotal, 0));
      const discount = Math.min(round2(Number(bid.discount)), subtotal);
      const productTotal = round2(subtotal - discount);
      if (input.expectedTotal != null && Math.abs(input.expectedTotal - productTotal) > 0.009) {
        throw new ListError("OFFER_CHANGED", "The store changed this offer. Please review it again.", 409, "bidId");
      }

      // E-12: same minimum order rule and message as checkout (on the products subtotal).
      const minimum = minimumOrderStatus(subtotal, deliverySettings.minimumOrderAmount);
      if (!minimum.met) throw new ListError("MIN_ORDER", minimum.message || "Minimum order not met", 400);

      const itemDiscounts = allocateDiscount(rows.map((r) => r.lineTotal), discount);
      const distance = computeDeliveryFee(
        {
          city: addr.city,
          area: addr.area,
          latitude: addr.latitude,
          longitude: addr.longitude,
          productsSubtotal: subtotal,
          stores: [{ storeId: bid.store.id, latitude: bid.store.latitude, longitude: bid.store.longitude, city: bid.store.city }],
        },
        deliverySettings
      );

      // E-08: same order-number generator as checkout.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const countToday = await tx.order.count({ where: { createdAt: { gte: todayStart } } });

      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(countToday + 1),
          customerId: actor.id,
          subtotal,
          discount,
          // Set when the customer accepts a rider's bid after packing (W8).
          deliveryFee: 0,
          deliveryDistanceKm: distance.basis === "DISTANCE" ? distance.distanceKm : null,
          grandTotal: productTotal,
          remainingAmount: productTotal,
          paymentMethod: "CASH_ON_DELIVERY",
          deliveryFeePaymentStatus: "PENDING",
          productPaymentStatus: "CASH_ON_DELIVERY",
          orderStatus: "CONFIRMED",
          notes: list.note,
          idempotencyKey: key,
          deliveryAddressSnapshot: addressSnapshot,
          items: {
            create: rows.map((r, i) => ({
              storeId: bid.storeId,
              storeName: bid.store.name,
              productId: r.productId,
              productName: r.line.name,
              sku: listSku(r.line.id),
              unit: r.unit,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              discount: itemDiscounts[i],
              finalPrice: round2(r.lineTotal - itemDiscounts[i]),
              imageUrl: r.imageUrl,
            })),
          },
        },
      });

      await tx.storeFulfillment.create({
        data: {
          orderId: order.id,
          storeId: bid.storeId,
          status: "CONFIRMED",
          subtotal: productTotal,
          itemCount: rows.reduce((s, r) => s + r.quantity, 0),
          pickupAddress: {
            name: bid.store.name,
            addressLine: bid.store.addressLine,
            city: bid.store.city,
            latitude: bid.store.latitude,
            longitude: bid.store.longitude,
          },
        },
      });

      for (const r of rows) {
        if (!r.productId) continue;
        await reserveStock(tx, { productId: r.productId, quantity: r.quantity, orderId: order.id, createdById: actor.id });
      }

      await tx.storeBid.update({ where: { id: bid.id }, data: { status: "ACCEPTED" } });
      const losers = await tx.storeBid.findMany({
        where: { listId, status: "PENDING", id: { not: bid.id } },
        select: { id: true, storeId: true },
      });
      await tx.storeBid.updateMany({
        where: { id: { in: losers.map((b) => b.id) } },
        data: { status: "NOT_SELECTED" },
      });
      await tx.itemList.update({
        where: { id: listId },
        data: { status: "ACCEPTED", acceptedBidId: bid.id, orderId: order.id },
      });

      await recordStatusEvent(tx, {
        orderId: order.id,
        status: "CONFIRMED",
        actorId: actor.id,
        actorRole: "CUSTOMER",
        note: `Accepted bid from ${bid.store.name}`,
      });
      await recordOrderConfirmedLedger(tx, order.id);

      const full = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, itemList: { include: { lines: true } } },
      });
      return {
        kind: "created" as const,
        order: full,
        droppedItems,
        winner: bid.store,
        bidId: bid.id,
        loserStoreIds: losers.map((b) => b.storeId),
        previousVersion: list.version,
      };
    }, { maxWait: 10_000, timeout: 20_000 });

  // Two different lists accepted at the same moment can draw the same order number; retry.
  let out: Awaited<ReturnType<typeof run>> | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      out = await run();
      break;
    } catch (e) {
      const unique = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!unique || attempt >= 3) throw e;
      const again = await findByKey(prisma, key);
      if (again) return toResult(again, true);
    }
  }

  if (out.kind === "reused") return toResult(out.order, true);

  const { order, winner, loserStoreIds, droppedItems, bidId } = out;
  const result = toResult(order, false, droppedItems);

  await writeAuditLog({
    userId: actor.id,
    action: "LIST_OFFER_ACCEPTED",
    entity: "ItemList",
    entityId: listId,
    previousValue: { status: "BIDDING", version: out.previousVersion },
    newValue: {
      status: "ACCEPTED",
      bidId,
      storeId: winner.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      productTotal: result.productTotal,
      items: result.itemCount,
      dropped: droppedItems.length,
      notSelected: loserStoreIds.length,
    },
    ...meta,
  }).catch((e) => console.error("[lists:accept] audit", e));

  await notifyAfterAccept({ listId, orderId: order.id, orderNumber: order.orderNumber, winner, loserStoreIds, result }).catch((e) =>
    console.error("[lists:accept] notify", e)
  );

  return result;
}

async function notifyAfterAccept(opts: {
  listId: string;
  orderId: string;
  orderNumber: string;
  winner: { id: string; ownerId: string; members: { userId: string; isActive: boolean }[] };
  loserStoreIds: string[];
  result: AcceptOfferResult;
}) {
  const { listId, orderId, orderNumber, winner, loserStoreIds, result } = opts;
  const n = result.itemCount;

  // Winning store (in-app + push via sendNotification).
  for (const userId of storeRecipientIds(winner)) {
    await sendNotification({
      userId,
      orderId,
      type: "BID_ACCEPTED",
      title: "Customer accepted your bid",
      body: `Order ${orderNumber}: ${n} item${n === 1 ? "" : "s"} for ${formatCurrency(result.productTotal)}. Start preparing it in your store portal.`,
      metadata: { listId, storeId: winner.id },
    }).catch(() => {});
  }

  // Stores whose offers weren't chosen.
  if (loserStoreIds.length) {
    const losers = await prisma.store.findMany({
      where: { id: { in: loserStoreIds } },
      select: { id: true, ownerId: true, members: { select: { userId: true, isActive: true } } },
    });
    for (const s of losers) {
      for (const userId of storeRecipientIds(s)) {
        await sendNotification({
          userId,
          type: "BID_NOT_SELECTED",
          title: "Your offer wasn't chosen",
          body: "The customer chose another store's offer for this list. Thanks for bidding.",
          metadata: { listId, storeId: s.id },
        }).catch(() => {});
      }
    }
  }

  // Customer: the normal "order confirmed" message (in-app, push, SMS/email when configured);
  // this also sends the store the usual "New order" message.
  const dropped = result.droppedItems.length;
  await notifyOrderEvent(
    orderId,
    "ORDER_CONFIRMED",
    "Order placed",
    `Your order ${orderNumber} from ${result.storeName} is confirmed. Pay ${formatCurrency(result.productTotal)} for the products in cash to the rider.` +
      (dropped ? ` ${dropped} item${dropped === 1 ? "" : "s"} the store didn't have ${dropped === 1 ? "was" : "were"} left out.` : "") +
      " You'll choose a rider and the delivery fee once the store has packed your order."
  );
}
