import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/auth";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiSuccess } from "@/lib/utils";
import { isSafeLink } from "@/lib/validators/safe-link";

export const dynamic = "force-dynamic";

type SlideInput = {
  id?: string;
  imageUrl: string;
  tag?: string;
  title: string;
  sub?: string;
  cta?: string;
  href?: string;
  accent?: string;
  stat?: string;
  sortOrder: number;
  isActive?: boolean;
};

export async function GET() {
  try {
    await requireAdmin(PERMISSIONS.SETTINGS_WRITE);
    const items = await prisma.heroSlide.findMany({
      orderBy: { sortOrder: "asc" },
    });
    return apiSuccess({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unauthorized";
    return apiError(msg, 401);
  }
}

/** Replace all carousel slides (exactly up to 3 recommended) */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin(PERMISSIONS.SETTINGS_WRITE);
    const body = await req.json();
    const slides = (body?.slides || []) as SlideInput[];

    if (!Array.isArray(slides)) {
      return apiError("slides array required", 400);
    }
    if (slides.length > 6) {
      return apiError("Maximum 6 carousel slides", 400);
    }

    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      if (!s?.imageUrl?.trim()) {
        return apiError(`Slide ${i + 1}: image is required`, 400);
      }
      if (!s?.title?.trim()) {
        return apiError(`Slide ${i + 1}: title is required`, 400);
      }
      const img = s.imageUrl.trim();
      if (!img.startsWith("/") && !img.startsWith("https://")) {
        return apiError(`Slide ${i + 1}: image must be an uploaded image or https:// link`, 400);
      }
      if (s.href?.trim() && !isSafeLink(s.href)) {
        return apiError(
          `Slide ${i + 1}: button link must be a site page like /products or an https:// link`,
          400
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.heroSlide.deleteMany({});
      if (slides.length) {
        await tx.heroSlide.createMany({
          data: slides.map((s, i) => ({
            imageUrl: s.imageUrl.trim(),
            tag: (s.tag || "").trim(),
            title: s.title.trim(),
            sub: (s.sub || "").trim(),
            cta: (s.cta || "Shop now").trim(),
            href: (s.href || "/products").trim() || "/products",
            accent:
              (s.accent || "from-brand-600 via-emerald-600 to-teal-500").trim(),
            stat: (s.stat || "").trim(),
            sortOrder: Number.isFinite(s.sortOrder) ? s.sortOrder : i,
            isActive: s.isActive !== false,
          })),
        });
      }
    });

    const items = await prisma.heroSlide.findMany({
      orderBy: { sortOrder: "asc" },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "HERO_CAROUSEL_UPDATED",
      entity: "HeroSlide",
      newValue: { count: items.length },
    });

    return apiSuccess({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save";
    return apiError(msg, 400);
  }
}
