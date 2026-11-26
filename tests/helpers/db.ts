/**
 * Database test helpers (no vitest import, so e2e seeding can use them too).
 * Suites that need Postgres use `describeDb` from ./describe-db.
 *
 * Local run:
 *   createdb mandibazaar_test
 *   TEST_DATABASE_URL=postgresql://localhost:5432/mandibazaar_test npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://localhost:5432/mandibazaar_test npx vitest run
 */
import { prisma } from "@/lib/db";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** Empty every application table (keeps the schema and the migrations table). */
export async function resetDb(): Promise<void> {
  if (!hasTestDb) throw new Error("resetDb() called without TEST_DATABASE_URL");
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export { prisma };
