/**
 * Moves a customer's item lists' createdAt back two hours so the "lists per hour"
 * limit (MAX_LISTS_PER_HOUR) starts fresh. Browser tests only: many specs share
 * Customer A on one dev server. Expiry times are not touched.
 *
 *   TEST_DATABASE_URL=... npx tsx e2e/age-lists.ts [email]
 */
import "../tests/setup";
import { prisma } from "../tests/helpers/db";

async function main() {
  const email = process.argv[2] || "customer.a@test.local";
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  // createdAt is a UTC timestamp without time zone; compare it to UTC "now" so this also
  // works when the database's TimeZone is not UTC (a local Postgres in Asia/Karachi).
  await prisma.$executeRaw`UPDATE "ItemList" SET "createdAt" = "createdAt" - interval '2 hours' WHERE "customerId" = ${u.id} AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '1 hour'`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
