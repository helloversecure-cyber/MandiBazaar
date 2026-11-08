/**
 * Phase 0 (QA report U1 / P5 / P9 / T2) one-off data cleanup.
 *
 * DRY RUN by default — prints what it would change and changes nothing.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/phase0-security-cleanup.ts
 *   DATABASE_URL="postgresql://..." npx tsx scripts/phase0-security-cleanup.ts --apply
 *
 * What it does (with --apply):
 *  1. Deactivates unsafe coupons: percentage > 90% (e.g. GFDHTGD at 120%), or a fixed
 *     discount >= its own minimum order (orders can become free).
 *  2. Deletes legacy password-reset audit rows that hold reset codes/tokens in clear
 *     text (entity "PasswordReset"). Pending resets must simply be requested again.
 *  3. Redacts stored SMS bodies of PASSWORD_RESET notifications (they contain codes).
 *
 * Report only (never changed automatically):
 *  - Rider accounts still using the old shared default password.
 *  - Whether the homepage-advertised coupon SAVE10 exists.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const OLD_DEFAULT_RIDER_PASSWORD = "Rider@12345";

function n(v: unknown): number {
  return v == null ? 0 : Number(v);
}

async function unsafeCoupons() {
  const coupons = await prisma.coupon.findMany({ where: { isActive: true } });
  const unsafe = coupons.filter((c) => {
    const value = n(c.value);
    if (c.type === "PERCENTAGE") return value > 90;
    const min = n(c.minimumOrderAmount);
    return value >= min; // fixed discount covers the whole minimum order
  });
  console.log(`\n[1] Active unsafe coupons: ${unsafe.length}`);
  for (const c of unsafe) {
    console.log(
      `    - ${c.code}: ${c.type} ${n(c.value)} (min order ${n(c.minimumOrderAmount)}, used ${c.usedCount})`
    );
  }
  if (APPLY && unsafe.length) {
    await prisma.coupon.updateMany({
      where: { id: { in: unsafe.map((c) => c.id) } },
      data: { isActive: false },
    });
    console.log("    → deactivated");
  }
}

async function legacyResetRows() {
  const where = { entity: "PasswordReset" };
  const count = await prisma.auditLog.count({ where });
  console.log(`\n[2] Legacy audit rows with clear-text reset codes/tokens: ${count}`);
  if (APPLY && count) {
    const { count: deleted } = await prisma.auditLog.deleteMany({ where });
    console.log(`    → deleted ${deleted}`);
  }
}

async function resetSmsBodies() {
  const where = {
    type: "PASSWORD_RESET",
    NOT: { body: { startsWith: "[redacted" } },
  };
  const count = await prisma.notification.count({ where });
  console.log(`\n[3] Stored password-reset SMS bodies containing codes: ${count}`);
  if (APPLY && count) {
    const { count: updated } = await prisma.notification.updateMany({
      where,
      data: { body: "[redacted — contains a one-time code]" },
    });
    console.log(`    → redacted ${updated}`);
  }
}

async function ridersOnDefaultPassword() {
  const riders = await prisma.rider.findMany({
    where: { user: { isNot: null } },
    select: {
      name: true,
      phone: true,
      user: { select: { passwordHash: true, isActive: true } },
    },
  });
  const weak: string[] = [];
  for (const r of riders) {
    const hash = r.user?.passwordHash;
    if (hash && (await bcrypt.compare(OLD_DEFAULT_RIDER_PASSWORD, hash))) {
      weak.push(`${r.name} (${r.phone.slice(0, 4)}*******)`);
    }
  }
  console.log(`\n[report] Riders still on the old shared default password: ${weak.length}`);
  for (const w of weak) console.log(`    - ${w}`);
  if (weak.length) {
    console.log("    → Ask these riders to reset their password (Forgot password).");
  }
}

async function save10() {
  const c = await prisma.coupon.findUnique({ where: { code: "SAVE10" } });
  console.log(
    `\n[report] SAVE10 coupon: ${
      c ? `exists (active=${c.isActive}, ${c.type} ${n(c.value)})` : "does NOT exist"
    } — homepage ticker advertises it.`
  );
}

async function main() {
  console.log(APPLY ? "=== APPLY MODE: changes will be written ===" : "=== DRY RUN (pass --apply to write) ===");
  await unsafeCoupons();
  await legacyResetRows();
  await resetSmsBodies();
  await ridersOnDefaultPassword();
  await save10();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
