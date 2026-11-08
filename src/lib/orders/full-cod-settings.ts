import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

/** StoreSettings.fullCodMaxOrderAmount (0 = full cash on delivery is off). Server only. */
export async function getFullCodMaxOrderAmount(): Promise<number> {
  const row = await prisma.storeSettings.findFirst({ select: { fullCodMaxOrderAmount: true } });
  if (!row) return 0;
  return Math.max(0, toNumber(row.fullCodMaxOrderAmount));
}
