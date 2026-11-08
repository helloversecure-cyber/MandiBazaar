import { OrderStatus } from "@prisma/client";

/** Valid order status transitions */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Rider bidding stage: customer accepts a bid → PENDING_PAYMENT, or abandons/expires → CANCELLED
  AWAITING_RIDER: [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
  PENDING_PAYMENT: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  PROCESSING: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.READY_FOR_DISPATCH, OrderStatus.CANCELLED],
  READY_FOR_DISPATCH: [OrderStatus.ASSIGNED_TO_RIDER, OrderStatus.CANCELLED],
  ASSIGNED_TO_RIDER: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.FAILED, OrderStatus.RETURNED],
  DELIVERED: [OrderStatus.RETURNED],
  CANCELLED: [],
  // FAILED is terminal (it's in TERMINAL_ORDER_STATUSES and admin next-statuses
  // exclude any edge out of it). No code performs a FAILED→retry transition.
  FAILED: [],
  RETURNED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid order status transition: ${from} → ${to}`);
  }
}

/** Every status the state machine allows next (never includes `from` itself). */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export type AdminTransitionContext = {
  orderStatus: OrderStatus;
  riderId?: string | null;
  /** COD amount still to collect from the customer */
  remainingAmount?: number;
  /** true when a CashCollection row already exists */
  cashCollected?: boolean;
};

export type AdminNextStatus = {
  status: OrderStatus;
  /** null when the admin may pick it from the status menu */
  blockedReason: string | null;
  /** Cancelling needs a reason typed by the admin */
  needsReason: boolean;
};

/**
 * Statuses the admin "Change status" menu may offer (QA P2 / ORD-07).
 * Always a subset of the state machine; some valid transitions are kept out of the
 * manual menu because another flow must do them:
 *  - PENDING_PAYMENT → CONFIRMED only happens when a payment is recorded
 *    (gateway callback or Payments → "Payment received"), otherwise the order
 *    would look paid while nothing was paid and store fulfilments stay unpaid.
 *  - FAILED → PENDING_PAYMENT is the customer's "Complete payment" retry.
 *  - → ASSIGNED_TO_RIDER is done with "Assign rider" (needs a rider).
 */
export function adminNextStatuses(ctx: AdminTransitionContext): AdminNextStatus[] {
  const out: AdminNextStatus[] = [];
  for (const status of nextStatuses(ctx.orderStatus)) {
    if (ctx.orderStatus === OrderStatus.PENDING_PAYMENT && status === OrderStatus.CONFIRMED) {
      continue;
    }
    if (ctx.orderStatus === OrderStatus.FAILED && status === OrderStatus.PENDING_PAYMENT) {
      continue;
    }
    if (status === OrderStatus.ASSIGNED_TO_RIDER) continue;
    let blockedReason: string | null = null;
    if (status === OrderStatus.OUT_FOR_DELIVERY && !ctx.riderId) {
      blockedReason = "Assign a rider first";
    }
    if (
      status === OrderStatus.DELIVERED &&
      (ctx.remainingAmount ?? 0) > 0 &&
      !ctx.cashCollected
    ) {
      blockedReason = "Record the cash collected first";
    }
    out.push({
      status,
      blockedReason,
      needsReason: status === OrderStatus.CANCELLED || status === OrderStatus.FAILED || status === OrderStatus.RETURNED,
    });
  }
  return out;
}

/** Can the admin assign (or re-assign) a rider in this status? */
export function canAssignRider(status: OrderStatus): boolean {
  return status === OrderStatus.READY_FOR_DISPATCH || status === OrderStatus.ASSIGNED_TO_RIDER;
}

/**
 * Server check for a manual admin status change. Returns an error message or null.
 */
export function validateAdminStatusChange(
  ctx: AdminTransitionContext,
  to: OrderStatus,
  opts: { riderId?: string | null; reason?: string | null } = {}
): string | null {
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, to)) {
    return "Unknown order status";
  }
  if (ctx.orderStatus === to) {
    return `Order is already ${ORDER_STATUS_LABELS[to]}`;
  }
  if (!canTransition(ctx.orderStatus, to)) {
    return `Cannot change a ${ORDER_STATUS_LABELS[ctx.orderStatus]} order to ${ORDER_STATUS_LABELS[to]}`;
  }
  if (to === OrderStatus.ASSIGNED_TO_RIDER) {
    return opts.riderId || ctx.riderId ? null : "Choose a rider to assign";
  }
  const allowed = adminNextStatuses(ctx).find((s) => s.status === to);
  if (!allowed) {
    if (ctx.orderStatus === OrderStatus.PENDING_PAYMENT && to === OrderStatus.CONFIRMED) {
      return "An unpaid order is confirmed only when its payment is recorded (Payments page or payment gateway)";
    }
    return `Cannot change a ${ORDER_STATUS_LABELS[ctx.orderStatus]} order to ${ORDER_STATUS_LABELS[to]} from here`;
  }
  if (allowed.blockedReason) return allowed.blockedReason;
  if (allowed.needsReason && !(opts.reason || "").trim()) {
    return "Please give a reason";
  }
  return null;
}

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
  OrderStatus.RETURNED,
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_RIDER: "Choosing a Rider",
  PENDING_PAYMENT: "Pending Payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  READY_FOR_DISPATCH: "Ready for Dispatch",
  ASSIGNED_TO_RIDER: "Assigned to Rider",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  RETURNED: "Returned",
};
