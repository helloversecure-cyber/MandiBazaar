import { NotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendNotification } from "@/lib/notifications/service";
import { normalizePkMobile } from "@/lib/validators/pk";

/**
 * Tell a store owner about an admin decision (QA P13: approve / reject /
 * suspend / reactivate, product decisions). In-app always; SMS too when the
 * owner has a valid mobile number and `sms` is true. Never throws — a failed
 * notification must not undo the admin action.
 */
export async function notifyStoreOwner(opts: {
  storeId: string;
  type: string;
  title: string;
  body: string;
  sms?: boolean;
  metadata?: Record<string, unknown>;
}) {
  try {
    const store = await prisma.store.findUnique({
      where: { id: opts.storeId },
      select: { id: true, ownerId: true, owner: { select: { phone: true } } },
    });
    if (!store) return;
    const metadata = { storeId: store.id, ...(opts.metadata || {}) };
    await sendNotification({
      userId: store.ownerId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      channel: NotificationChannel.IN_APP,
      metadata,
    });
    const phone = normalizePkMobile(store.owner?.phone ?? null);
    if (opts.sms && phone) {
      await sendNotification({
        userId: store.ownerId,
        type: opts.type,
        title: opts.title,
        body: `MandiBazaar: ${opts.body}`,
        channel: NotificationChannel.SMS,
        phone,
        metadata,
      });
    }
  } catch (e) {
    console.error("[notifyStoreOwner] failed", e);
  }
}
