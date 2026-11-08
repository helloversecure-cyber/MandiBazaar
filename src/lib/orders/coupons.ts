/**
 * Coupon validation, redemption and release (QA T1–T4, M6).
 * Pure rules live in `coupon-rules.ts`; this file gathers facts from the DB.
 *
 * Usage is counted when the order is placed (inside the order transaction) and
 * given back only when the order is cancelled before anything was paid
 * (`releaseCouponUsageForOrder`).
 */
import { Prisma, type Coupon } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { normalizePkMobile } from "@/lib/validators/pk";
import {
  evaluateCoupon,
  type CouponCustomerFacts,
  type CouponRecord,
  type CouponRejection,
  type CouponRejectionCode,
} from "@/lib/orders/coupon-rules";

type Db = Prisma.TransactionClient | typeof prisma;

export type CouponValidationResult =
  | { valid: true; discount: number; couponId: string; code: string; message: string }
  | {
      valid: false;
      error: string;
      reason: CouponRejectionCode;
      shortBy?: number;
      minimumOrder?: number;
    };

/** Delivery address used for the per-address / per-phone limit. */
export type CouponAddress = {
  houseBuilding?: string | null;
  area?: string | null;
  city?: string | null;
  phone?: string | null;
};

export class CouponError extends Error {
  rejection: CouponRejection;
  constructor(rejection: CouponRejection) {
    super(rejection.message);
    this.name = "CouponError";
    this.rejection = rejection;
  }
}

/** Order statuses that do not count as a "previous order" for first-order-only coupons. */
const NOT_A_REAL_ORDER = ["CANCELLED", "FAILED"] as const;

export function normalizeCouponCode(code: string): string {
  return String(code || "").trim().toUpperCase();
}

/** houseBuilding + area + city, lower-cased with collapsed spaces; null when incomplete. */
export function couponAddressKey(a: CouponAddress | null | undefined): string | null {
  if (!a) return null;
  const part = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const house = part(a.houseBuilding);
  const area = part(a.area);
  const city = part(a.city);
  if (!house || !city) return null;
  return `${house}|${area}|${city}`;
}

/** Digit-only forms a stored phone may have for this canonical 03XXXXXXXXX mobile. */
export function mobileDigitVariants(mobile: string): string[] {
  const n = normalizePkMobile(mobile);
  if (!n) return [];
  const rest = n.slice(1); // 3XXXXXXXXX
  return [n, `92${rest}`, rest, `0092${rest}`];
}

export function toCouponRecord(c: Coupon): CouponRecord {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: toNumber(c.value),
    minimumOrderAmount: c.minimumOrderAmount != null ? toNumber(c.minimumOrderAmount) : null,
    maximumDiscount: c.maximumDiscount != null ? toNumber(c.maximumDiscount) : null,
    startDate: c.startDate,
    expiryDate: c.expiryDate,
    usageLimit: c.usageLimit,
    perUserLimit: c.perUserLimit,
    firstOrderOnly: Boolean(c.firstOrderOnly),
    usedCount: c.usedCount,
    isActive: c.isActive,
  };
}

/** Case-insensitive look-up (codes are stored upper-case, legacy rows may not be). */
export async function findCouponByCode(db: Db, code: string): Promise<Coupon | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  const exact = await db.coupon.findUnique({ where: { code: normalized } });
  if (exact) return exact;
  return db.coupon.findFirst({ where: { code: { equals: normalized, mode: "insensitive" } } });
}

