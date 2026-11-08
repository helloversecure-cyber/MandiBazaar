import { prisma } from "@/lib/db";

export async function writeAuditLog(opts: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.auditLog.create({
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
