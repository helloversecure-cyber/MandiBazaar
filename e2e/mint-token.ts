/**
 * Prints a token for a seeded test user.
 *   tsx e2e/mint-token.ts <email>           app access token (Bearer)
 *   tsx e2e/mint-token.ts <email> --cookie  website session cookie value (NextAuth JWT)
 */
import "../tests/setup";
import { prisma } from "../tests/helpers/db";
import { encode } from "next-auth/jwt";
import { issueAccessToken } from "../src/lib/auth/mobile-tokens";

async function main() {
  const email = process.argv[2];
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
  if (process.argv.includes("--cookie")) {
    const cookie = await encode({
      secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: u.id, id: u.id, role: u.role.name, phone: u.phone, mustChangePassword: false, storeApproved: true },
    });
    process.stdout.write(cookie);
    return;
  }
  const { token } = await issueAccessToken({
    id: u.id,
    role: u.role.name,
    phone: u.phone,
    mustChangePassword: u.mustChangePassword,
  });
  process.stdout.write(token);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
