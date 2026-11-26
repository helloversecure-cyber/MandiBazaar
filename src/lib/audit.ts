import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Inside `prisma.$transaction` pass the transaction client as `db`, so the audit
 * row does not need a second pool connection while the transaction holds one.
 */
export async function writeAuditLog(opts: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.auditLog.create({
    data: {
      userId: opts.userId || null,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId,
      previousValue: opts.previousValue as object | undefined,
      newValue: opts.newValue as object | undefined,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    },
  });
}
