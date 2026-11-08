/**
 * Admin → Settings (QA S14 / P8 / U5). Called from `src/app/api/admin/route.ts`.
 */
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiSuccess, apiZodError, toNumber } from "@/lib/utils";
import { settingsChanges, settingsSchema } from "@/lib/admin/form-rules";

type SettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.storeSettings.findFirst>>>;

/** Plain numbers/strings for the editable fields (also used for the audit diff). */
function editableValues(s: SettingsRow | null) {
  if (!s) return null;
  return {
    businessName: s.businessName,
    phone: s.phone,
    email: s.email,
    address: s.address,
    defaultDeliveryFee: toNumber(s.defaultDeliveryFee),
    deliveryRatePerKm: toNumber(s.deliveryRatePerKm ?? 10),
    maxDeliveryFee: s.maxDeliveryFee != null ? toNumber(s.maxDeliveryFee) : null,
    freeDeliveryThreshold: s.freeDeliveryThreshold != null ? toNumber(s.freeDeliveryThreshold) : null,
    minimumOrderAmount: toNumber(s.minimumOrderAmount),
    platformCommissionPct: toNumber(s.platformCommissionPct ?? 5),
    fullCodMaxOrderAmount: toNumber(s.fullCodMaxOrderAmount ?? 0),
    riderBaseFee: toNumber(s.riderBaseFee ?? 0),
    riderPerKmFee: toNumber(s.riderPerKmFee ?? 0),
    remittanceDeadlineHours: s.remittanceDeadlineHours ?? 48,
    remittanceMethods: Array.isArray(s.remittanceMethods) ? (s.remittanceMethods as string[]) : ["CASH_HANDOVER", "BANK", "JAZZCASH"],
    cashHandoverInstructions: s.cashHandoverInstructions ?? null,
  };
}

export async function getAdminSettings() {
  const settings = await prisma.storeSettings.findFirst();
  if (!settings) return apiSuccess(null);
  // Never expose JazzCash secrets to the frontend
  return apiSuccess({
    ...settings,
    ...editableValues(settings),
    taxRate: settings.taxRate != null ? toNumber(settings.taxRate) : null,
    jazzCashPassword: settings.jazzCashPassword ? "********" : null,
    jazzCashIntegritySalt: settings.jazzCashIntegritySalt ? "********" : null,
    jazzCashConfigured: Boolean(
      process.env.JAZZCASH_MERCHANT_ID && process.env.JAZZCASH_PASSWORD && process.env.JAZZCASH_INTEGRITY_SALT
    ),
  });
}

export async function saveAdminSettings(actor: { id: string }, raw: unknown) {
  const parsed = settingsSchema.safeParse(raw ?? {});
  if (!parsed.success) return apiZodError(parsed.error);
  const d = parsed.data;
  const data = {
    businessName: d.businessName,
    phone: d.phone ?? null,
    email: d.email ?? null,
    address: d.address || null,
    defaultDeliveryFee: d.defaultDeliveryFee,
    deliveryRatePerKm: d.deliveryRatePerKm,
    maxDeliveryFee: d.maxDeliveryFee ?? null,
    freeDeliveryThreshold: d.freeDeliveryThreshold ?? null,
    minimumOrderAmount: d.minimumOrderAmount,
    platformCommissionPct: d.platformCommissionPct,
    ...(d.fullCodMaxOrderAmount != null ? { fullCodMaxOrderAmount: d.fullCodMaxOrderAmount } : {}),
    ...(d.riderBaseFee != null ? { riderBaseFee: d.riderBaseFee } : {}),
    ...(d.riderPerKmFee != null ? { riderPerKmFee: d.riderPerKmFee } : {}),
    ...(d.remittanceDeadlineHours != null ? { remittanceDeadlineHours: d.remittanceDeadlineHours } : {}),
    ...(d.remittanceMethods != null ? { remittanceMethods: d.remittanceMethods } : {}),
    ...(d.cashHandoverInstructions !== undefined ? { cashHandoverInstructions: d.cashHandoverInstructions || null } : {}),
  };

  const existing = await prisma.storeSettings.findFirst();
  const before = editableValues(existing);
  const changes = settingsChanges(before, data);
  const settings = existing
    ? await prisma.storeSettings.update({ where: { id: existing.id }, data })
    : await prisma.storeSettings.create({ data });

  if (changes.length || !existing) {
    await writeAuditLog({
      userId: actor.id,
      action: "SETTINGS_CHANGED",
      entity: "StoreSettings",
      entityId: settings.id,
      previousValue: Object.fromEntries(changes.map((c) => [c.field, c.from])),
      newValue: Object.fromEntries(changes.map((c) => [c.field, c.to])),
    });
  }
  return apiSuccess({ id: settings.id, updated: true, changes });
}
