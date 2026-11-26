/**
 * Adds approved, online riders in Lahore for the list-bidding browser test (W12),
 * so each run can choose a rider without the seeded R1/R2 being busy from a
 * previous width. Idempotent. Prints nothing.
 *
 *   TEST_DATABASE_URL=... npx tsx e2e/seed-list-riders.ts w390a w390b
 *   → rider.w390a@test.local, rider.w390b@test.local
 */
import "../tests/setup";
import { prisma } from "../tests/helpers/db";

async function main() {
  const keys = process.argv.slice(2);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "RIDER" } });
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const email = `rider.${key}@test.local`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && (await prisma.rider.findFirst({ where: { userId: existing.id } }))) continue;
    // Unique 0312xxxxxxx phone per key.
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 10_000_000;
    const phone = `0312${String(h + i).padStart(7, "0").slice(-7)}`;
    const u =
      existing ??
      (await prisma.user.create({
        data: { fullName: `Rider ${key}`, email, phone, roleId: role.id, emailVerified: new Date() },
      }));
    await prisma.rider.create({
      data: {
        userId: u.id,
        name: `Rider ${key.toUpperCase()}`,
        phone: u.phone || phone,
        city: "Lahore",
        vehicleType: "MOTORCYCLE",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        isActive: true,
        status: "AVAILABLE",
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
