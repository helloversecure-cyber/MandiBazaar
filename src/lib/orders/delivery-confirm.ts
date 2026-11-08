import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/auth/firebase-signup";
import { sendNotification, notifySuperAdminsInApp } from "@/lib/notifications/service";
import { recordStatusEvent } from "@/lib/orders/status-events";

type Db = Prisma.TransactionClient | typeof prisma;

/** Customer's single-use confirmation link stays valid this long after delivery. */
const DEFAULT_TTL_HOURS = 72;

export type ConfirmOutcome = "RECEIVED" | "NOT_RECEIVED" | "ISSUE";
const VALID_OUTCOMES: ConfirmOutcome[] = ["RECEIVED", "NOT_RECEIVED", "ISSUE"];

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a single-use, hashed confirmation token for an order and return the
 *  shareable link (only the raw token leaves the server; we store its hash). */
export async function issueDeliveryConfirmationToken(
  db: Db,
  orderId: string,
  opts: { ttlHours?: number } = {}
): Promise<{ token: string; url: string }> {
  const raw = randomBytes(24).toString("base64url");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + (opts.ttlHours ?? DEFAULT_TTL_HOURS) * 3600 * 1000);
  await db.deliveryConfirmationToken.create({ data: { orderId, tokenHash, expiresAt } });
  return { token: raw, url: `${appUrl()}/confirm-delivery/${raw}` };
}

/** Issue a token (best-effort) and notify the customer with the confirm link.
 *  Called right after an order is marked DELIVERED. Never throws. */
export async function sendDeliveryConfirmationRequest(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, customerId: true },
    });
    if (!order) return;
    const { url } = await issueDeliveryConfirmationToken(prisma, orderId);
    await sendNotification({
      userId: order.customerId,
      orderId,
      type: "DELIVERY_CONFIRMATION",
      title: "Did your order arrive?",
      body: `Please confirm you received order ${order.orderNumber}, or report a problem: ${url}`,
      metadata: { url },
    });
  } catch (e) {
    console.error("[delivery-confirm:request]", e);
  }
}

type LookupResult =
  | { ok: true; order: { orderNumber: string; status: string; total: number } }
  | { ok: false; reason: "invalid" | "expired" | "used"; outcome?: ConfirmOutcome | null };

/** Validate a raw token for the confirmation page (no side effects). */
export async function lookupDeliveryToken(raw: string): Promise<LookupResult> {
  if (!raw || raw.length < 10) return { ok: false, reason: "invalid" };
  const token = await prisma.deliveryConfirmationToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { order: { select: { orderNumber: true, orderStatus: true, grandTotal: true } } },
  });
  if (!token || !token.order) return { ok: false, reason: "invalid" };
  if (token.usedAt) return { ok: false, reason: "used", outcome: (token.outcome as ConfirmOutcome) ?? null };
  if (token.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    order: {
      orderNumber: token.order.orderNumber,
      status: token.order.orderStatus,
      total: Number(token.order.grandTotal),
    },
  };
}

export type ConfirmResult =
  | { ok: true; outcome: ConfirmOutcome; orderNumber: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "bad_outcome" };

/** Record the customer's confirmation (single-use). On a problem it journals a
 *  status note and alerts Super Admins; it never changes money or order status. */
export async function confirmDelivery(
  raw: string,
  outcome: ConfirmOutcome,
  note?: string
): Promise<ConfirmResult> {
  if (!VALID_OUTCOMES.includes(outcome)) return { ok: false, reason: "bad_outcome" };

  const result = await prisma.$transaction(async (tx) => {
    const token = await tx.deliveryConfirmationToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { order: { select: { id: true, orderNumber: true } } },
    });
    if (!token || !token.order) return { ok: false as const, reason: "invalid" as const };
    if (token.usedAt) return { ok: false as const, reason: "used" as const };
    if (token.expiresAt < new Date()) return { ok: false as const, reason: "expired" as const };

    // Claim it atomically: only one request wins.
    const claimed = await tx.deliveryConfirmationToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date(), outcome },
    });
    if (claimed.count === 0) return { ok: false as const, reason: "used" as const };

    const labels: Record<ConfirmOutcome, string> = {
      RECEIVED: "Customer confirmed they received this order",
      NOT_RECEIVED: "Customer reported they did NOT receive this order",
      ISSUE: "Customer reported a problem with this order",
    };
    await recordStatusEvent(tx, {
      orderId: token.order.id,
      status: "DELIVERED",
      actorRole: "CUSTOMER",
      note: note ? `${labels[outcome]}: ${note}` : labels[outcome],
    });

    return { ok: true as const, outcome, orderId: token.order.id, orderNumber: token.order.orderNumber };
  });

  // Alert admins outside the transaction when the customer flags a problem.
  if (result.ok && (result.outcome === "NOT_RECEIVED" || result.outcome === "ISSUE")) {
    await notifySuperAdminsInApp({
      type: "DELIVERY_DISPUTE",
      title: "Delivery problem reported",
      body: `Order ${result.orderNumber}: ${
        result.outcome === "NOT_RECEIVED" ? "customer says it was not received" : "customer reported a problem"
      }${note ? ` — “${note.slice(0, 160)}”` : ""}.`,
      metadata: { orderId: result.orderId, orderNumber: result.orderNumber },
    }).catch(() => {});
  }

  if (!result.ok) return result;
  return { ok: true, outcome: result.outcome, orderNumber: result.orderNumber };
}
