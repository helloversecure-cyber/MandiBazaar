/**
 * Push notifications to the Android app via Firebase Cloud Messaging.
 * Best effort: a push failure never fails the action that caused it, and the
 * in-app notification row is always saved first.
 */
import { prisma } from "@/lib/db";
import { firebaseAdminApp, firebaseAuthEnabled } from "@/lib/firebase/admin";

export type PushMessage = {
  title: string;
  body: string;
  /** String-only payload for deep links, e.g. { type: "NEW_OFFER", listId }. */
  data?: Record<string, string>;
};

/** FCM error codes meaning the token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

type Sender = (tokens: string[], msg: PushMessage) => Promise<{ token: string; ok: boolean; code?: string }[]>;

/** Real sender (Firebase Admin SDK). Replaced in tests via setPushSender(). */
const fcmSender: Sender = async (tokens, msg) => {
  const { getMessaging } = await import("firebase-admin/messaging");
  const res = await getMessaging(firebaseAdminApp()).sendEachForMulticast({
    tokens,
    notification: { title: msg.title, body: msg.body },
    data: msg.data,
    android: { priority: "high", notification: { channelId: "orders" } },
  });
  return res.responses.map((r, i) => ({ token: tokens[i], ok: r.success, code: r.error?.code }));
};

let sender: Sender | null = null;
export function setPushSender(s: Sender | null) {
  sender = s;
}

function activeSender(): Sender | null {
  if (sender) return sender;
  return firebaseAuthEnabled() ? fcmSender : null;
}

export async function pushToUser(userId: string, msg: PushMessage): Promise<{ sent: number; removed: number }> {
  const send = activeSender();
  if (!send) return { sent: 0, removed: 0 };
  const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  if (!rows.length) return { sent: 0, removed: 0 };

  const results = await send(
    rows.map((r) => r.token),
    { ...msg, title: msg.title.slice(0, 120), body: msg.body.slice(0, 400) }
  );
  const dead = results.filter((r) => !r.ok && r.code && DEAD_TOKEN_CODES.has(r.code)).map((r) => r.token);
  if (dead.length) await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
  return { sent: results.filter((r) => r.ok).length, removed: dead.length };
}

/** Register (or move to this user) an app install's FCM token. */
export async function registerDevice(userId: string, token: string, platform = "android") {
  return prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform, lastSeenAt: new Date() },
  });
}

/** Remove a token. Only the owner can remove theirs (or anyone when userId is omitted, e.g. sign-out by refresh token). */
export async function removeDevice(token: string, userId?: string) {
  await prisma.deviceToken.deleteMany({ where: { token, ...(userId ? { userId } : {}) } });
}
