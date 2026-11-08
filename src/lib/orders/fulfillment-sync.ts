import { OrderStatus, Prisma } from "@prisma/client";
import { canTransition } from "@/lib/orders/state-machine";

const READY_OR_BEYOND: OrderStatus[] = [
  OrderStatus.READY_FOR_DISPATCH,
  OrderStatus.ASSIGNED_TO_RIDER,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/**
 * After a store marks fulfillment ready, advance the parent order so admin
 * can assign a rider without babysitting intermediate statuses.
 */
export async function syncOrderAfterFulfillmentReady(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ status: OrderStatus; becameReady: boolean }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { fulfillments: true },
  });
  if (!order) {
    return { status: OrderStatus.CONFIRMED, becameReady: false };
  }

  const allReady =
    order.fulfillments.length > 0 &&
    order.fulfillments.every((f) => READY_OR_BEYOND.includes(f.status));

  const status = order.orderStatus;
  const becameReadyBefore = status === OrderStatus.READY_FOR_DISPATCH;

  if (!allReady) {
    if (canTransition(status, OrderStatus.PROCESSING)) {
      await tx.order.update({
        where: { id: orderId },
        data: { orderStatus: OrderStatus.PROCESSING },
      });
      return { status: OrderStatus.PROCESSING, becameReady: false };
    }
    return { status, becameReady: false };
  }

  const chain: OrderStatus[] = [
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.PACKED,
    OrderStatus.READY_FOR_DISPATCH,
  ];

  let cur = status;
  for (let i = 0; i < chain.length - 1; i++) {
    if (cur === chain[i] && canTransition(cur, chain[i + 1])) {
      await tx.order.update({
        where: { id: orderId },
        data: { orderStatus: chain[i + 1] },
      });
      cur = chain[i + 1];
    }
  }

  return {
    status: cur,
    becameReady: cur === OrderStatus.READY_FOR_DISPATCH && !becameReadyBefore,
  };
}

/** Forward order of the delivery pipeline (terminal states are handled separately). */
const PIPELINE: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
  OrderStatus.READY_FOR_DISPATCH,
  OrderStatus.ASSIGNED_TO_RIDER,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/**
 * Pure: which status a store fulfilment should have after the parent order moved to
 * `orderStatus`. Fulfilments only move forward (a store that already marked
 * "ready" is not pulled back to "processing"); terminal order states win.
 * Returns null when the fulfilment should be left alone.
 */
export function fulfillmentStatusFor(
  orderStatus: OrderStatus,
  fulfillmentStatus: OrderStatus
): OrderStatus | null {
  if (fulfillmentStatus === orderStatus) return null;
  if (
    orderStatus === OrderStatus.CANCELLED ||
    orderStatus === OrderStatus.FAILED ||
    orderStatus === OrderStatus.RETURNED
  ) {
    return orderStatus;
  }
  const o = PIPELINE.indexOf(orderStatus);
  const f = PIPELINE.indexOf(fulfillmentStatus);
  if (o < 0 || f < 0) return null; // fulfilment is terminal: leave it
  // Pick-up statuses are order-wide: the rider takes every store's bag
  if (o > f) return orderStatus;
  return null;
}

/**
 * Keep store fulfilment rows consistent with the order (QA P2: admin "Confirmed" while
 * the store portal still showed "Pending payment"). Call after every order status change.
 */
export async function syncFulfillmentsToOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  orderStatus: OrderStatus
): Promise<number> {
  const rows = await tx.storeFulfillment.findMany({
    where: { orderId },
    select: { id: true, status: true },
  });
  let changed = 0;
  for (const row of rows) {
    const next = fulfillmentStatusFor(orderStatus, row.status);
    if (!next) continue;
    await tx.storeFulfillment.update({
      where: { id: row.id },
      data: {
        status: next,
        ...(next === OrderStatus.READY_FOR_DISPATCH ? { readyAt: new Date() } : {}),
        ...(next === OrderStatus.OUT_FOR_DELIVERY ? { pickedUpAt: new Date() } : {}),
      },
    });
    changed++;
  }
  return changed;
}
