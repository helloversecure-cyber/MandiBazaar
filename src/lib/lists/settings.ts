/** Item-list bidding settings (StoreSettings) and the feature switch. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ListSettings = {
  enabled: boolean;
  radiusStartKm: number;
  radiusMaxKm: number;
  radiusStepKm: number;
  radiusStepMins: number;
  maxStores: number;
  expiryHours: number;
  postPackBidWindowSecs: number;
  postPackRiderRadiusKm: number;
};

/**
 * Pass the transaction client when called inside `prisma.$transaction`: a call on
 * the global client there needs a second pool connection while the transaction
 * holds one, and with a small pool (Neon pooled URL, CI) concurrent transactions
 * can each wait for a connection none of them will give back.
 */
export async function getListSettings(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ListSettings> {
  const s = await db.storeSettings.findFirst({
    select: {
      listBiddingEnabled: true,
      listRadiusStartKm: true,
      listRadiusMaxKm: true,
      listRadiusStepKm: true,
      listRadiusStepMins: true,
      listMaxStores: true,
      listExpiryHours: true,
      postPackBidWindowSecs: true,
      postPackRiderRadiusKm: true,
    },
  });
  return {
    enabled: s?.listBiddingEnabled ?? false,
    radiusStartKm: s?.listRadiusStartKm ?? 5,
    radiusMaxKm: s?.listRadiusMaxKm ?? 20,
    radiusStepKm: s?.listRadiusStepKm ?? 5,
    radiusStepMins: s?.listRadiusStepMins ?? 30,
    maxStores: s?.listMaxStores ?? 20,
    expiryHours: s?.listExpiryHours ?? 24,
    postPackBidWindowSecs: s?.postPackBidWindowSecs ?? 300,
    postPackRiderRadiusKm: s?.postPackRiderRadiusKm ?? 10,
  };
}

/**
 * Accounts allowed to use list bidding while it is switched off for the public
 * (UAT on production). Comma-separated emails in LIST_BIDDING_BETA_EMAILS.
 */
export function isBetaTester(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.LIST_BIDDING_BETA_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export async function listBiddingAllowedFor(email: string | null | undefined): Promise<boolean> {
  if (isBetaTester(email)) return true;
  return (await getListSettings()).enabled;
}
