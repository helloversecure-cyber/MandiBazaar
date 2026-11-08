"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { safeNext } from "@/lib/onboarding/complete";

/** Onboarding lives inside shop layout — minimal wrapper */
export default function OnboardingLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/auth/onboarding")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data.completed) {
          const role = data.data.role as string;
          const dest =
            role === "SUPER_ADMIN" ||
            role === "ADMIN" ||
            role === "ORDER_MANAGER" ||
            role === "INVENTORY_MANAGER" ||
            role === "DELIVERY_MANAGER"
              ? "/admin"
              : role === "STORE_OWNER"
                ? "/store-portal"
                : role === "RIDER"
                  ? "/rider-portal"
                  : "/products";
          // Only redirect if user navigated to onboarding manually after completing
          const path = window.location.pathname;
          if (path.startsWith("/onboarding")) {
            const params = new URLSearchParams(window.location.search);
            if (!params.get("force")) {
              window.location.replace(safeNext(params.get("next"), dest));
            }
          }
        }
      })
      .catch(() => {});
  }, [status]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/80 to-slate-50">
      {children}
    </div>
  );
}
