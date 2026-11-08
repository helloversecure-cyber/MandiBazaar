/**
 * Production bootstrap: wipe marketplace data, keep schema,
 * create ONLY Super Admin + platform settings.
 * No stores, products, categories, or demo users.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." PRODUCTION_ADMIN_PASSWORD="..." npm run db:seed:production
 */
import { PrismaClient, RoleName } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, PERMISSIONS } from "../src/lib/auth/permissions";

const prisma = new PrismaClient();

/** Set via env when running seed — do not commit real secrets */
const ADMIN_EMAIL = process.env.PRODUCTION_ADMIN_EMAIL || "admin@mandibazaar.pk";
const ADMIN_PHONE = process.env.PRODUCTION_ADMIN_PHONE || "03000000001";
const ADMIN_PASSWORD = process.env.PRODUCTION_ADMIN_PASSWORD;

async function wipePublicData() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  for (const { tablename } of rows) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "public"."${tablename}" RESTART IDENTITY CASCADE;`
    );
  }
}

async function main() {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) {
    throw new Error(
      "Set PRODUCTION_ADMIN_PASSWORD (min 10 chars), e.g.\n" +
        'PRODUCTION_ADMIN_PASSWORD="YourStrongPass" npm run db:seed:production'
    );
  }

  console.log("Production reset: wiping all data on Neon…");
  await wipePublicData();

  console.log("Creating roles & permissions…");
  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName, description: roleName.replace(/_/g, " ") },
      update: {},
    });

    const perms = ROLE_PERMISSIONS[roleName] || [];
    for (const code of perms) {
      const permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SUPER_ADMIN" },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      phone: ADMIN_PHONE,
      fullName: "MandiBazaar Super Admin",
      passwordHash,
      roleId: superAdminRole.id,
      onboardingCompleted: true,
    },
  });

  await prisma.storeSettings.create({
    data: {
      businessName: "MandiBazaar",
      phone: "042-111-MANDI",
      email: "hello@mandibazaar.pk",
      address: "Lahore, Pakistan",
      currency: "PKR",
      deliveryRatePerKm: 10,
      defaultDeliveryFee: 100,
      freeDeliveryThreshold: 5000,
      minimumOrderAmount: 300,
      platformCommissionPct: 10,
      cityDeliveryFees: {},
      areaDeliveryFees: {},
      socialLinks: {},
      jazzCashSandbox: true,
    },
  });

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.store.count(),
    prisma.product.count(),
    prisma.category.count(),
  ]);

  console.log("\n========== PRODUCTION BOOTSTRAP DONE ==========");
  console.log(`Users: ${counts[0]} (Super Admin only)`);
  console.log(`Stores: ${counts[1]} | Products: ${counts[2]} | Categories: ${counts[3]}`);
  console.log("\nSUPER ADMIN LOGIN");
  console.log(`  URL:      https://www.mandibazaar.pk/login?portal=admin`);
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Phone:    ${ADMIN_PHONE}`);
  console.log(`  Password: (the PRODUCTION_ADMIN_PASSWORD you set)`);
  console.log("  → Change this password immediately after first login.");
  console.log("===============================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
