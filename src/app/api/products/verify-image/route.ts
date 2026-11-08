import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { verifyProductImages, visionEnabled } from "@/lib/products/verify-image";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROLES = ["STORE_OWNER", "SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"];

/** Tells the product form whether a real automatic photo check exists (QA N8). */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  if (!ROLES.includes(session.user.role || "")) return apiError("Forbidden", 403);
  return apiSuccess({ visionEnabled: visionEnabled() });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!ROLES.includes(session.user.role || "")) return apiError("Forbidden", 403);

    const rl = rateLimit(`verify-image:${session.user.id}:${clientIp(req)}`, 20, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError("Too many photo checks. Please wait a few minutes.", 429);
    }

    const body = await req.json();
    const productName = String(body.productName || "").trim().slice(0, 120);
    const description = String(body.description || "").slice(0, 2000);
    const categoryName = body.categoryName ? String(body.categoryName).slice(0, 80) : undefined;
    const imageUrls: string[] = Array.isArray(body.imageUrls)
      ? body.imageUrls.map((u: unknown) => String(u)).filter(Boolean)
      : body.imageUrl
        ? [String(body.imageUrl)]
        : [];

    if (!productName) return apiError("Enter the product name first", 400);
    if (!imageUrls.length) return apiError("Upload at least one image", 400);

    const result = await verifyProductImages({
      productName,
      description,
      categoryName,
      imageUrls,
    });

    return apiSuccess(result);
  } catch (e) {
    console.error("[verify-image]", e);
    return apiError("Couldn't verify the photos — an admin will review them.", 500);
  }
}
