import { prisma } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { NextResponse } from "next/server";

/** Always fresh — admin may add categories anytime; never serve a stale list to stores. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { products: { where: { status: "ACTIVE" } } } },
      },
    });

    const res = NextResponse.json(
      { success: true, data: categories },
      { status: 200 }
    );
    res.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0"
    );
    return res;
  } catch {
    return apiError("Failed to load categories", 500);
  }
}
