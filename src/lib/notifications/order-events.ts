/**
 * Which order events go out by SMS / email, to whom (pure, unit-tested).
 *
 * Callers keep using notifyOrderEvent(orderId, type, title, body). The customer
 * always gets the in-app notification; these rules decide the EXTRA messages.
 */

export type CustomerOrderEvent =
  | "CONFIRMED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";

export type ExtraChannel = "SMS" | "EMAIL";

/**
 * notifyOrderEvent `type` (+ the order's current status, + the newest refund's
 * status) → the customer event to send by SMS/email, or null (in-app only).
 */
export function customerEventFor(
  type: string,
  orderStatus: string | null | undefined,
  latestRefundStatus?: string | null
): CustomerOrderEvent | null {
  switch (type) {
    case "ORDER_CONFIRMED":
      return "CONFIRMED";
    case "ORDER_CANCELLED":
      return "CANCELLED";
    case "ORDER_STATUS":
      if (orderStatus === "OUT_FOR_DELIVERY") return "OUT_FOR_DELIVERY";
      if (orderStatus === "DELIVERED") return "DELIVERED";
      if (orderStatus === "CANCELLED") return "CANCELLED";
      return null;
    case "REFUND_UPDATE":
      return latestRefundStatus === "COMPLETED" ? "REFUNDED" : null;
    default:
      return null;
  }
}

/** Store owners / members are told about a new order when it becomes confirmed. */
export function notifyStoresFor(type: string): boolean {
  return type === "ORDER_CONFIRMED";
}

/** Channels to use for one recipient. Never "fake" a channel that is not configured. */
export function extraChannels(opts: {
  smsOn: boolean;
  emailOn: boolean;
  phone: string | null;
  email: string | null;
  allowEmail?: boolean;
}): ExtraChannel[] {
  const out: ExtraChannel[] = [];
  if (opts.smsOn && opts.phone) out.push("SMS");
  if ((opts.allowEmail ?? true) && opts.emailOn && opts.email) out.push("EMAIL");
  return out;
}

/** Notification.type used for the extra customer message (also the de-duplication key). */
export function customerExtraType(event: CustomerOrderEvent): string {
  return `CUSTOMER_ORDER_${event}`;
}

export const STORE_NEW_ORDER_TYPE = "STORE_NEW_ORDER";

/** Short plain-English customer text with the order number. */
export function customerEventMessage(
  event: CustomerOrderEvent,
  orderNumber: string
): { title: string; body: string } {
  switch (event) {
    case "CONFIRMED":
      return {
        title: "Order confirmed",
        body: `MandiBazaar: your order ${orderNumber} is confirmed. We'll let you know when it's on the way.`,
      };
    case "OUT_FOR_DELIVERY":
      return {
        title: "Out for delivery",
        body: `MandiBazaar: your order ${orderNumber} is out for delivery.`,
      };
    case "DELIVERED":
      return {
        title: "Delivered",
        body: `MandiBazaar: your order ${orderNumber} has been delivered. Thank you!`,
      };
    case "CANCELLED":
      return {
        title: "Order cancelled",
        body: `MandiBazaar: your order ${orderNumber} has been cancelled. Check the app for details.`,
      };
    case "REFUNDED":
      return {
        title: "Refund processed",
        body: `MandiBazaar: the refund for order ${orderNumber} has been processed.`,
      };
  }
}

/** "New order ORD-… — N items to prepare. Open your store portal." */
export function storeNewOrderMessage(orderNumber: string, itemCount: number): { title: string; body: string } {
  const n = Math.max(1, Math.round(itemCount));
  return {
    title: "New order",
    body: `New order ${orderNumber} — ${n} item${n === 1 ? "" : "s"} to prepare. Open your store portal.`,
  };
}

/** Owner + active members of a store, without duplicates. */
export function storeRecipientIds(store: {
  ownerId: string | null;
  members: { userId: string; isActive: boolean }[];
}): string[] {
  const ids = new Set<string>();
  if (store.ownerId) ids.add(store.ownerId);
  for (const m of store.members) if (m.isActive) ids.add(m.userId);
  return Array.from(ids);
}
