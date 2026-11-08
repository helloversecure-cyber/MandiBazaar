/**
 * Store fulfillment rules (QA N2 / STO-05 / R7).
 *
 * A store may only prepare orders that are paid/confirmed and still open.
 * Steps a store can take on its part of an order:
 *   Confirmed → Processing → Packed → Ready for pickup
 * ("Mark ready" may skip the middle steps.) Riders / admin take it from there.
 *
 * Pure module (uses the order state machine read-only) — safe for client + tests.
 */
import { canTransition } from "@/lib/orders/state-machine";
import type { OrderStatus } from "@prisma/client";

export const STORE_FULFILLMENT_STEPS = [
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
] as const;
export type StoreFulfillmentTarget = "PROCESSING" | "PACKED" | "READY_FOR_DISPATCH";
export const STORE_FULFILLMENT_TARGETS: StoreFulfillmentTarget[] = [
  "PROCESSING",
  "PACKED",
  "READY_FOR_DISPATCH",
];

/** Order statuses in which the store may still work on its items. */
export const STORE_PREPARABLE_ORDER_STATUSES: OrderStatus[] = [
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
] as OrderStatus[];

const READY_OR_BEYOND = new Set<string>([
  "READY_FOR_DISPATCH",
  "ASSIGNED_TO_RIDER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);
const CLOSED = new Set<string>(["CANCELLED", "FAILED", "RETURNED"]);

export type FulfillmentContext = {
  orderStatus: string;
  productPaymentStatus?: string | null;
  deliveryFeePaymentStatus?: string | null;
  fulfillmentStatus: string;
};

export const STORE_FULFILLMENT_LABELS: Record<StoreFulfillmentTarget, string> = {
  PROCESSING: "Start preparing",
  PACKED: "Mark packed",
  READY_FOR_DISPATCH: "Mark ready for pickup",
};

/**
 * Why the store can't move this fulfillment to `target` (null = allowed).
 * Messages are shown to the store owner as-is.
 */
export function storeFulfillmentBlockReason(
  ctx: FulfillmentContext,
  target: string
): string | null {
  if (!(STORE_FULFILLMENT_TARGETS as string[]).includes(target)) {
    return "Stores can only mark orders as preparing, packed or ready for pickup";
  }
  const order = ctx.orderStatus;
  if (order === "PENDING_PAYMENT" || ctx.fulfillmentStatus === "PENDING_PAYMENT") {
    return "This order is not paid yet — wait until the payment is confirmed";
  }
  if (CLOSED.has(order) || CLOSED.has(ctx.fulfillmentStatus)) {
    return "This order was cancelled — don't prepare it";
  }
  if (ctx.productPaymentStatus === "REFUNDED" || ctx.productPaymentStatus === "FAILED") {
    return "This order's payment was refunded or failed — don't prepare it";
  }
  if (ctx.deliveryFeePaymentStatus === "REFUNDED") {
    return "This order was refunded — don't prepare it";
  }
  if (READY_OR_BEYOND.has(ctx.fulfillmentStatus) || READY_OR_BEYOND.has(order)) {
    return "This order is already ready for pickup";
  }
  if (!(STORE_PREPARABLE_ORDER_STATUSES as string[]).includes(order)) {
    return "This order can't be prepared in its current status";
  }

  const steps = STORE_FULFILLMENT_STEPS as readonly string[];
  const from = steps.indexOf(ctx.fulfillmentStatus);
  const to = steps.indexOf(target);
  if (from === -1) return "This order can't be prepared in its current status";
  if (to <= from) return "This step is already done";
  // Walk the state machine step by step (read-only use of canTransition).
  for (let i = from; i < to; i++) {
    if (!canTransition(steps[i] as OrderStatus, steps[i + 1] as OrderStatus)) {
      return "This step isn't allowed for this order";
    }
  }
  return null;
}

/** Store actions to show for a fulfillment (UI). Empty when nothing is allowed. */
export function storeFulfillmentActions(ctx: FulfillmentContext): StoreFulfillmentTarget[] {
  return STORE_FULFILLMENT_TARGETS.filter((t) => storeFulfillmentBlockReason(ctx, t) === null);
}

// ---------------------------------------------------------------------------
// Tabs on the store Orders page
// ---------------------------------------------------------------------------

export const STORE_ORDER_TABS = [
  { key: "prepare", label: "To prepare" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "unpaid", label: "Unpaid" },
  { key: "all", label: "All" },
] as const;
export type StoreOrderTab = (typeof STORE_ORDER_TABS)[number]["key"];

export function isStoreOrderTab(v: unknown): v is StoreOrderTab {
  return STORE_ORDER_TABS.some((t) => t.key === v);
}

/**
 * Prisma `where` for a StoreFulfillment list tab (pure object, no Prisma import).
 * Based mainly on the parent order's status, since that is the source of truth
 * for cancellation and payment.
 */
export function storeOrderTabWhere(tab: StoreOrderTab): Record<string, unknown> {
  switch (tab) {
    case "unpaid":
      return { order: { orderStatus: "PENDING_PAYMENT" } };
    case "prepare":
      return {
        order: { orderStatus: { in: ["CONFIRMED", "PROCESSING", "PACKED"] } },
        status: { in: ["PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "PACKED"] },
      };
    case "ready":
      return {
        order: {
          orderStatus: {
            in: ["CONFIRMED", "PROCESSING", "PACKED", "READY_FOR_DISPATCH", "ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"],
          },
        },
        status: { in: ["READY_FOR_DISPATCH", "ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"] },
      };
    case "completed":
      return { order: { orderStatus: "DELIVERED" } };
    case "cancelled":
      return { order: { orderStatus: { in: ["CANCELLED", "FAILED", "RETURNED"] } } };
    default:
      return {};
  }
}

/** Plain-words status for the store (based on order + fulfillment). */
export function storeOrderStatusLabel(orderStatus: string, fulfillmentStatus: string): string {
  if (orderStatus === "PENDING_PAYMENT") return "Unpaid — wait for payment";
  if (orderStatus === "CANCELLED") return "Cancelled";
  if (orderStatus === "FAILED") return "Delivery failed";
  if (orderStatus === "RETURNED") return "Returned";
  if (orderStatus === "DELIVERED") return "Delivered";
  if (orderStatus === "OUT_FOR_DELIVERY") return "Out for delivery";
  if (orderStatus === "ASSIGNED_TO_RIDER") return "Rider assigned";
  switch (fulfillmentStatus) {
    case "CONFIRMED":
      return "New — to prepare";
    case "PROCESSING":
      return "Preparing";
    case "PACKED":
      return "Packed";
    case "READY_FOR_DISPATCH":
      return "Ready for pickup";
    default:
      return fulfillmentStatus.replace(/_/g, " ").toLowerCase();
  }
}
