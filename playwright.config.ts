import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against a local `next dev` that uses the local test database
 * (never production). Start Postgres, then:
 *   TEST_DATABASE_URL=postgresql://<user>@localhost:5432/mandibazaar_test npx playwright test
 */
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("Set TEST_DATABASE_URL to the local test database to run browser tests.");
if (!/^postgres(ql)?:\/\/[^/]*@?(localhost|127\.0\.0\.1)[:/]/.test(testDb)) {
  throw new Error("TEST_DATABASE_URL must point at localhost.");
}

/** Override with E2E_PORT to run beside another dev server (default 3100). */
const PORT = Number(process.env.E2E_PORT) || 3100;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_SECRET = "e2e-only-nextauth-secret";

/** The 6 widths from docs/plans/test-cases.md section L. */
export const WIDTHS = [360, 390, 768, 1024, 1280, 1440] as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: WIDTHS.map((w) => ({
    name: `w${w}`,
    use: {
      ...devices["Desktop Chrome"],
      // Locally use the installed Google Chrome (no browser download needed);
      // CI installs Playwright's own Chromium.
      ...(process.env.CI ? {} : { channel: "chrome" }),
      viewport: { width: w, height: w < 768 ? 800 : 900 },
      isMobile: w < 768,
      hasTouch: w < 768,
    },
  })),
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: testDb,
      NEXTAUTH_SECRET: E2E_SECRET,
      NEXTAUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      // Customer A may use list bidding while the public switch is off (beta path).
      LIST_BIDDING_BETA_EMAILS: "customer.a@test.local",
    },
  },
});