/** Users whose stored phone (any legacy format) is one of these mobiles. */
async function userIdsWithPhones(db: Db, mobiles: string[]): Promise<string[]> {
  const digits = Array.from(new Set(mobiles.flatMap(mobileDigitVariants)));
  if (!digits.length) return [];
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "User" WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(digits)}) LIMIT 50`
  );
  return rows.map((r) => r.id);
}

/**
 * Per-customer facts for a coupon:
 *  - uses by this account, by any account with the same phone, and by any order
 *    delivered to the same address or the same delivery phone (QA T4 split-order abuse);
 *  - whether this customer (or an account with the same phone) already has a real order.
 */
export async function gatherCouponCustomerFacts(
  db: Db,
  couponId: string,
  userId: string,
  address?: CouponAddress | null
): Promise<CouponCustomerFacts> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });

  const mobiles = [user?.phone, address?.phone]
    .map((p) => normalizePkMobile(p ?? ""))
    .filter((p): p is string => Boolean(p));
  const phoneSet = new Set(mobiles);
  const relatedUserIds = new Set<string>([userId, ...(await userIdsWithPhones(db, mobiles))]);
  const addrKey = couponAddressKey(address);

  const usages = await db.couponUsage.findMany({
    where: { couponId },
    select: { id: true, userId: true, orderId: true },
  });

  const orderIds = usages.map((u) => u.orderId).filter((id): id is string => Boolean(id));
  const orders = orderIds.length
    ? await db.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, deliveryAddressSnapshot: true },
      })
    : [];
  const snapshotById = new Map(orders.map((o) => [o.id, o.deliveryAddressSnapshot as CouponAddress | null]));

  let customerUses = 0;
  for (const u of usages) {
    if (relatedUserIds.has(u.userId)) {
      customerUses++;
      continue;
    }
    const snap = u.orderId ? snapshotById.get(u.orderId) : null;
    if (!snap) continue;
    if (addrKey && couponAddressKey(snap) === addrKey) {
      customerUses++;
      continue;
    }
    const snapPhone = normalizePkMobile(snap.phone ?? "");
    if (snapPhone && phoneSet.has(snapPhone)) customerUses++;
  }

  const previousOrders = await db.order.count({
    where: {
      customerId: { in: Array.from(relatedUserIds) },
      orderStatus: { notIn: [...NOT_A_REAL_ORDER] },
    },
  });

  return { customerUses, hasPreviousOrder: previousOrders > 0 };
}

/**
 * Verified-phone rule (owner decision): a customer whose phone is not verified
 * can't use coupons — enforced only when SMS is configured or in development, so
 * coupons keep working in production until Twilio is added.
 */
// Phone verification was removed (email verification is used instead); kept as a
// no-op so existing call sites stay unchanged.
export async function couponPhoneUnverified(): Promise<boolean> {
  return false;
}

function rejectionResult(r: CouponRejection): CouponValidationResult {
  return {
    valid: false,
    error: r.message,
    reason: r.code,
    shortBy: r.shortBy,
    minimumOrder: r.minimumOrder,
  };
}

/**
 * Check a coupon for a cart. `productsSubtotal` is the products total BEFORE any
 * discount and without delivery. Without `userId` the result is "Sign in to use
 * this coupon" (unless the code itself is invalid).
 */
export async function validateCoupon(
  code: string,
  productsSubtotal: number,
  userId?: string,
  opts?: { address?: CouponAddress | null; db?: Db; now?: Date }
): Promise<CouponValidationResult> {
  const db = opts?.db ?? prisma;
  const row = await findCouponByCode(db, code);
  if (!row) {
    return rejectionResult({ code: "NOT_FOUND", message: "This coupon code is not valid." });
  }
  const coupon = toCouponRecord(row);

  // Cheap checks first (no customer facts needed)
  const pre = evaluateCoupon(coupon, productsSubtotal, null, opts?.now);
  if (!pre.ok && pre.rejection.code !== "SIGN_IN") return rejectionResult(pre.rejection);
  if (!userId) return rejectionResult(pre.ok ? { code: "SIGN_IN", message: "Sign in to use this coupon." } : pre.rejection);

  const facts = {
    ...(await gatherCouponCustomerFacts(db, coupon.id, userId, opts?.address)),
    phoneUnverified: await couponPhoneUnverified(),
  };
  const result = evaluateCoupon(coupon, productsSubtotal, facts, opts?.now);
  if (!result.ok) return rejectionResult(result.rejection);

  return {
    valid: true,
    discount: result.discount,
    couponId: coupon.id,
    code: coupon.code,
    message: `Coupon applied — you saved Rs ${result.discount.toLocaleString("en-PK")}`,
  };
}

/**
 * Inside the order transaction, BEFORE the order row is created: lock the coupon
 * row (serialises concurrent redemptions), re-check every rule against fresh data
 * and return the discount. Throws CouponError with the customer-facing reason.
 */
export async function lockAndValidateCouponInTx(
  tx: Prisma.TransactionClient,
  opts: {
    code: string;
    productsSubtotal: number;
    userId: string;
    address?: CouponAddress | null;
  }
): Promise<{ couponId: string; code: string; discount: number }> {
  const found = await findCouponByCode(tx, opts.code);
  if (!found) throw new CouponError({ code: "NOT_FOUND", message: "This coupon code is not valid." });

  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Coupon" WHERE id = ${found.id} FOR UPDATE`);
  const fresh = await tx.coupon.findUnique({ where: { id: found.id } });
  if (!fresh) throw new CouponError({ code: "NOT_FOUND", message: "This coupon code is not valid." });

  const coupon = toCouponRecord(fresh);
  // Placement re-check includes the verified-phone rule
  const facts = {
    ...(await gatherCouponCustomerFacts(tx, coupon.id, opts.userId, opts.address)),
    phoneUnverified: await couponPhoneUnverified(),
  };
  const result = evaluateCoupon(coupon, opts.productsSubtotal, facts);
  if (!result.ok) throw new CouponError(result.rejection);
  return { couponId: coupon.id, code: coupon.code, discount: result.discount };
}

