"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  User,
  Package,
  MapPin,
  Heart,
  Star,
  Bell,
  Lock,
  LogOut,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/account", label: "Overview", icon: User, exact: true },
  { href: "/account/orders", label: "My orders", icon: Package },
  { href: "/account/addresses", label: "Addresses", icon: MapPin },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/account/reviews", label: "Reviews", icon: Star },
  { href: "/account/notifications", label: "Notifications", icon: Bell },
  { href: "/account/security", label: "Password", icon: Lock },
];

/** F6: reopen the welcome tour (never forced once done). */
const GUIDE_HREF = "/onboarding/customer?force=1&next=/account";

export function AccountSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="lg:sticky lg:top-36 lg:self-start">
      {/* Phones (QA M1): one compact row of scrollable tabs, content right below */}
      <nav
        aria-label="Account menu"
        className="-mx-4 flex gap-2 overflow-x-auto border-b border-line px-4 pb-3 lg:hidden"
      >
        {links.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold",
                active ? "bg-brand-600 text-white" : "bg-card text-ink-muted ring-1 ring-line"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
        <Link
          href={GUIDE_HREF}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-ink-muted ring-1 ring-line"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          How it works
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-deal-600 ring-1 ring-red-100"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </nav>

      {/* Desktop: full side menu */}
      <div className="hidden rounded-2xl border border-line bg-card p-4 shadow-card lg:block lg:p-5">
        <div className="mb-4 flex items-center gap-3 border-b border-line pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-sm font-bold text-brand-700">
            {(session?.user?.name?.[0] || "U").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {session?.user?.name || "My account"}
            </p>
            <p className="truncate text-xs text-ink-subtle">{session?.user?.email}</p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {links.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-muted hover:bg-app"
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
                <ChevronRight className="h-3.5 w-3.5 opacity-40" />
              </Link>
            );
          })}
          <Link
            href={GUIDE_HREF}
            className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-app"
          >
            <span className="flex items-center gap-2.5">
              <HelpCircle className="h-4 w-4" />
              How it works
            </span>
            <ChevronRight className="h-3.5 w-3.5 opacity-40" />
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="mt-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-deal-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </nav>
      </div>
    </aside>
  );
}
