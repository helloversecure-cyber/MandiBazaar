/**
 * W9: 4-digit delivery code for item-list orders (test cases H-01 … H-05).
 *
 * When a rider is assigned to an order that started as an item list, the
 * customer gets a 4-digit code. The rider must enter it to mark the order
 * delivered. Cart orders keep today's flow (no code).
 *
 * Storage: the database never holds the code. `Order.deliveryCodeHash` is
 * `v1.<nonce>.<hmac>`: the code is derived from the nonce with a server secret
 * (so the customer's order page can show it again), and checked against the
 * HMAC. Someone with only the database can't recover or brute-force it offline.
 * The field is also left out of every Order read by default (src/lib/db.ts), so
 * no rider, store or admin JSON ever carries it.
 *
 * Wrong codes: 400 each; the 5th wrong try locks the code for 15 minutes and
 * alerts the admins (H-04). Admin fallbacks: reset the code (new code, lock
 * cleared, read it to the customer by phone) or mark the order delivered.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { sendNotification, notifySuperAdminsInApp, smsConfigured } from "@/lib/notifications/service";
import { normalizePkMobile } from "@/lib/validators/pk";

export const DELIVERY_CODE_LENGTH = 4;
export const DELIVERY_CODE_MAX_ATTEMPTS = 5;
export const DELIVERY_CODE_LOCK_MINUTES = 15;

type Db = Prisma.TransactionClient | typeof prisma;

export class DeliveryCodeError extends Error {
  constructor(
    public code: "CODE_REQUIRED" | "CODE_WRONG" | "CODE_LOCKED" | "NO_CODE",
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "DeliveryCodeError";
  }
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "discount-price-dev-secret-change-in-production";
}

function hmac(parts: string[]): Buffer {
  return createHmac("sha256", secret()).update(parts.join("|")).digest();
}

/** The code that belongs to this order and nonce (same inputs → same code). */
function deriveCode(orderId: string, nonce: string): string {
  const n = hmac(["delivery-code", orderId, nonce]).readUInt32BE(0) % 10 ** DELIVERY_CODE_LENGTH;
  return String(n).padStart(DELIVERY_CODE_LENGTH, "0");
}

function checkValue(orderId: string, code: string): string {
  return hmac(["delivery-code-check", orderId, code]).toString("hex");
}

function parseStored(stored: string | null | undefined): { nonce: string; check: string } | null {
  if (!stored) return null;
  const [v, nonce, check] = stored.split(".");
  if (v !== "v1" || !nonce || !check) return null;
  return { nonce, check };
}

/** New stored value + the plain code (the code is only returned, never saved). */
export function makeDeliveryCode(orderId: string): { stored: string; code: string } {
  const nonce = randomBytes(12).toString("hex");
  const code = deriveCode(orderId, nonce);
  return { stored: `v1.${nonce}.${checkValue(orderId, code)}`, code };
}

/** The customer's code for display, from the stored value. */
export function readDeliveryCode(orderId: string, stored: string | null | undefined): string | null {
  const p = parseStored(stored);
  return p ? deriveCode(orderId, p.nonce) : null;
}

export function deliveryCodeMatches(orderId: string, stored: string | null | undefined, input: string): boolean {
  const p = parseStored(stored);
  if (!p) return false;
  const a = Buffer.from(checkValue(orderId, input), "hex");
  const b = Buffer.from(p.check, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only digits, exactly 4. Anything else counts as a wrong code. */
export function normalizeDeliveryCode(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s.length === DELIVERY_CODE_LENGTH && /^\d+$/.test(s) ? s : null;
}

async function readStored(db: Db, orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      orderStatus: true,
      deliveryCodeHash: true,
      deliveryCodeAttempts: true,
      deliveryCodeLockedUntil: true,
      itemList: { select: { id: true } },
    },
  });
}

/** True when this order needs the code before it can be marked delivered. */
export async function orderRequiresDeliveryCode(db: Db, orderId: string): Promise<boolean> {
  const n = await db.order.count({ where: { id: orderId, deliveryCodeHash: { not: null } } });
  return n > 0;
}

