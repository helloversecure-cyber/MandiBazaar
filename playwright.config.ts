import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against a local Next server that uses the local test database
 * (never production). Start Postgres, then:
 *   TEST_DATABASE_URL=postgresql://<user>@localhost:5432/mandibazaar_test npx playwright test
 *
 * Server: `next dev` locally; `next start` (the production build) on CI, where a
 * cold dev compile of every page is slow. Choose with E2E_SERVER=dev|start. Start
 * mode needs a `npx next build` first, built with NEXT_PUBLIC_APP_URL=BASE_URL
 * (NEXT_PUBLIC_* values are fixed at build time; NextAuth redirects use it).
 * Browser: Playwright's Chromium on CI, the installed Google Chrome locally;
 * override with E2E_CHANNEL=chrome|chromium.
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

/** "start" = production build (`next start`), "dev" = `next dev`. */
export const SERVER_MODE = (process.env.E2E_SERVER ?? (process.env.CI ? "start" : "dev")) as "dev" | "start";
if (!["dev", "start"].includes(SERVER_MODE)) throw new Error("E2E_SERVER must be dev or start.");

/**
 * NextAuth's session cookie. A production build (`next start`) uses the __Secure- name
 * (src/lib/auth/auth.ts and src/middleware.ts), `next dev` the plain one. Chromium sends
 * Secure cookies to http://localhost, so the __Secure- cookie works without TLS.
 */
export const SESSION_COOKIE = SERVER_MODE === "start" ? "__Secure-next-auth.session-token" : "next-auth.session-token";

/** A Playwright cookie that signs a browser context in with a minted session token. */
export function sessionCookieParam(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    domain: new URL(BASE_URL).hostname,
    path: "/",
    httpOnly: true,
    secure: SERVER_MODE === "start",
    sameSite: "Lax" as const,
  };
}
const channelOverride = process.env.E2E_CHANNEL;
const CHANNEL = channelOverride ? (channelOverride === "chromium" ? undefined : channelOverride) : process.env.CI ? undefined : "chrome";

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
      // CI installs Playwright's own Chromium. E2E_CHANNEL overrides either.
      ...(CHANNEL ? { channel: CHANNEL } : {}),
      viewport: { width: w, height: w < 768 ? 800 : 900 },
      isMobile: w < 768,
      hasTouch: w < 768,
    },
  })),
  webServer: {
    command: SERVER_MODE === "start" ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    // Readiness probe on a data-independent route: the home page renders whatever rows
    // the last vitest suite left behind (the seed in global-setup runs after this probe),
    // e.g. product images on hosts next/image rejects, which would 500 and stall startup.
    url: `${BASE_URL}/api/app/config`,
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
