"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { getDefaultDest } from "@/lib/onboarding/flows";
import { safeCallbackUrl } from "@/lib/auth/identifier";

const AREAS = {
  admin: {
    title: "This page is for MandiBazaar admins only",
    body: "Your account doesn't have admin access.",
    login: "/login?portal=admin",
  },
  store: {
    title: "This page is for store owners only",
    body: "Your account isn't a store owner account. To sell on MandiBazaar, create a store first.",
    login: "/store?tab=login",
  },
  rider: {
    title: "This page is for riders only",
    body: "Your account isn't a rider account. Want to deliver with MandiBazaar? Apply as a rider.",
    login: "/login?portal=rider",
  },
} as const;

type Area = keyof typeof AREAS;

function AccessDeniedContent() {
  const sp = useSearchParams();
  const { data: session } = useSession();
  const raw = sp.get("area") || "";
  const area: Area | null = raw in AREAS ? (raw as Area) : null;
  const info = area ? AREAS[area] : null;
  const from = safeCallbackUrl(sp.get("from"), "");
  const role = session?.user?.role;
  const ownArea = role ? getDefaultDest(role) : null;

  function signInDifferent() {
    const base = info?.login || "/login";
    const sep = base.includes("?") ? "&" : "?";
    const target = from ? `${base}${sep}callbackUrl=${encodeURIComponent(from)}` : base;
    void signOut({ callbackUrl: target });
  }

  return (
    <ShopContainer width="sm" className="flex min-h-[60vh] flex-col justify-center py-10">
      <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold text-ink">
          {info?.title || "You don't have access to this page"}
        </h1>
        <p className="mt-2 text-sm text-ink-subtle">
          {info?.body || "Sign in with an account that has access to this area."}
        </p>
        {session?.user && (
          <p className="mt-2 text-xs text-ink-subtle">
            Signed in as {session.user.name || session.user.email || session.user.phone}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button href="/" variant="outline">
            Go to homepage
          </Button>
          <Button type="button" onClick={signInDifferent}>
            Sign in with a different account
          </Button>
        </div>
        {ownArea && ownArea !== "/products" && (
          <p className="mt-4 text-sm">
            <a href={ownArea} className="font-semibold text-brand-600 hover:underline">
              Go to my dashboard →
            </a>
          </p>
        )}
        {area === "store" && role === "CUSTOMER" && (
          <p className="mt-2 text-sm">
            <a href="/store?tab=signup" className="font-semibold text-brand-600 hover:underline">
              Create a store →
            </a>
          </p>
        )}
        {area === "rider" && role === "CUSTOMER" && (
          <p className="mt-2 text-sm">
            <a href="/register/rider" className="font-semibold text-brand-600 hover:underline">
              Become a rider →
            </a>
          </p>
        )}
      </div>
    </ShopContainer>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense>
      <AccessDeniedContent />
    </Suspense>
  );
}
