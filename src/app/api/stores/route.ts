import { NextRequest } from "next/server";
import { getSession, requireAuth, requireSuperAdmin } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { ensureCategoriesFromNames } from "@/lib/catalog/requested-categories";
import { StoreStatus } from "@prisma/client";
// D2 (GET + PATCH): admin list, approval guard, reasons, notifications
import {
  handleStoreDecision,
  listStoresForSuperAdmin,
  storeImpact,
  storeOptions,
} from "@/lib/catalog/admin-stores";

/**
 * Fields safe to return to anyone (logged out included). Never add owner contact,
 * CNIC, bank, IBAN, JazzCash, commission or exact address fields here.
 */
const PUBLIC_STORE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  coverUrl: true,
  status: true,
  isVirtual: true,
  area: true,
  city: true,
  province: true,
  approvedAt: true,
  createdAt: true,
  _count: { select: { products: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const mine = sp.get("mine") === "true";
    const status = sp.get("status") as StoreStatus | null;
    const slug = sp.get("slug");
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(50, parseInt(sp.get("limit") || "20", 10));

    if (slug) {
      const store = await prisma.store.findFirst({
        where: { slug, status: "APPROVED" },
        select: PUBLIC_STORE_SELECT,
      });
      if (!store) return apiError("Store not found", 404);
      return apiSuccess(store);
    }

    if (mine) {
      const session = await requireAuth();
      const stores = await prisma.store.findMany({
        where: {
          OR: [
            { ownerId: session.user.id },
            { members: { some: { userId: session.user.id, isActive: true } } },
          ],
        },
        include: {
          documents: true,
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return apiSuccess({ items: stores });
    }

    const session = await getSession();
    const isSuper = session?.user?.role === "SUPER_ADMIN";

    // D2: admin pickers, suspend impact, and the paginated / searchable MandiBazaar list
    if (sp.get("options") === "1") return storeOptions(isSuper);
    if (isSuper && sp.get("impact")) return storeImpact(String(sp.get("impact")));
    if (isSuper) return listStoresForSuperAdmin(sp);

    const where: Record<string, unknown> = {};
    if (isSuper && status) {
      where.status = status;
    } else if (!isSuper) {
      where.status = "APPROVED";
    }

    const listArgs = {
      where,
      orderBy: { createdAt: "desc" as const },
      skip: (page - 1) * limit,
      take: limit,
    };
    const [total, items] = await Promise.all([
      prisma.store.count({ where }),
      isSuper
        ? prisma.store.findMany({
            ...listArgs,
            include: {
              owner: { select: { id: true, fullName: true, phone: true, email: true } },
              documents: true,
              _count: { select: { products: true } },
            },
          })
        : prisma.store.findMany({ ...listArgs, select: PUBLIC_STORE_SELECT }),
    ]);

    return apiSuccess({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    console.error("[stores:api]", e);
    return apiError(toUserMessage(e), 500);
  }
}

/**
 * Store application (QA L3/L4/S2/N7). All S0 field rules, documents, categories,
 * payout and location checks live in submitStoreApplication.
 */
export async function POST(req: Request) {
  try {
    const { submitStoreApplication } = await import("@/lib/signup/store-application");
    return await submitStoreApplication(req);
  } catch (e) {
    console.error("[stores POST]", e);
    return apiError("Could not submit the store application. Please try again.", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSuperAdmin();
    const body = await req.json();
    const { storeId, action, ...updates } = body;
    if (typeof storeId !== "string" || !storeId) return apiError("storeId required", 400);

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return apiError("Store not found", 404);

    // APPROVE (needs payout + map location) / REJECT, SUSPEND (reason required) / REACTIVATE
    const decided = await handleStoreDecision(session.user, store, String(action || ""), body, async (s) => {
      const createRequested = body.createRequestedCategories !== false;
      const categoriesCreated =
        createRequested && s.requestedCategories?.length
          ? await ensureCategoriesFromNames(s.requestedCategories)
          : [];
      return { categoriesCreated };
    });
    if (decided) return decided;

    if (action === "CREATE_REQUESTED_CATEGORIES") {
      if (!store.requestedCategories?.length) {
        return apiError("This store did not request any categories", 400);
      }
      const created = await ensureCategoriesFromNames(store.requestedCategories);
      await writeAuditLog({
        userId: session.user.id,
        action: "STORE_REQUESTED_CATEGORIES_CREATED",
        entity: "Store",
        entityId: storeId,
        newValue: { created, requested: store.requestedCategories },
      });
      return apiSuccess({
        created,
        requested: store.requestedCategories,
        message:
          created.length > 0
            ? `Created ${created.length} categor${created.length === 1 ? "y" : "ies"}`
            : "All requested categories already exist",
      });
    }

    // Store owner / super admin profile updates (DP, bank, etc.)
    const allowed: Record<string, unknown> = {};
    for (const key of [
      "logoUrl",
      "coverUrl",
      "description",
      "phone",
      "email",
      "bankAccountTitle",
      "bankName",
      "bankAccountNumber",
      "bankIban",
      "jazzCashNumber",
      "jazzCashAccountTitle",
      "googleMapsUrl",
      "latitude",
      "longitude",
    ] as const) {
      if (updates[key] !== undefined) allowed[key] = updates[key];
    }

    if (Object.keys(allowed).length === 0) {
      return apiError("No valid updates", 400);
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: allowed,
    });
    return apiSuccess(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHORIZED") return apiError("Unauthorized", 401);
    if (msg === "FORBIDDEN") return apiError("Forbidden", 403);
    return apiError(toUserMessage(e), 400);
  }
}
