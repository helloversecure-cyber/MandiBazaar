/** Item-list bidding settings (StoreSettings) and the feature switch. */
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

export async function getListSettings(): Promise<ListSettings> {
  const s = await prisma.storeSettings.findFirst({
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
