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
  console.log("e2e seed: fixtures + %d products + 1 order", items.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