/**
 * Inside the order transaction, AFTER the order row is created: record the use
 * and increment usedCount atomically (guarded against the total limit).
 */
export async function recordCouponUsageInTx(
  tx: Prisma.TransactionClient,
  opts: { couponId: string; userId: string; orderId: string; discount: number }
) {
  const coupon = await tx.coupon.findUnique({
    where: { id: opts.couponId },
    select: { usageLimit: true },
  });
  if (!coupon) throw new CouponError({ code: "NOT_FOUND", message: "This coupon code is not valid." });

  const updated = await tx.coupon.updateMany({
    where: {
      id: opts.couponId,
      ...(coupon.usageLimit != null ? { usedCount: { lt: coupon.usageLimit } } : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new CouponError({ code: "USAGE_LIMIT", message: "This coupon has reached its usage limit." });
  }
  await tx.couponUsage.create({
    data: {
      couponId: opts.couponId,
      userId: opts.userId,
      orderId: opts.orderId,
      discount: opts.discount,
    },
  });
}

/**
 * Give a coupon back when an order is cancelled BEFORE any payment was made.
 * Call inside the cancel transaction (customer cancel, admin cancel, payment expiry,
 * failed payment start). Paid orders keep their coupon use (refund ≠ new coupon).
 * Idempotent: deletes the usage rows, so a second call releases nothing.
 */
export async function releaseCouponUsageForOrder(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ released: number; reason?: "PAID" | "NO_COUPON" }> {
  const usages = await tx.couponUsage.findMany({ where: { orderId } });
  if (!usages.length) return { released: 0, reason: "NO_COUPON" };

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      deliveryFeePaid: true,
      productAmountPaid: true,
      productPaymentStatus: true,
      payments: { where: { status: "SUCCESS" }, select: { id: true }, take: 1 },
    },
  });
  const paidSomething =
    !!order &&
    (toNumber(order.deliveryFeePaid) > 0 ||
      toNumber(order.productAmountPaid) > 0 ||
      order.productPaymentStatus === "PAID" ||
      order.productPaymentStatus === "PARTIALLY_PAID" ||
      order.payments.length > 0);
  if (paidSomething) return { released: 0, reason: "PAID" };

  let released = 0;
  for (const u of usages) {
    await tx.coupon.updateMany({
      where: { id: u.couponId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    await tx.couponUsage.delete({ where: { id: u.id } });
    released++;
  }
  return { released };
}
