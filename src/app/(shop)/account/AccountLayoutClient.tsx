"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { ShopContainer } from "@/components/layout/ShopContainer";

export default function AccountLayoutClient({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/account");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <ShopContainer width="xl">
        <div className="skeleton h-64 rounded-2xl" />
      </ShopContainer>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <ShopContainer width="xl">
      {/* grid-cols-1 (minmax(0,1fr)) keeps the single mobile/tablet column at screen
          width; without it the column grows to the scrolling tab row (~1070px at 768). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr] lg:gap-8">
        <AccountSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </ShopContainer>
  );
}
