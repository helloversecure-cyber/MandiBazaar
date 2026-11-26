/**
 * Runs before every test file.
 *
 * Tests must never touch the production database. Database tests only run when
 * TEST_DATABASE_URL points at a local Postgres. Without it, DATABASE_URL is
 * forced to a dead local address so an accidental query fails fast instead of
 * reaching whatever DATABASE_URL a developer's .env holds.
 */
const testUrl = process.env.TEST_DATABASE_URL;

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

if (testUrl) {
  if (!isLocal(testUrl)) {
    throw new Error(
      `TEST_DATABASE_URL must point at localhost (got host "${new URL(testUrl).hostname}"). ` +
        "Tests never run against a remote database."
    );
  }
  process.env.DATABASE_URL = testUrl;
} else {
  process.env.DATABASE_URL = "postgresql://no-test-db@127.0.0.1:1/none";
}

process.env.NEXTAUTH_SECRET ||= "test-only-nextauth-secret";