/** Ids (of the given ones) that need a delivery code. */
export async function ordersRequiringDeliveryCode(db: Db, orderIds: string[]): Promise<Set<string>> {
  if (!orderIds.length) return new Set();
  const rows = await db.order.findMany({
    where: { id: { in: orderIds }, deliveryCodeHash: { not: null } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Give an item-list order its code when a rider is assigned. Inside the
 * assigning transaction. Cart orders and orders that already have a code (a
 * re-assigned rider) are left alone. Returns the new code, or null.
 */
export async function issueDeliveryCodeOnAssign(tx: Db, orderId: string): Promise<string | null> {
  const o = await readStored(tx, orderId);
  if (!o || !o.itemList || o.deliveryCodeHash) return null;
  const { stored, code } = makeDeliveryCode(orderId);
  const changed = await tx.order.updateMany({
    where: { id: orderId, deliveryCodeHash: null },
    data: { deliveryCodeHash: stored, deliveryCodeAttempts: 0, deliveryCodeLockedUntil: null },
  });
  return changed.count === 1 ? code : null;
}

/**
 * Tell the customer the code: in-app (the body is kept out of the database and
 * off the lock screen; the order page shows the code) and SMS when set up. Best
 * effort, after the assigning transaction.
 */
export async function sendDeliveryCodeToCustomer(orderId: string, code: string, opts: { reset?: boolean } = {}) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, customerId: true, customer: { select: { phone: true, isActive: true } } },
  });
  if (!o) return;
  const title = opts.reset ? "New delivery code" : "Your delivery code";
  const body = `Delivery code for order ${o.orderNumber}: ${code}. Give it to the rider only when you have your order.`;
  try {
    await sendNotification({
      userId: o.customerId,
      orderId: o.id,
      type: "DELIVERY_CODE",
      title,
      body,
      sensitive: true,
      metadata: { orderNumber: o.orderNumber },
    });
    const phone = normalizePkMobile(o.customer?.phone ?? "");
    if (o.customer?.isActive && phone && smsConfigured()) {
      await sendNotification({
        userId: o.customerId,
        orderId: o.id,
        type: "DELIVERY_CODE",
        title,
        body,
        channel: NotificationChannel.SMS,
        phone,
        sensitive: true,
        requireProvider: true,
      });
    }
  } catch (e) {
    console.error("[delivery-code:notify]", e instanceof Error ? e.message : e);
  }
}

/** Customer's view of the code on their own order (null when there is none or it is used). */
export async function customerDeliveryCodeView(orderId: string) {
  const o = await readStored(prisma, orderId);
  if (!o?.deliveryCodeHash) return null;
  const active = ["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"].includes(o.orderStatus);
  return {
    required: true,
    code: active ? readDeliveryCode(o.id, o.deliveryCodeHash) : null,
    used: o.orderStatus === "DELIVERED",
    lockedUntil: lockActive(o.deliveryCodeLockedUntil) ? o.deliveryCodeLockedUntil : null,
  };
}

function lockActive(until: Date | null | undefined, now = new Date()) {
  return !!until && until.getTime() > now.getTime();
}

/**
 * Check a code the rider typed. Counts wrong tries under a row lock; the 5th
 * wrong try locks it for 15 minutes (audited, admins alerted). A right code
 * clears the counter. Throws DeliveryCodeError; returns normally when right,
 * or when the order needs no code.
 */
