"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  getDefaultDest,
  getOnboardingSlug,
} from "@/lib/onboarding/flows";
import { safeNext } from "@/lib/onboarding/complete";

/** Redirect /onboarding → role-specific wizard */
function OnboardingRedirectContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");

  useEffect(() => {
    fetch("/api/auth/onboarding")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) {
          router.replace("/login");
          return;
        }
        if (data.data.completed) {
          const dest = safeNext(next, getDefaultDest(data.data.role));
          window.location.assign(dest);
          return;
        }
        const slug = getOnboardingSlug(data.data.role);
        const q = next ? `?next=${encodeURIComponent(next)}` : "";
        router.replace(`/onboarding/${slug}${q}`);
      })
      .catch(() => router.replace("/login"));
  }, [router, next]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center text-ink-subtle">
      Loading your onboarding…
    </div>
  );
}

export default function OnboardingIndexPage() {
  return (
    <Suspense>
      <OnboardingRedirectContent />
    </Suspense>
  );
}
