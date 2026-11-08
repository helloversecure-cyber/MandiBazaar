import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePkMobile } from "@/lib/validators/pk";
import {
  STORE_NEW_ORDER_TYPE,
  customerEventFor,
  customerEventMessage,
  customerExtraType,
  extraChannels,
  notifyStoresFor,
  storeNewOrderMessage,
  storeRecipientIds,
} from "@/lib/notifications/order-events";

export type NotifyInput = {
  userId?: string;
  orderId?: string;
  type: string;
  title: string;
  body: string;
  channel?: NotificationChannel;
  phone?: string;
  /** EMAIL channel: recipient address */
  email?: string;
  metadata?: Record<string, unknown>;
  /** Body contains a secret (e.g. reset code): never persist or log it in clear text. */
  sensitive?: boolean;
  /**
   * Only report "sent" when a real provider delivered it (no sandbox success).
   * Used for one-time codes.
   */
  requireProvider?: boolean;
};

const REDACTED_BODY = "[redacted — contains a one-time code]";

const isProduction = () => process.env.NODE_ENV === "production";

/** Twilio SMS credentials present (account SID, auth token and a From number). */
/** Twilio credentials present (used for free-text SMS: order updates, etc.). */
export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
}

/** SMS available (Twilio) for free-text messages like order updates. */
export function smsConfigured(): boolean {
  return twilioConfigured();
}

/** Resend email credentials present (API key and a From address). */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/**
 * Stores notifications and dispatches SMS / WhatsApp / email when configured.
 * Without provider credentials: in development the message is logged and marked
 * SENT (sandbox); in production it is marked FAILED (never a fake "sent").
 */
export async function sendNotification(input: NotifyInput) {
  return (await deliverNotification(input)).notification;
}

/** Like sendNotification, but also says whether a provider actually accepted it. */
export async function deliverNotification(input: NotifyInput) {
  const channel = input.channel || NotificationChannel.IN_APP;

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      orderId: input.orderId,
      channel,
      type: input.type,
      title: input.title,
      body: input.sensitive ? REDACTED_BODY : input.body,
      status: NotificationStatus.PENDING,
      metadata: {
        ...(input.metadata || {}),
        phone: input.phone,
        ...(input.email ? { email: input.email } : {}),
      } as object,
    },
  });

  if (channel === NotificationChannel.IN_APP) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.SENT, sentAt: new Date() },
    });
    return { notification, sent: true };
  }

  const dispatched = await dispatchExternal(channel, input);
  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: dispatched ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: dispatched ? new Date() : null,
    },
  });

  return { notification, sent: dispatched };
}

/** Body as it may appear in logs. */
function loggableBody(input: NotifyInput) {
  return input.sensitive && isProduction() ? REDACTED_BODY : input.body;
}

