/** Seed for browser tests: standard fixtures + a handful of active products. */
import "../tests/setup";
import { prisma, resetDb } from "../tests/helpers/db";
import { seedStandardFixtures } from "../tests/helpers/fixtures";

async function main() {
  await resetDb();
  const f = await seedStandardFixtures();
  const grocery = await prisma.category.findUniqueOrThrow({ where: { slug: "grocery" } });
  const items = [
    ["Atta 10kg", "atta-10kg", 1850, "bag"],
    ["Basmati Rice 5kg", "basmati-rice-5kg", 1650, "bag"],
    ["Milk 1L", "milk-1l", 230, "pack"],
    ["Daal Masoor 1kg", "daal-masoor-1kg", 420, "kg"],
    // L-10: a long Urdu item name must wrap, never overflow its card.
    ["خالص چکی والا گندم کا آٹا دس کلو گرام تھیلا", "urdu-chakki-atta", 1900, "bag"],
  ] as const;
  for (const [name, slug, price, unit] of items) {
    await prisma.product.create({
      data: {
        storeId: f.S1.id,
        categoryId: grocery.id,
        name,
        slug,
        sku: slug.toUpperCase(),
        price,
        unit,
        stockQuantity: 50,
        status: "ACTIVE",
      },
    });
  }
  // One throwaway customer per width for the account-deletion browser test.
  for (const w of [360, 390, 768, 1024, 1280, 1440]) {
    await prisma.user.create({
      data: { fullName: `Delete Me ${w}`, email: `delete.w${w}@test.local`, roleId: f.customerA.roleId, emailVerified: new Date() },
    });
  }
  // W18: one customer per width with a saved address for the cart checkout journey
  // (e2e/journeys.spec.ts), so each width starts with an empty cart.
  for (const w of [360, 390, 768, 1024, 1280, 1440]) {
    const phone = `0302000${String(w).padStart(4, "0")}`;
    const u = await prisma.user.create({
      data: {
        fullName: "Journey Tester", // checkout accepts letters only
        email: `journey.w${w}@test.local`,
        phone,
        roleId: f.customerA.roleId,
        emailVerified: new Date(),
        onboardingCompleted: true,
      },
    });
    const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...addr } = f.addressA;
    await prisma.address.create({ data: { ...addr, userId: u.id, fullName: u.fullName, phone } });
  }
  // One delivered order so /account/orders and its detail page have content.
  const atta = await prisma.product.findUniqueOrThrow({
    where: { storeId_slug: { storeId: f.S1.id, slug: "atta-10kg" } },
  });
  const a = f.addressA;
  await prisma.order.create({
    data: {
      orderNumber: "MB-E2E-0001",
      customerId: f.customerA.id,
      subtotal: 1850,
      deliveryFee: 150,
      grandTotal: 2000,
      remainingAmount: 0,
      paymentMethod: "CASH_ON_DELIVERY",
      deliveryFeePaymentStatus: "PAID",
      productPaymentStatus: "PAID",
      orderStatus: "DELIVERED",
      deliveryAddressSnapshot: {
        fullName: a.fullName,
        phone: a.phone,
        houseBuilding: a.houseBuilding,
        area: a.area,
        city: a.city,
        province: a.province,
        latitude: a.latitude,
        longitude: a.longitude,
      },
      items: {
        create: {
          storeId: f.S1.id,
          storeName: f.S1.name,
          productId: atta.id,
          productName: atta.name,
          sku: atta.sku,
          unit: atta.unit,
          quantity: 1,
          unitPrice: 1850,
          finalPrice: 1850,
        },
      },
      fulfillments: {
        create: {
          storeId: f.S1.id,
          status: "DELIVERED",
          subtotal: 1850,
          itemCount: 1,
          pickupAddress: { addressLine: f.S1.addressLine, area: f.S1.area, city: f.S1.city },
        },
      },
    },
  });
  // W17: content for the rider portal pages. Rider R3 (offline, not used by the bidding
  // specs) delivered MB-E2E-0001 and is out with a COD cart order for Customer B
  // (MB-E2E-0002), so Deliveries, Earnings and Cash have rows and action buttons.
  const now = Date.now();
  const delivered = await prisma.order.update({ where: { orderNumber: "MB-E2E-0001" }, data: { riderId: f.R3.id } });
  await prisma.delivery.create({
    data: {
      orderId: delivered.id,
      riderId: f.R3.id,
      assignedAt: new Date(now - 3 * 3600_000),
      pickedUpAt: new Date(now - 2.5 * 3600_000),
      deliveredAt: new Date(now - 2 * 3600_000),
      riderFee: 150,
    },
  });
  const rice = await prisma.product.findUniqueOrThrow({
    where: { storeId_slug: { storeId: f.S1.id, slug: "basmati-rice-5kg" } },
  });
  await prisma.order.create({
    data: {
      orderNumber: "MB-E2E-0002",
      customerId: f.customerB.id,
      riderId: f.R3.id,
      subtotal: 1650,
      deliveryFee: 150,
      grandTotal: 1800,
      remainingAmount: 1800,
      paymentMethod: "CASH_ON_DELIVERY",
      orderStatus: "OUT_FOR_DELIVERY",
      deliveryAddressSnapshot: {
        fullName: "Customer B",
        phone: "03007654321",
        houseBuilding: "House 22, Street 4, near the long-named Jamia Masjid",
        area: "Model Town",
        city: "Lahore",
        province: "Punjab",
        latitude: a.latitude,
        longitude: a.longitude,
      },
      items: {
        create: {
          storeId: f.S1.id,
          storeName: f.S1.name,
          productId: rice.id,
          productName: rice.name,
          sku: rice.sku,
          unit: rice.unit,
          quantity: 1,
          unitPrice: 1650,
          finalPrice: 1650,
        },
      },
      fulfillments: {
        create: {
          storeId: f.S1.id,
          status: "OUT_FOR_DELIVERY",
          subtotal: 1650,
          itemCount: 1,
          pickupAddress: { addressLine: f.S1.addressLine, area: f.S1.area, city: f.S1.city },
        },
      },
      delivery: {
        create: { riderId: f.R3.id, assignedAt: new Date(now - 1800_000), pickedUpAt: new Date(now - 900_000) },
      },
    },
  });
  console.log("e2e seed: fixtures + %d products + 2 orders", items.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
