"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingCart,
  Users,
  Bike,
  CreditCard,
  Ticket,
  Star,
  BarChart3,
  TrendingUp,
  Settings,
  ScrollText,
  Warehouse,
  RotateCcw,
  Store,
  Wallet,
  UserCog,
  Images,
  HandCoins,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import type { NavGroup } from "@/components/dashboard/nav";

/** Items waiting for review, shown as nav badges (QA P4). */
type ReviewCounts = { stores: number; products: number; productChanges: number; riders: number };

const ADMIN_PRIMARY = ["/admin", "/admin/orders", "/admin/stores", "/admin/finance"];

function buildGroups(c: ReviewCounts | null): NavGroup[] {
  const storeBadge = c && c.stores > 0 ? c.stores : undefined;
  const productBadge = c && c.products + c.productChanges > 0 ? c.products + c.productChanges : undefined;
  const riderBadge = c && c.riders > 0 ? c.riders : undefined;
  return [
    {
      label: "Overview",
      items: [
        { href: "/admin", label: "Dashboard", short: "Home", icon: LayoutDashboard },
        { href: "/admin/reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      label: "Catalog",
      items: [
        {
          href: "/admin/stores",
          label: "Stores",
          icon: Store,
          badge: storeBadge,
          badgeTitle: storeBadge ? `${storeBadge} store application(s) waiting for review` : undefined,
        },
        {
          href: "/admin/products",
          label: "Products",
          icon: Package,
          badge: productBadge,
          badgeTitle: productBadge ? `${c?.products} new and ${c?.productChanges} changed product(s) waiting for review` : undefined,
        },
        { href: "/admin/categories", label: "Categories", icon: FolderTree },
        { href: "/admin/inventory", label: "Inventory", icon: Warehouse },
        { href: "/admin/carousel", label: "Carousel", icon: Images },
      ],
    },
    {
      label: "Orders & Delivery",
      items: [
        { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
        {
          href: "/admin/riders",
          label: "Riders",
          icon: Bike,
          badge: riderBadge,
          badgeTitle: riderBadge ? `${riderBadge} rider application(s) waiting for review` : undefined,
        },
        { href: "/admin/bidding", label: "Rider Bidding", short: "Bidding", icon: Bike },
      ],
    },
    {
      label: "Finance",
      items: [
        { href: "/admin/payments", label: "Payments", icon: CreditCard },
        { href: "/admin/payouts", label: "Payouts", icon: Wallet },
        { href: "/admin/cash-collection", label: "Cash Collection", short: "Cash", icon: HandCoins },
        { href: "/admin/finance", label: "Finance", icon: TrendingUp },
        { href: "/admin/refunds", label: "Refunds", icon: RotateCcw },
        { href: "/admin/coupons", label: "Coupons", icon: Ticket },
      ],
    },
    {
      label: "People",
      items: [
        { href: "/admin/customers", label: "Customers", icon: Users },
        { href: "/admin/staff", label: "Staff", icon: UserCog },
        { href: "/admin/reviews", label: "Reviews", icon: Star },
      ],
    },
    {
      label: "System",
      items: [
        { href: "/admin/settings", label: "Settings", icon: Settings },
        { href: "/admin/audit-logs", label: "Audit Logs", short: "Logs", icon: ScrollText },
      ],
    },
  ];
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [counts, setCounts] = useState<ReviewCounts | null>(null);

  // Refresh the waiting-for-review counts on every admin page change
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/admin?resource=review-counts")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.success) setCounts(d.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, pathname]);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      window.location.assign("/login?portal=admin&callbackUrl=/admin");
      return;
    }
    if (
      status === "authenticated" &&
      !["SUPER_ADMIN", "ADMIN", "ORDER_MANAGER", "INVENTORY_MANAGER", "DELIVERY_MANAGER"].includes(
        session?.user?.role || ""
      )
    ) {
      router.replace("/");
    }
  }, [status, session, router]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app text-ink-subtle">
        Loading admin…
      </div>
    );
  }

  return (
    <DashboardShell
      portalLabel="Admin portal"
      portalIcon={LayoutDashboard}
      rootHref="/admin"
      groups={buildGroups(counts)}
      primaryHrefs={ADMIN_PRIMARY}
      user={{ name: session?.user?.name, role: session?.user?.role }}
      onSignOut={() => signOut({ callbackUrl: "/login?portal=admin" })}
      headerActions={
        <Link
          href="/"
          className="hidden rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-app hover:text-ink sm:inline-flex"
        >
          View store
        </Link>
      }
    >
      {children}
    </DashboardShell>
  );
}
