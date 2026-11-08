"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { useEffect, useRef } from "react";
import { mergeGuestCartToServer } from "@/lib/store/guest-cart";
import { useCartStore } from "@/lib/store/cart";
import { FeedbackProvider } from "@/components/ui/feedback";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

function GuestCartMerger({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const bump = useCartStore((s) => s.bump);
  const did = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || did.current) return;
    did.current = true;
    mergeGuestCartToServer().then((n) => {
      if (n > 0) bump();
    });
  }, [status, bump]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <FeedbackProvider>
          <GuestCartMerger>{children}</GuestCartMerger>
        </FeedbackProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
