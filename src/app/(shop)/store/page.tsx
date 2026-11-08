"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Store } from "lucide-react";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageHeader } from "@/components/layout/PageHeader";
import { StoreLoginForm } from "@/components/store/StoreLoginForm";
import { StoreSignupForm } from "@/components/store/StoreSignupForm";
import { cn } from "@/lib/utils";

type Tab = "login" | "signup";

function StoreAccessContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const initial: Tab =
    sp.get("tab") === "signup" || sp.get("mode") === "signup"
      ? "signup"
      : "login";
  const [tab, setTab] = useState<Tab>(initial);
  const pending = sp.get("pending") === "1";
  const pendingReason =
    sp.get("reason") ||
    (pending
      ? "Your store application is pending MandiBazaar approval. You can sign in after it is approved."
      : "");

  useEffect(() => {
    const t = sp.get("tab") || sp.get("mode");
    if (t === "signup") setTab("signup");
    if (t === "login") setTab("login");
  }, [sp]);

  const addingAnotherStore =
    tab === "signup" &&
    (sp.get("add") === "1" ||
      session?.user?.role === "STORE_OWNER" ||
      session?.user?.role === "SUPER_ADMIN");

  // Approved owners who open Sign in get sent to the portal — but never kick
  // them off Create store / Add another store (they need that form).
  useEffect(() => {
    if (status !== "authenticated") return;
    const role = session?.user?.role;
    if (role !== "STORE_OWNER" && role !== "SUPER_ADMIN") return;
    if (tab === "signup") return;

    let cancelled = false;
    fetch("/api/store/access")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success && d.data.allowed) {
          router.replace("/store-portal");
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [status, session, router, tab]);

  function goTab(next: Tab) {
    setTab(next);
    const url =
      next === "signup"
        ? session?.user
          ? "/store?tab=signup&add=1"
          : "/store?tab=signup"
        : "/store?tab=login";
    window.history.replaceState(null, "", url);
  }

  return (
    <ShopContainer width="md">
      <Breadcrumbs items={[{ label: "Store" }]} />
      <PageHeader
        title={addingAnotherStore ? "Add another store" : "Store"}
        subtitle={
          addingAnotherStore
            ? "Submit a new store under your existing account — MandiBazaar will review it"
            : "One place for store owners — sign in or create your store account"
        }
        badge="Sellers"
      />

      {addingAnotherStore && session?.user && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Signed in as <strong>{session.user.name || "store owner"}</strong>.
          This application adds another store to your account.{" "}
          <Link
            href="/store-portal"
            className="font-semibold underline hover:text-emerald-700"
          >
            Back to portal
          </Link>
        </div>
      )}

      <div className="mb-6 flex rounded-2xl border border-line bg-app p-1">
        <button
          type="button"
          onClick={() => goTab("login")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition",
            tab === "login"
              ? "bg-card text-emerald-800 shadow-sm"
              : "text-ink-subtle hover:text-ink"
          )}
        >
          <Store className="h-4 w-4" />
          Sign in
        </button>
        <button
          type="button"
          onClick={() => goTab("signup")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition",
            tab === "signup"
              ? "bg-card text-emerald-800 shadow-sm"
              : "text-ink-subtle hover:text-ink"
          )}
        >
          {addingAnotherStore ? "New store" : "Create store"}
        </button>
      </div>

      {tab === "login" ? (
        <StoreLoginForm
          onSwitchToSignup={() => goTab("signup")}
          initialError={pendingReason || undefined}
        />
      ) : (
        <StoreSignupForm onSwitchToLogin={() => goTab("login")} />
      )}
    </ShopContainer>
  );
}

export default function StoreAccessPage() {
  return (
    <Suspense
      fallback={
        <ShopContainer width="md">
          <div className="skeleton h-64 rounded-2xl" />
        </ShopContainer>
      }
    >
      <StoreAccessContent />
    </Suspense>
  );
}
