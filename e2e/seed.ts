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
  console.log("e2e seed: fixtures + %d products", items.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
