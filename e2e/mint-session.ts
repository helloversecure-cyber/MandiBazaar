/**
 * Writes a Playwright storage state that signs in as Customer A, by minting a
 * NextAuth session cookie (the same JWT NextAuth would set after sign-in).
 * Run by global-setup with `npx tsx` (Playwright itself can't import app code).
 *
 *   E2E_BASE_URL=http://localhost:3100 TEST_DATABASE_URL=... npx tsx e2e/mint-session.ts <out.json>
 */
import "../tests/setup";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encode } from "next-auth/jwt";
import { prisma } from "../tests/helpers/db";

const E2E_SECRET = "e2e-only-nextauth-secret";

async function main() {
  const out = process.argv[2];
  const baseUrl = process.env.E2E_BASE_URL;
  if (!out || !baseUrl) throw new Error("usage: E2E_BASE_URL=... tsx e2e/mint-session.ts <out.json>");

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "customer.a@test.local" },
    include: { role: true },
  });
  const token = await encode({
    secret: E2E_SECRET,
    token: {
      sub: user.id,
      id: user.id,
      role: user.role.name,
      phone: user.phone,
      mustChangePassword: false,
      storeApproved: true,
    },
  });
  const { hostname } = new URL(baseUrl);
  const state = {
    cookies: [
      {
        name: "next-auth.session-token",
        value: token,
        domain: hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(state, null, 2));
  console.log("e2e session: signed-in storage state for %s", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
