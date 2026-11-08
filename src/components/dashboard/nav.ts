import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional count badge (e.g. items waiting for review). */
  badge?: number;
  badgeTitle?: string;
  /** Short label for the mobile bottom bar (falls back to `label`). */
  short?: string;
};

export type NavGroup = {
  /** Section heading in the desktop sidebar + More sheet. */
  label?: string;
  items: NavItem[];
};

/** Is this nav item the active one for the current path?
 *  The portal root (e.g. "/admin") matches only exactly; everything else
 *  matches on prefix so sub-pages keep their parent highlighted. */
export function isActive(href: string, pathname: string, rootHref: string): boolean {
  if (href === rootHref) return pathname === rootHref;
  return pathname === href || pathname.startsWith(href + "/") || pathname === href;
}

/** Flatten groups into a single ordered list (for the More sheet / lookups). */
export function flatten(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}