async function dispatchExternal(
  channel: NotificationChannel,
  input: NotifyInput
): Promise<boolean> {
  if (channel === NotificationChannel.EMAIL) {
    return dispatchEmail(input);
  }

  const phone = input.phone;
  if (!phone) {
    console.warn(`[notify] ${channel} skipped — no phone`, input.title);
    return false;
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;
  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

  if (!twilioSid || !twilioToken) {
    if (isProduction() || input.requireProvider) {
      console.warn(`[notify:${channel}] not sent — SMS provider (Twilio) is not configured`, input.title);
      return false;
    }
    // Sandbox (development): log message so local testing still works
    console.info(`[notify:${channel}] to=${phone} | ${input.title} — ${loggableBody(input)}`);
    return true;
  }

  try {
    const to =
      channel === NotificationChannel.WHATSAPP
        ? `whatsapp:${toE164(phone)}`
        : toE164(phone);
    const from =
      channel === NotificationChannel.WHATSAPP
        ? whatsappFrom || `whatsapp:${twilioFrom}`
        : twilioFrom;

    if (!from) return false;

    const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: `${input.title}\n${input.body}`,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    if (!res.ok) {
      console.error(`[notify:${channel}] Twilio rejected the message (HTTP ${res.status})`);
    }
    return res.ok;
  } catch (e) {
    console.error(`[notify:${channel}] failed`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Email through the Resend HTTP API (no SDK). */
async function dispatchEmail(input: NotifyInput): Promise<boolean> {
  const to = input.email?.trim();
  if (!to) {
    console.warn("[notify] EMAIL skipped — no address", input.title);
    return false;
  }
  if (!emailConfigured()) {
    if (isProduction() || input.requireProvider) {
      console.warn("[notify:EMAIL] not sent — email provider (Resend) is not configured", input.title);
      return false;
    }
    console.info(`[notify:EMAIL] to=${to} | ${input.title} — ${loggableBody(input)}`);
    return true;
  }
  return sendEmail({ to, subject: input.title, text: input.body });
}

/** Send one email with Resend (HTML + plain-text fallback). Returns true when accepted. */
export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject.slice(0, 200),
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[notify:EMAIL] Resend rejected the message (HTTP ${res.status})`);
    }
    return res.ok;
  } catch (e) {
    console.error("[notify:EMAIL] failed", e instanceof Error ? e.message : e);
    return false;
  }
}

function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92")) return `+${digits}`;
  if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Order event for the customer. Always creates the in-app notification (as
 * before); for key events also sends SMS / email when a provider is configured,
 * and on confirmation tells the stores in the order. Extras never throw.
 */
export async function notifyOrderEvent(
  orderId: string,
  type: string,
  title: string,
  body: string
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const notification = await sendNotification({
    userId: order.customerId,
    orderId,
    type,
    title,
    body,
    channel: NotificationChannel.IN_APP,
  });

  try {
    await sendCustomerOrderExtras(order, type);
  } catch (e) {
    console.error("[notify] customer SMS/email failed", order.orderNumber, type, e);
  }
  if (notifyStoresFor(type)) {
    await notifyStoresOfNewOrder(orderId);
  }
  return notification;
}

/** True when this recipient already got this message for this order (no duplicates). */
async function alreadyNotified(orderId: string, userId: string, type: string, channel: NotificationChannel) {
  const n = await prisma.notification.count({
    where: { orderId, userId, type, channel, status: { not: NotificationStatus.FAILED } },
  });
  return n > 0;
}

async function sendCustomerOrderExtras(
  order: { id: string; orderNumber: string; customerId: string; orderStatus: string },
  type: string
) {
  let refundStatus: string | null = null;
  if (type === "REFUND_UPDATE") {
    const refund = await prisma.refund.findFirst({
      where: { orderId: order.id },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    });
    refundStatus = refund?.status ?? null;
  }
  const event = customerEventFor(type, order.orderStatus, refundStatus);
  if (!event) return;

  const customer = await prisma.user.findUnique({
    where: { id: order.customerId },
    select: { phone: true, email: true, isActive: true },
  });
  if (!customer?.isActive) return;
  const phone = normalizePkMobile(customer.phone ?? "");
  const channels = extraChannels({
    smsOn: smsConfigured(),
    emailOn: emailConfigured(),
    phone,
    email: customer.email || null,
  });
  if (!channels.length) return;

  const msg = customerEventMessage(event, order.orderNumber);
  const extraType = customerExtraType(event);
  for (const ch of channels) {
    const channel = ch === "SMS" ? NotificationChannel.SMS : NotificationChannel.EMAIL;
    if (await alreadyNotified(order.id, order.customerId, extraType, channel)) continue;
    await sendNotification({
      userId: order.customerId,
      orderId: order.id,
      type: extraType,
      title: msg.title,
      body: msg.body,
      channel,
      ...(ch === "SMS" ? { phone: phone! } : { email: customer.email! }),
      requireProvider: true,
    });
  }
}

/**
 * Tell every store in the order (owner + active members) that a confirmed order
 * is waiting: in-app always, SMS when Twilio is configured. Idempotent per
 * order + recipient + channel. Never throws.
 */
export async function notifyStoresOfNewOrder(orderId: string): Promise<number> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        items: { select: { storeId: true } },
      },
    });
    if (!order) return 0;

    const itemsByStore = new Map<string, number>();
    for (const it of order.items) itemsByStore.set(it.storeId, (itemsByStore.get(it.storeId) || 0) + 1);
    if (!itemsByStore.size) return 0;

    const stores = await prisma.store.findMany({
      where: { id: { in: Array.from(itemsByStore.keys()) } },
      select: {
        id: true,
        ownerId: true,
        members: { select: { userId: true, isActive: true } },
      },
    });

    const smsOn = smsConfigured();
    let sent = 0;
    const done = new Set<string>();
    for (const store of stores) {
      const msg = storeNewOrderMessage(order.orderNumber, itemsByStore.get(store.id) || 1);
      const ids = storeRecipientIds(store).filter((id) => !done.has(id));
      if (!ids.length) continue;
      const users = await prisma.user.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true, phone: true },
      });
      for (const u of users) {
        done.add(u.id);
        if (!(await alreadyNotified(order.id, u.id, STORE_NEW_ORDER_TYPE, NotificationChannel.IN_APP))) {
          await sendNotification({
            userId: u.id,
            orderId: order.id,
            type: STORE_NEW_ORDER_TYPE,
            title: msg.title,
            body: msg.body,
            channel: NotificationChannel.IN_APP,
            metadata: { storeId: store.id },
          });
          sent++;
        }
        const phone = normalizePkMobile(u.phone ?? "");
        if (
          smsOn &&
          phone &&
          !(await alreadyNotified(order.id, u.id, STORE_NEW_ORDER_TYPE, NotificationChannel.SMS))
        ) {
          await sendNotification({
            userId: u.id,
            orderId: order.id,
            type: STORE_NEW_ORDER_TYPE,
            title: msg.title,
            body: msg.body,
            channel: NotificationChannel.SMS,
            phone,
            metadata: { storeId: store.id },
            requireProvider: true,
          });
        }
      }
    }
    return sent;
  } catch (e) {
    console.error("[notify] store new-order notification failed", orderId, e);
    return 0;
  }
}

/** Notify rider on SMS + WhatsApp: pickup stores → drop address */
export async function notifyRiderAssignment(params: {
  orderId: string;
  orderNumber: string;
  riderPhone: string;
  riderUserId?: string | null;
  pickupLines: string[];
  dropAddress: string;
  cashToCollect: number;
}) {
  const body = [
    `Order ${params.orderNumber}`,
    `PICKUP:`,
    ...params.pickupLines.map((l, i) => `${i + 1}. ${l}`),
    `DELIVER TO: ${params.dropAddress}`,
    params.cashToCollect > 0
      ? `Collect Rs. ${params.cashToCollect} COD — remit to MandiBazaar`
      : `No COD — already paid`,
  ].join("\n");

  const title = "New delivery assignment — MandiBazaar";

  await Promise.all([
    // SMS goes through Twilio whenever it is configured (FAILED, not fake SENT, in production without it)
    sendNotification({
      userId: params.riderUserId || undefined,
      orderId: params.orderId,
      type: "RIDER_ASSIGNED",
      title,
      body,
      channel: NotificationChannel.SMS,
      phone: params.riderPhone,
    }),
    sendNotification({
      userId: params.riderUserId || undefined,
      orderId: params.orderId,
      type: "RIDER_ASSIGNED",
      title,
      body,
      channel: NotificationChannel.WHATSAPP,
      phone: params.riderPhone,
    }),
    params.riderUserId
      ? sendNotification({
          userId: params.riderUserId,
          orderId: params.orderId,
          type: "RIDER_ASSIGNED",
          title,
          body,
          channel: NotificationChannel.IN_APP,
          phone: params.riderPhone,
        })
      : Promise.resolve(),
  ]);
}

/**
 * In-app notification to every active MandiBazaar (QA N9: store product
 * changes waiting for review). Never throws — a failed notification must not
 * fail the store's save.
 */
export async function notifySuperAdminsInApp(params: {
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const admins = await prisma.user.findMany({
      where: { isActive: true, role: { name: "SUPER_ADMIN" } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        sendNotification({
          userId: a.id,
          type: params.type,
          title: params.title,
          body: params.body,
          channel: NotificationChannel.IN_APP,
          metadata: params.metadata,
        })
      )
    );
    return admins.length;
  } catch (e) {
    console.error("[notify] super admin notification failed", e);
    return 0;
  }
}
