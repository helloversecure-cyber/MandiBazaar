import { prisma } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Public homepage carousel slides */
export async function GET() {
  const items = await prisma.heroSlide.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    take: 6,
  });
  return apiSuccess({ items });
}
