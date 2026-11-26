/** Resets the local test database and seeds the standard fixtures + a few products. */
import { execSync } from "node:child_process";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL!;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  execSync("npx tsx e2e/seed.ts", {
    env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
    stdio: "inherit",
  });
}
