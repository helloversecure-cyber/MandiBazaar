import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";

function nameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Normalize free-text category names from store applications. */
export function normalizeRequestedCategories(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,|\n]/)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of list) {
    const name = String(item || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    if (name.length < 2) continue;
    const key = slugify(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 20) break;
  }

  return out;
}

/**
 * Create any missing categories from free-text store-request names. Returns the
 * newly created names. An EXISTING category is left exactly as the admin set it —
 * never silently reactivated or renamed (that would override a deliberate
 * deactivation and clobber the admin's display name). New categories are created
 * INACTIVE with no image, matching the platform's image-to-activate rule and the
 * admin approve dialog ("add an image before activating").
 */
export async function ensureCategoriesFromNames(names: string[]) {
  const normalized = normalizeRequestedCategories(names);
  const created: string[] = [];

  for (const name of normalized) {
    const slug = slugify(name);
    if (!slug) continue;
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) continue; // respect the admin's existing active state + name
    const maxSort = await prisma.category.aggregate({
      _max: { sortOrder: true },
    });
    await prisma.category.create({
      data: {
        name,
        slug,
        isActive: false,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        description: `Shop ${name.toLowerCase()} from MandiBazaar stores`,
      },
    });
    created.push(name);
  }

  return created;
}

/** Resolve a single category id from a free-text name (create if missing). */
export async function ensureCategoryIdFromName(name: string): Promise<string> {
  const [normalized] = normalizeRequestedCategories([name]);
  if (!normalized) {
    throw new Error("Enter a valid category name");
  }
  await ensureCategoriesFromNames([normalized]);
  const slug = slugify(normalized);
  const cat = await prisma.category.findUnique({ where: { slug } });
  if (!cat) throw new Error("Could not create category");
  return cat.id;
}

/**
 * Active MandiBazaar categories that match a store's requested category names.
 * Case-insensitive name match.
 */
export async function categoriesForStore(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { requestedCategories: true },
  });
  if (!store) return { storeRequested: [] as string[], items: [] as { id: string; name: string }[] };

  const requested = normalizeRequestedCategories(store.requestedCategories);
  const requestedKeys = new Set(requested.map(nameKey));

  const all = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  // Prefer store's signup selections that MandiBazaar has created.
  // If none match yet (or legacy store with empty list), show all active
  // so the store can still list products (+ Others for new names).
  const matched = requestedKeys.size
    ? all.filter((c) => requestedKeys.has(nameKey(c.name)))
    : [];
  const items = matched.length > 0 ? matched : all;

  return {
    storeRequested: requested,
    items,
    /** All active platform categories (for signup pickers). */
    allActive: all,
  };
}
