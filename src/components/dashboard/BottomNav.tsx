"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, flatten, type NavGroup, type NavItem } from "./nav";

/** Mobile bottom tab bar: up to 4 primary destinations + a "More" sheet that
 *  lists every remaining item, grouped. Thumb-friendly, always-visible. */
export function BottomNav({
  groups,
  primaryHrefs,
  rootHref,
  pathname,
}: {
  groups: NavGroup[];
  primaryHrefs: string[];
  rootHref: string;
  pathname: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const all = flatten(groups);
  const byHref = new Map(all.map((i) => [i.href, i]));
  const primary = primaryHrefs
    .map((h) => byHref.get(h))
    .filter((i): i is NavItem => Boolean(i))
    .slice(0, 4);

  const tab = (item: NavItem, active: boolean) => (
    <Link
      key={item.href}
      href={item.href}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
        active ? "text-brand-600 dark:text-brand-300" : "text-ink-subtle"
      )}
    >
      <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
      <span className="max-w-full truncate px-0.5">{item.short ?? item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-card" />
      )}
    </Link>
  );

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-card/95 backdrop-blur lg:hidden">
        {primary.map((item) => tab(item, isActive(item.href, pathname, rootHref)))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-ink-subtle"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.9} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <div className="animate-pop-in absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-line bg-card p-4 pb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">Menu</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="press flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-app"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {groups.map((group, gi) => (
              <div key={gi} className="mb-3">
                {group.label && (
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                    {group.label}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((item) => {
                    const active = isActive(item.href, pathname, rootHref);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium",
                          active
                            ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
                            : "border-line bg-card text-ink-muted hover:bg-app"
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {typeof item.badge === "number" && item.badge > 0 && (
                          <span className="rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
