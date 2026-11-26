/**
 * Standard test data from docs/plans/test-cases.md:
 *   Customer A with a pinned address in Model Town, Lahore.
 *   Stores S1 (2 km, Grocery), S2 (4 km, Grocery), S3 (8 km, Grocery),
 *          S4 (3 km, Pharmacy only), S5 (2 km, Grocery, SUSPENDED).
 *   Riders R1 (online), R2 (online), R3 (offline), R4 (overdue COD cash).
 */
import { RoleName } from "@prisma/client";
import { prisma } from "./db";

export const PIN = { lat: 31.4834, lng: 74.326 };
/** ~1 km of latitude */
const KM = 1 / 111;

async function role(name: RoleName) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name } });
}

async function user(name: string, roleName: RoleName, email: string, phone: string) {
  const r = await role(roleName);
  return prisma.user.create({
    data: {
      fullName: name,
      email,
      phone,
      roleId: r.id,
      emailVerified: new Date(),
      onboardingCompleted: true,
    },
  });
}

async function store(
  key: string,
  km: number,
  categories: string[],
  status: "APPROVED" | "SUSPENDED" = "APPROVED"
) {
  const owner = await user(`Owner ${key}`, "STORE_OWNER", `owner.${key.toLowerCase()}@test.local`, `0300000${key.slice(1).padStart(4, "0")}`);
  return prisma.store.create({
    data: {
      name: `TEST ${key}`,
      slug: `test-${key.toLowerCase()}`,
      status,
      addressLine: `${key} Main Market`,
      area: "Model Town",
      city: "Lahore",
      province: "Punjab",
      latitude: PIN.lat + km * KM,
      longitude: PIN.lng,
      requestedCategories: categories,
      approvedAt: status === "APPROVED" ? new Date() : null,
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
    include: { owner: true },
  });
}

async function rider(key: string, opts: { online: boolean; codOverdue?: boolean }) {
  const u = await user(`Rider ${key}`, "RIDER", `rider.${key.toLowerCase()}@test.local`, `0311000${key.slice(1).padStart(4, "0")}`);
  return prisma.rider.create({
    data: {
      userId: u.id,
      name: `TEST ${key}`,
      phone: u.phone!,
      city: "Lahore",
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      isActive: true,
      status: opts.online ? "AVAILABLE" : "OFFLINE",
      codRestrictedAt: opts.codOverdue ? new Date() : null,
      codRestrictionReason: opts.codOverdue ? "Overdue COD remittance (test)" : null,
    },
  });
}

export async function seedStandardFixtures() {
  await prisma.storeSettings.create({ data: {} });
  for (const [name, slug] of [
    ["Grocery", "grocery"],
    ["Pharmacy", "pharmacy"],
  ]) {
    await prisma.category.create({ data: { name, slug } });
  }

  const customerA = await user("Customer A", "CUSTOMER", "customer.a@test.local", "03001234567");
  const addressA = await prisma.address.create({
    data: {
      userId: customerA.id,
      fullName: "Customer A",
      phone: "03001234567",
      houseBuilding: "House 1",
      area: "Model Town",
      city: "Lahore",
      province: "Punjab",
      latitude: PIN.lat,
      longitude: PIN.lng,
      isDefault: true,
    },
  });
  const customerB = await user("Customer B", "CUSTOMER", "customer.b@test.local", "03007654321");

  const S1 = await store("S1", 2, ["Grocery"]);
  const S2 = await store("S2", 4, ["Grocery"]);
  const S3 = await store("S3", 8, ["Grocery"]);
  const S4 = await store("S4", 3, ["Pharmacy"]);
  const S5 = await store("S5", 2, ["Grocery"], "SUSPENDED");

  const R1 = await rider("R1", { online: true });
  const R2 = await rider("R2", { online: true });
  const R3 = await rider("R3", { online: false });
  const R4 = await rider("R4", { online: true, codOverdue: true });

  const admin = await user("Super Admin", "SUPER_ADMIN", "admin@test.local", "03009999999");

  return { customerA, addressA, customerB, S1, S2, S3, S4, S5, R1, R2, R3, R4, admin };
}

export type Fixtures = Awaited<ReturnType<typeof seedStandardFixtures>>;
