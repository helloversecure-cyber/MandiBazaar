"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Package,
  Wallet,
  Bike,
  UserCircle,
  TrendingUp,
  HelpCircle,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import type { NavGroup } from "@/components/dashboard/nav";

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/rider-portal", label: "Dashboard", short: "Home", icon: LayoutDashboard },
      { href: "/rider-portal/bids", label: "Delivery requests", short: "Requests", icon: Bike },
      { href: "/rider-portal/deliveries", label: "Deliveries", icon: Package },
      { href: "/rider-portal/remittances", label: "Cash to MandiBazaar", short: "Cash", icon: Wallet },
      { href: "/rider-portal/earnings", label: "My earnings", short: "Earnings", icon: TrendingUp },
      { href: "/rider-portal/profile", label: "My profile", short: "Profile", icon: UserCircle },
      // F6: reopen the welcome tour any time
      { href: "/onboarding/rider?force=1&next=/rider-portal", label: "Guide", icon: HelpCircle },
    ],
  },
];

const RIDER_PRIMARY = [
  "/rider-portal",
  "/rider-portal/bids",
  "/rider-portal/deliveries",
  "/rider-portal/remittances",
];

export default function RiderPortalLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      window.location.assign("/login?portal=rider&callbackUrl=/rider-portal");
      return;
    }
    if (status === "authenticated" && session?.user?.role !== "RIDER") {
      router.replace("/");
    }
  }, [status, session, router]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app text-ink-subtle">
        Loading rider portal…
      </div>
    );
  }

  return (
    <DashboardShell
      portalLabel="Rider portal"
      portalIcon={Bike}
      rootHref="/rider-portal"
      homeHref="/rider-portal"
      groups={GROUPS}
      primaryHrefs={RIDER_PRIMARY}
      user={{ name: session?.user?.name, role: "Rider" }}
      onSignOut={() => signOut({ callbackUrl: "/login?portal=rider" })}
    >
      {children}
    </DashboardShell>
  );
}
