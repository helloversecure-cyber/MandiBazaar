"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Sub-navigation for Admin → Bidding (W15): item lists, needs rider, checkout rider bids, settings. */
const TABS = [
  { href: "/admin/bidding/lists", label: "Item lists" },
  { href: "/admin/bidding/needs-rider", label: "Needs rider" },
  { href: "/admin/bidding", label: "Checkout rider bids" },
  { href: "/admin/bidding/settings", label: "Settings" },
];

export function BiddingTabs({ needsRider }: { needsRider?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Bidding sections" className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {TABS.map((t) => {
        const active = t.href === "/admin/bidding" ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition",
              active ? "bg-brand-600 text-white shadow-sm" : "bg-card text-ink-muted ring-1 ring-line hover:text-ink"
            )}
          >
            {t.label}
            {t.href === "/admin/bidding/needs-rider" && needsRider ? (
              <span className="rounded-full bg-accent-500 px-1.5 text-[11px] font-bold text-white">{needsRider}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
