"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { markOnboardingDone, safeNext } from "@/lib/onboarding/complete";
import { STORE_ONBOARDING } from "@/lib/onboarding/flows";

function StoreOnboardingContent() {
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"), "/store-portal");
  const applied = sp.get("applied") === "1";
  const force = sp.get("force") === "1";
  const dest = applied ? `/store?tab=login&pending=1` : next;

  // Not signed in yet right after applying: the save fails quietly and the
  // tour is offered once more on the first sign-in after approval.
  async function finish() {
    await markOnboardingDone("completed");
    window.location.assign(dest);
  }

  async function skip() {
    await markOnboardingDone("skipped");
    window.location.assign(dest);
  }

  return (
    <OnboardingFlow
      title={STORE_ONBOARDING.title}
      subtitle={
        applied
          ? "Application submitted — wait for MandiBazaar approval before store login"
          : STORE_ONBOARDING.subtitle
      }
      steps={STORE_ONBOARDING.steps}
      finishLabel={applied ? "Back to store sign in" : STORE_ONBOARDING.finishLabel}
      onFinish={finish}
      onSkip={skip}
      persistProgress={!applied && !force}
    />
  );
}

export default function StoreOnboardingPage() {
  return (
    <Suspense>
      <StoreOnboardingContent />
    </Suspense>
  );
}
