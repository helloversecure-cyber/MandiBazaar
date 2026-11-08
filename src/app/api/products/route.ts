import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { listProducts } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

/**
 * Public product list (All products, Search, Deals, Store pages, home category picker).
 * Only ACTIVE products from APPROVED stores. See listProducts() for the query params.
 * Response: { items, pagination: {page, limit, total, totalPages}, context }
 */
export async function GET(req: NextRequest) {
  try {
    const result = await listProducts(req.nextUrl.searchParams, { includeVariants: true });
    return apiSuccess(result);
  } catch (e) {
    console.error("[api/products]", e);
    return apiError("Failed to load products", 500);
  }
}
