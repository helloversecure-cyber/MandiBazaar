"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BottomNav } from "./BottomNav";
import { isActive, type NavGroup } from "./nav";

/** One light, theme-aware dashboard shell for Admin / Store / Rider.
 *  Desktop: grouped sidebar + topbar. Mobile: topbar + bottom tab bar + More.
 *  Each portal keeps its own guards/data-fetching and just renders children here. */
export function DashboardShell({
  portalLabel,
  portalIcon: PortalIcon,
  rootHref,
  homeHref = "/",
  groups,
  primaryHrefs,
  user,
  onSignOut,
  headerActions,
  children,
}: {
  portalLabel: string;
  portalIcon?: LucideIcon;
  rootHref: string;
  homeHref?: string;
  groups: NavGroup[];
  primaryHrefs: string[];
  user?: { name?: string | null; role?: string | null };
  onSignOut: () => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-app text-ink">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card lg:flex">
        <div className="px-5 py-5">
          <Link href={homeHref} className="font-display text-xl font-extrabold text-ink hover:opacity-90">
            Mandi<span className="text-brand-600">Bazaar</span>
          </Link>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-subtle">
            {PortalIcon && <PortalIcon className="h-3 w-3" />} {portalLabel}
          </p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, pathname, rootHref);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                        active
                          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "text-ink-muted hover:bg-app hover:text-ink"
                      )}
                    >
                      <item.icon
                        className={cn("h-4 w-4 shrink-0", active ? "text-brand-600 dark:text-brand-300" : "")}
                        strokeWidth={active ? 2.3 : 1.9}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {typeof item.badge === "number" && item.badge > 0 && (
                        <span
                          title={item.badgeTitle}
                          aria-label={item.badgeTitle}
                          className="min-w-5 rounded-full bg-accent-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white"
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-3 py-3">
          <button
            type="button"
            onClick={onSignOut}
            className="press flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-muted hover:bg-app hover:text-ink"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-card/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <div className="min-w-0">
            <Link href={homeHref} className="font-display text-base font-extrabold text-ink lg:hidden">
              Mandi<span className="text-brand-600">Bazaar</span>
            </Link>
            {user && (
              <p className="hidden truncate text-sm text-ink-muted lg:block">
                {user.name}
                {user.role ? <span className="text-ink-subtle"> · {user.role}</span> : null}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            <ThemeToggle />
            <button
              type="button"
              onClick={onSignOut}
              className="press hidden items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 sm:inline-flex"
            >
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 lg:p-8 lg:pb-8">{children}</main>
      </div>

      <BottomNav groups={groups} primaryHrefs={primaryHrefs} rootHref={rootHref} pathname={pathname} />
    </div>
  );
}