export async function verifyDeliveryCode(opts: {
  orderId: string;
  input: unknown;
  actorUserId: string;
  riderId: string;
}): Promise<{ required: boolean }> {
  const now = new Date();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${opts.orderId} FOR UPDATE`;
    const o = await readStored(tx, opts.orderId);
    if (!o?.deliveryCodeHash) return { kind: "none" as const };
    if (lockActive(o.deliveryCodeLockedUntil, now)) {
      return { kind: "locked" as const, until: o.deliveryCodeLockedUntil!, o };
    }
    const code = normalizeDeliveryCode(opts.input);
    if (opts.input == null || opts.input === "") return { kind: "missing" as const };
    if (code && deliveryCodeMatches(o.id, o.deliveryCodeHash, code)) {
      if (o.deliveryCodeAttempts !== 0 || o.deliveryCodeLockedUntil) {
        await tx.order.update({ where: { id: o.id }, data: { deliveryCodeAttempts: 0, deliveryCodeLockedUntil: null } });
      }
      return { kind: "ok" as const };
    }
    // An expired lock starts a fresh count.
    const prior = o.deliveryCodeLockedUntil ? 0 : o.deliveryCodeAttempts;
    const attempts = prior + 1;
    if (attempts >= DELIVERY_CODE_MAX_ATTEMPTS) {
      const until = new Date(now.getTime() + DELIVERY_CODE_LOCK_MINUTES * 60_000);
      await tx.order.update({
        where: { id: o.id },
        data: { deliveryCodeAttempts: attempts, deliveryCodeLockedUntil: until },
      });
      return { kind: "now_locked" as const, until, attempts, o };
    }
    await tx.order.update({
      where: { id: o.id },
      data: { deliveryCodeAttempts: attempts, deliveryCodeLockedUntil: null },
    });
    return { kind: "wrong" as const, attempts, o };
  });

  if (out.kind === "none") return { required: false };
  if (out.kind === "ok") return { required: true };
  if (out.kind === "missing") {
    throw new DeliveryCodeError("CODE_REQUIRED", "Ask the customer for the 4-digit delivery code and enter it", 400);
  }
  if (out.kind === "locked") {
    throw new DeliveryCodeError(
      "CODE_LOCKED",
      `Too many wrong codes. Try again after ${minutesLeft(out.until, now)} min or call MandiBazaar support.`,
      429,
      { lockedUntil: out.until }
    );
  }

  await writeAuditLog({
    userId: opts.actorUserId,
    action: out.kind === "now_locked" ? "DELIVERY_CODE_LOCKED" : "DELIVERY_CODE_WRONG",
    entity: "Order",
    entityId: opts.orderId,
    newValue: {
      orderNumber: out.o.orderNumber,
      riderId: opts.riderId,
      attempts: out.attempts,
      ...(out.kind === "now_locked" ? { lockedUntil: out.until } : {}),
    },
  }).catch((e) => console.error("[delivery-code:audit]", e));

  if (out.kind === "now_locked") {
    await notifySuperAdminsInApp({
      type: "DELIVERY_CODE_LOCKED",
      title: "Delivery code locked",
      body: `${DELIVERY_CODE_MAX_ATTEMPTS} wrong delivery codes on order ${out.o.orderNumber}. Locked for ${DELIVERY_CODE_LOCK_MINUTES} minutes. Call the customer and rider; you can reset the code or mark the order delivered.`,
      metadata: { orderId: opts.orderId, orderNumber: out.o.orderNumber, riderId: opts.riderId },
    });
    throw new DeliveryCodeError(
      "CODE_LOCKED",
      `Wrong code. Too many wrong codes: locked for ${DELIVERY_CODE_LOCK_MINUTES} min. MandiBazaar support has been told.`,
      429,
      { lockedUntil: out.until, attemptsLeft: 0 }
    );
  }
  const left = DELIVERY_CODE_MAX_ATTEMPTS - out.attempts;
  throw new DeliveryCodeError(
    "CODE_WRONG",
    `Wrong delivery code. ${left} ${left === 1 ? "try" : "tries"} left.`,
    400,
    { attemptsLeft: left }
  );
}

function minutesLeft(until: Date, now: Date) {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

/**
 * Admin fallback (customer can't find the code, has no phone, or the code got
 * locked): a new code, counter and lock cleared. The new code goes to the
 * customer and back to the admin to read out on a call. Audited.
 */
export async function resetDeliveryCodeByAdmin(adminUserId: string, orderId: string) {
  const o = await readStored(prisma, orderId);
  if (!o) throw new DeliveryCodeError("NO_CODE", "Order not found", 404);
  if (!o.itemList) throw new DeliveryCodeError("NO_CODE", "Only item-list orders use a delivery code", 400);
  if (!["ASSIGNED_TO_RIDER", "OUT_FOR_DELIVERY"].includes(o.orderStatus)) {
    throw new DeliveryCodeError("NO_CODE", "A delivery code can be reset only while a rider has the order", 400);
  }
  const { stored, code } = makeDeliveryCode(orderId);
  await prisma.order.update({
    where: { id: orderId },
    data: { deliveryCodeHash: stored, deliveryCodeAttempts: 0, deliveryCodeLockedUntil: null },
  });
  await writeAuditLog({
    userId: adminUserId,
    action: "DELIVERY_CODE_RESET",
    entity: "Order",
    entityId: orderId,
    previousValue: {
      hadCode: !!o.deliveryCodeHash,
      attempts: o.deliveryCodeAttempts,
      lockedUntil: o.deliveryCodeLockedUntil,
    },
    newValue: { orderNumber: o.orderNumber },
  });
  await sendDeliveryCodeToCustomer(orderId, code, { reset: true });
  return { orderNumber: o.orderNumber, code };
}

/** Audit an admin marking a code-protected order delivered without the code. */
export async function auditAdminDeliveryOverride(adminUserId: string, orderId: string, reason: string) {
  const o = await readStored(prisma, orderId);
  if (!o?.deliveryCodeHash) return;
  await writeAuditLog({
    userId: adminUserId,
    action: "DELIVERY_CODE_ADMIN_OVERRIDE",
    entity: "Order",
    entityId: orderId,
    newValue: {
      orderNumber: o.orderNumber,
      attempts: o.deliveryCodeAttempts,
      lockedUntil: o.deliveryCodeLockedUntil,
      ...(reason ? { reason } : {}),
    },
  });
}
