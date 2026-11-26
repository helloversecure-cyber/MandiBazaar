/** Resets the local test database, seeds the standard fixtures + a few products, and signs in Customer A. */
import { execSync } from "node:child_process";
import { BASE_URL } from "../playwright.config";

/** Storage state with a NextAuth session for customer.a@test.local (see e2e/mint-session.ts). */
export const CUSTOMER_STATE = "e2e/.auth/customer.json";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL!;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  execSync("npx tsx e2e/seed.ts", {
    env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
    stdio: "inherit",
  });
  execSync(`npx tsx e2e/mint-session.ts ${CUSTOMER_STATE}`, {
    env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, E2E_BASE_URL: BASE_URL },
    stdio: "inherit",
  });
}
