/**
 * Category rules (QA P11 / S13). Pure — used by the admin form and the API.
 */
import { slugify } from "@/lib/utils";

/** "  Daal   &  Pulses " → "daal & pulses" (duplicates ignore case and extra spaces). */
export function categoryNameKey(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type CategoryLike = { id: string; name: string; slug?: string | null };

/**
 * Existing category that clashes with `name` (same name ignoring case/spaces, or
 * the same URL slug, e.g. "Daal & Pulses" vs "Daal Pulses"). `excludeId` skips
 * the category being edited.
 */
export function findDuplicateCategory<T extends CategoryLike>(
  name: string,
  list: T[],
  excludeId?: string | null
): T | null {
  const key = categoryNameKey(name);
  const slug = slugify(name);
  for (const c of list) {
    if (excludeId && c.id === excludeId) continue;
    if (categoryNameKey(c.name) === key) return c;
    if (slug && (c.slug || slugify(c.name)) === slug) return c;
  }
  return null;
}

export function duplicateCategoryMessage(existing: { name: string }): string {
  return `A category named "${existing.name}" already exists`;
}

export const CATEGORY_IMAGE_REQUIRED_MSG =
  "Add a category image before activating it — customers see it on the homepage";

/** Error text if a category with this image can't be active, else null. */
export function categoryActivationError(c: { imageUrl?: string | null; isActive?: boolean }): string | null {
  if (c.isActive && !String(c.imageUrl || "").trim()) return CATEGORY_IMAGE_REQUIRED_MSG;
  return null;
}

/** Local `/uploads/...` or https URL (http allowed for legacy dev rows). */
export function isAllowedCategoryImageUrl(url: string): boolean {
  const v = url.trim();
  if (!v) return true;
  if (v.startsWith("//")) return false;
  return v.startsWith("/") || v.startsWith("https://") || v.startsWith("http://");
}
