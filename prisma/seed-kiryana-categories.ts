/**
 * Predefined platform categories for a Lahore local kiryana market, created by
 * MandiBazaar (super admin). Each has a real, category-specific image so it shows
 * on the homepage "Shop by category" tiles and in the store-signup picker.
 *
 * Idempotent: upserts by slug, so it is safe to re-run on any database.
 * Run (LOCAL):      npx tsx prisma/seed-kiryana-categories.ts
 * Run (PRODUCTION): DATABASE_URL="<neon-direct-url>" npx tsx prisma/seed-kiryana-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const IMG = (id: string) => `https://images.unsplash.com/${id}?w=600&q=80&auto=format&fit=crop`;

const CATEGORIES: {
  name: string;
  slug: string;
  image: string;
  description: string;
}[] = [
  { name: "Rice", slug: "rice", image: IMG("photo-1586201375761-83865001e31c"), description: "Basmati, sella and everyday chawal" },
  { name: "Daal & Pulses", slug: "daal-pulses", image: IMG("photo-1515543237350-b3eea1ec8082"), description: "Masoor, moong, chana, maash and more" },
  { name: "Atta & Flour", slug: "atta-flour", image: IMG("photo-1574323347407-f5e1ad6d020b"), description: "Wheat atta, maida and chakki flour" },
  { name: "Besan & Gram Flour", slug: "besan-gram-flour", image: IMG("photo-1509440159596-0249088772ff"), description: "Besan and gram flour for cooking" },
  { name: "Cooking Oil & Ghee", slug: "cooking-oil-ghee", image: IMG("photo-1474979266404-7eaacbcd87c5"), description: "Cooking oil, banaspati and desi ghee" },
  { name: "Sugar & Salt", slug: "sugar-salt", image: IMG("photo-1581441363689-1f3c3c414635"), description: "Cheeni, gur and namak" },
  { name: "Spices & Masala", slug: "spices-masala", image: IMG("photo-1596040033229-a9821ebd058d"), description: "Whole and ground masala, haldi, mirch" },
  { name: "Tea & Beverages", slug: "tea-beverages", image: IMG("photo-1564890369478-c89ca6d9cde9"), description: "Chai patti, soft drinks and juices" },
  { name: "Dry Fruits & Nuts", slug: "dry-fruits-nuts", image: IMG("photo-1508747703725-719777637510"), description: "Almonds, walnuts, dates and more" },
  { name: "Vegetables", slug: "vegetables", image: IMG("photo-1540420773420-3366772f4999"), description: "Fresh seasonal sabzi" },
  { name: "Fruits", slug: "fruits", image: IMG("photo-1619566636858-adf3ef46400b"), description: "Fresh seasonal phal" },
  { name: "Dairy & Eggs", slug: "dairy-eggs", image: IMG("photo-1550583724-b2692b85b150"), description: "Doodh, dahi, butter and anday" },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    const existing = await prisma.category.findUnique({ where: { slug: c.slug } });
    await prisma.category.upsert({
      where: { slug: c.slug },
      create: {
        name: c.name,
        slug: c.slug,
        imageUrl: c.image,
        description: c.description,
        isActive: true,
        sortOrder: i + 1,
      },
      update: {
        name: c.name,
        imageUrl: c.image,
        description: c.description,
        isActive: true,
        sortOrder: i + 1,
      },
    });
    if (existing) updated++;
    else created++;
  }
  const total = await prisma.category.count({ where: { isActive: true } });
  console.log(`Kiryana categories seeded — created ${created}, updated ${updated}. Active categories now: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
