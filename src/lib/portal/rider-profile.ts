/**
 * Rider "My profile" + "My earnings" rules (QA O6). Pure — client + server.
 * Name, phone, city and CNIC are fixed after signup (admin changes them).
 */
import { z } from "zod";
import {
  MSG,
  normalizeBankAccount,
  normalizePkIban,
  optional,
  zBusinessName,
  zJazzCash,
  zPersonName,
  zVehicleType,
} from "@/lib/validators/pk";

/** Bank account number (10–20 digits) or a Pakistani IBAN. */
export const zRiderAccount = z.string({ message: MSG.bankAccount }).transform((v, ctx) => {
  const iban = normalizePkIban(v);
  if (iban) return iban;
  const acct = normalizeBankAccount(v);
  if (acct) return acct;
  ctx.addIssue({
    code: "custom",
    message: "Enter a bank account number (10–20 digits) or an IBAN like PK36SCBL0000001123456702",
  });
  return z.NEVER;
});

/** Empty field = keep what is saved now. */
export const riderProfileUpdateSchema = z.object({
  vehicleType: optional(zVehicleType),
  accountTitle: optional(zPersonName),
  bankName: optional(zBusinessName),
  accountNumber: optional(zRiderAccount),
  jazzCashNumber: optional(zJazzCash),
  removeJazzCash: z.boolean().optional(),
  removeBank: z.boolean().optional(),
});

export type RiderEarningsPeriod = { key: string; label: string; since?: Date };

export function riderEarningsPeriods(now = new Date()): RiderEarningsPeriod[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  return [
    { key: "today", label: "Today", since: today },
    { key: "week", label: "Last 7 days", since: days(7) },
    { key: "month", label: "Last 30 days", since: days(30) },
    { key: "all", label: "All time" },
  ];
}
