"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  Wallet,
  Store,
  Tag,
  HelpCircle,
  TrendingUp,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import type { NavGroup } from "@/components/dashboard/nav";
import { StorePendingApproval } from "@/components/store/StorePendingApproval";

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/store-portal", label: "Dashboard", short: "Home", icon: LayoutDashboard },
      { href: "/store-portal/products", label: "Products", icon: Package },
      { href: "/store-portal/deals", label: "Deals", icon: Tag },
      { href: "/store-portal/orders", label: "Orders", icon: ShoppingCart },
      { href: "/store-portal/finance", label: "Earnings", icon: TrendingUp },
      { href: "/store-portal/payouts", label: "Payouts", icon: Wallet },
      { href: "/store-portal/settings", label: "Store profile", short: "Profile", icon: Settings },
      // F6: reopen the welcome tour any time (never forced after it's done)
      { href: "/onboarding/store?force=1&next=/store-portal", label: "Guide", icon: HelpCircle },
    ],
  },
];

const STORE_PRIMARY = ["/store-portal", "/store-portal/products", "/store-portal/orders", "/store-portal/finance"];

export default function StorePortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const router = useRouter();
  // "checking" until we know whether this owner has an approved store; "blocked"
  // shows the Pending Approval screen in place (they stay signed in).
  const [access, setAccess] = useState<"checking" | "allowed" | "blocked">("checking");
  const [blockReason, setBlockReason] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      window.location.assign("/store?tab=login");
      return;
    }
    if (status === "authenticated" && !["STORE_OWNER", "SUPER_ADMIN"].includes(session?.user?.role || "")) {
      router.replace("/");
      return;
    }

    if (session?.user?.role === "SUPER_ADMIN") {
      setAccess("allowed");
      return;
    }

    let cancelled = false;
    setAccess("checking");
    fetch("/api/store/access", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success && d.data.allowed) {
          setAccess("allowed");
        } else {
          setBlockReason(d?.data?.reason ?? null);
          setAccess("blocked");
        }
      })
      .catch(() => {
        if (!cancelled) setAccess("allowed"); // fail open to the portal's own guards
      });

    return () => {
      cancelled = true;
    };
  }, [status, session, router]);

  if (status === "loading" || status === "unauthenticated" || access === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app text-ink-subtle">
        Loading store portal…
      </div>
    );
  }

  // Store owner without an approved store: hold them on the Pending Approval
  // screen. The re-apply page is the one exception — it renders standalone (no
  // dashboard shell) so they can submit a fresh application.
  if (access === "blocked") {
    if (pathname === "/store-portal/reapply") return <>{children}</>;
    return <StorePendingApproval reason={blockReason} />;
  }

  return (
    <DashboardShell
      portalLabel="Store portal"
      portalIcon={Store}
      rootHref="/store-portal"
      groups={GROUPS}
      primaryHrefs={STORE_PRIMARY}
      user={{ name: session?.user?.name, role: "Store Owner" }}
      onSignOut={() => signOut({ callbackUrl: "/store" })}
      headerActions={
        <>
          <Link
            href="/"
            className="hidden rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-app hover:text-ink md:inline-flex"
          >
            View shop
          </Link>
          <Link
            href="/store?tab=signup&add=1"
            className="hidden rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-app hover:text-ink lg:inline-flex"
          >
            Add store
          </Link>
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}
