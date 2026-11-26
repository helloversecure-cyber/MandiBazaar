import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Order.deliveryCodeHash is never read by default (W9): many routes spread whole
 * Order rows into JSON for riders, stores and admins, and a hash of a 4-digit
 * code must not reach any of them. Code that needs it selects it explicitly
 * (`select: { deliveryCodeHash: true }`), see src/lib/orders/delivery-code.ts.
 * The cast keeps the plain PrismaClient type so Prisma.TransactionClient
 * parameters across the codebase still accept this client and its transactions.
 */
function makeClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    omit: { order: { deliveryCodeHash: true } },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma || makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
