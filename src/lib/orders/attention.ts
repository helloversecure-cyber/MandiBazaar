import { OrderStatus, Prisma } from "@prisma/client";

/**
 * "Waiting too long" rules for the admin orders list and dashboard (QA P2, O6).
 * Pure so the thresholds are unit tested.
 */
export const WAIT_LIMITS = {
  /** paid order not yet moved by the store */
  preparingHours: 24,
  /** ready, no rider assigned */
  readyNoRiderHours: 2,
  /** with a rider but not delivered */
  withRiderHours: 6,
} as const;

const PREPARING: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
];
const WITH_RIDER: OrderStatus[] = [
  OrderStatus.ASSIGNED_TO_RIDER,
  OrderStatus.OUT_FOR_DELIVERY,
];

const H = 60 * 60 * 1000;

export function orderWaitingFlag(
  o: { orderStatus: OrderStatus; createdAt: Date | string; updatedAt: Date | string; riderId?: string | null },
  now: number,
  paymentTtlMinutes: number
): string | null {
  const created = new Date(o.createdAt).getTime();
  const updated = new Date(o.updatedAt).getTime();
  const hours = (ms: number) => Math.floor(ms / H);
  if (o.orderStatus === OrderStatus.PENDING_PAYMENT) {
    return now - created > paymentTtlMinutes * 60 * 1000
      ? `Unpaid for over ${paymentTtlMinutes} minutes`
      : null;
  }
  if (PREPARING.includes(o.orderStatus)) {
    return now - updated > WAIT_LIMITS.preparingHours * H
      ? `Not moved for ${hours(now - updated)} hours`
      : null;
  }
  if (o.orderStatus === OrderStatus.READY_FOR_DISPATCH && !o.riderId) {
    return now - updated > WAIT_LIMITS.readyNoRiderHours * H
      ? `Ready with no rider for ${hours(now - updated)} hours`
      : null;
  }
  if (WITH_RIDER.includes(o.orderStatus)) {
    return now - updated > WAIT_LIMITS.withRiderHours * H
      ? `With rider for ${hours(now - updated)} hours`
      : null;
  }
  return null;
}

/** Same rules as a Prisma filter (orders list "Waiting too long" filter). */
export function waitingTooLongWhere(now: number, paymentTtlMinutes: number): Prisma.OrderWhereInput {
  return {
    OR: [
      {
        orderStatus: OrderStatus.PENDING_PAYMENT,
        createdAt: { lt: new Date(now - paymentTtlMinutes * 60 * 1000) },
      },
      {
        orderStatus: { in: PREPARING },
        updatedAt: { lt: new Date(now - WAIT_LIMITS.preparingHours * H) },
      },
      {
        orderStatus: OrderStatus.READY_FOR_DISPATCH,
        riderId: null,
        updatedAt: { lt: new Date(now - WAIT_LIMITS.readyNoRiderHours * H) },
      },
      {
        orderStatus: { in: WITH_RIDER },
        updatedAt: { lt: new Date(now - WAIT_LIMITS.withRiderHours * H) },
      },
    ],
  };
}

/**
 * Phone to show in the admin customer column. Some old accounts hold junk (even the
 * person's name) in User.phone (QA P2/P10), so fall back to the delivery address phone.
 */
export function customerDisplayPhone(
  accountPhone: string | null | undefined,
  addressPhone: string | null | undefined,
  isValidPhone: (v: string) => boolean
): { phone: string | null; source: "account" | "address" | null; accountPhoneInvalid: boolean } {
  const acc = (accountPhone || "").trim();
  const addr = (addressPhone || "").trim();
  const accOk = !!acc && isValidPhone(acc);
  if (accOk) return { phone: acc, source: "account", accountPhoneInvalid: false };
  if (addr && isValidPhone(addr)) {
    return { phone: addr, source: "address", accountPhoneInvalid: !!acc };
  }
  return { phone: null, source: null, accountPhoneInvalid: !!acc };
}
